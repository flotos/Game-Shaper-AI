import React, { useState, useRef, useEffect } from 'react';
import { Node } from '../models/Node';
import { extractDataFromTwine, generateNodesFromExtractedData } from '../services/LLMService';
import { PromptSelector } from './PromptSelector';

const MAX_CONTENT_LENGTH = 4000000; // 4 million characters

interface TwineImportOverlayProps {
  nodes: Node[];
  updateGraph: (nodeEdition: { 
    merge: Node[];
    delete: string[];
    newNodes: string[];
  }, imagePrompts?: { nodeId: string; prompt: string }[]) => Promise<void>;
  closeOverlay: () => void;
}

const TwineImportOverlay: React.FC<TwineImportOverlayProps> = ({ nodes, updateGraph, closeOverlay }) => {
  // File handling states
  const [fileContent, setFileContent] = useState<string>('');
  const [cleanedContent, setCleanedContent] = useState<string>('');
  const [contentChunks, setContentChunks] = useState<string[]>([]);
  const [selectedChunkIndex, setSelectedChunkIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [extractionProgress, setExtractionProgress] = useState(0);

  // Import settings
  const [importMode, setImportMode] = useState<'new_game' | 'merge_story'>('merge_story');
  const [useAggressiveClean, setUseAggressiveClean] = useState(true);
  const [trimPercentage, setTrimPercentage] = useState(0);
  const [extractionCount, setExtractionCount] = useState(1);
  const [nextPromptInstructions, setNextPromptInstructions] = useState('');
  const [secondPromptInstructions, setSecondPromptInstructions] = useState('');

  // Preview states
  const [preview, setPreview] = useState<{
    showPreview: boolean;
    step: 'extraction' | 'generation' | 'preview';
    originalNodes: Node[];
    content?: string;
    extractedData?: any;
    changes?: {
      new?: Partial<Node>[];
      update?: {
        id: string;
        longDescription?: string;
        rules?: string;
        updateImage?: boolean;
      }[];
      delete?: string[];
    };
  }>({
    showPreview: false,
    step: 'extraction',
    originalNodes: nodes
  });

  // Add this helper function at the top of the file, after the imports
  const createDiffSpans = (original: string | string[] | undefined | null, updated: string | string[] | undefined | null, isCurrent: boolean) => {
    try {
      // Handle undefined or null values and ensure strings
      const originalText = typeof original === 'string' ? original : 
                          Array.isArray(original) ? original.join(', ') : '';
      const updatedText = typeof updated === 'string' ? updated : 
                         Array.isArray(updated) ? updated.join(', ') : '';
      
      // Split into words and normalize whitespace
      const originalWords = originalText.trim().split(/\s+/);
      const updatedWords = updatedText.trim().split(/\s+/);
      const result = [];
      
      // Find the longest common subsequence
      const lcs = [];
      const dp = Array(originalWords.length + 1).fill(0).map(() => Array(updatedWords.length + 1).fill(0));
      
      for (let i = 1; i <= originalWords.length; i++) {
        for (let j = 1; j <= updatedWords.length; j++) {
          if (originalWords[i - 1] === updatedWords[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
          }
        }
      }
      
      let i = originalWords.length;
      let j = updatedWords.length;
      
      while (i > 0 && j > 0) {
        if (originalWords[i - 1] === updatedWords[j - 1]) {
          lcs.unshift(originalWords[i - 1]);
          i--;
          j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
          i--;
        } else {
          j--;
        }
      }
      
      // Now render the differences
      i = 0;
      j = 0;
      let lcsIndex = 0;
      
      if (isCurrent) {
        // Left side - show original with deletions in red
        while (i < originalWords.length) {
          if (lcsIndex < lcs.length && originalWords[i] === lcs[lcsIndex]) {
            result.push(<span key={`common-${i}`} className="text-white">{lcs[lcsIndex]} </span>);
            i++;
            lcsIndex++;
          } else {
            result.push(
              <span key={`old-${i}`} className="bg-red-900 text-white">
                {originalWords[i]}{' '}
              </span>
            );
            i++;
          }
        }
      } else {
        // Right side - show updated with additions in green
        while (j < updatedWords.length) {
          if (lcsIndex < lcs.length && updatedWords[j] === lcs[lcsIndex]) {
            result.push(<span key={`common-${j}`} className="text-white">{lcs[lcsIndex]} </span>);
            j++;
            lcsIndex++;
          } else {
            result.push(
              <span key={`new-${j}`} className="bg-green-900 text-white">
                {updatedWords[j]}{' '}
              </span>
            );
            j++;
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error in createDiffSpans:', error);
      return [<span key="error" className="text-red-500">Error displaying diff</span>];
    }
  };

  // Add this function after the createDiffSpans function
  const toggleImageUpdate = (nodeId: string) => {
    setPreview(prev => {
      if (!prev.changes?.update) return prev;
      
      const updatedChanges = {
        ...prev.changes,
        update: prev.changes.update.map(update => 
          update.id === nodeId 
            ? { ...update, updateImage: !update.updateImage }
            : update
        )
      };
      
      return {
        ...prev,
        changes: updatedChanges
      };
    });
  };

  // Basic cleaning function
  const cleanContent = (content: string, aggressive: boolean = false): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const passages = Array.from(doc.querySelectorAll('tw-passagedata'));
    
    return passages.map(passage => {
      const name = passage.getAttribute('name') || 'Untitled';
      let text = passage.textContent || '';
      
      if (aggressive) {
        // Skip script files and JavaScript content
        if (name.toLowerCase().endsWith('.js') || 
            name.toLowerCase().includes('script') ||
            text.trim().startsWith('(()') ||
            text.trim().startsWith('function') ||
            text.trim().startsWith('const') ||
            text.trim().startsWith('let') ||
            text.trim().startsWith('var') ||
            text.trim().startsWith('/*') ||
            text.trim().startsWith('//')) {
          return '';
        }
        
        // Aggressive cleaning patterns
        const patterns = [
          // Base64 image patterns - must be first to catch all variations
          /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
          /\[img\[[^\]]+\]\[[^\]]+\]\]/g,
          /\[Macros\][\s\S]*?(?=\n\n|$)/g,
          /\([^)]*\)/g,
          /\)+/g,
          /\(+/g,
          /<[^>]+>/g,
          /<<[^>]+>>/g,
          /\[\[[^\]]+\]\]/g,
          /<style[^>]*>[\s\S]*?<\/style>/g,
          /<script[^>]*>[\s\S]*?<\/script>/g,
          /&[^;]+;/g,
          /^>\s*/g,
          />/g,
          /</g,
          /[\[\]]/g
        ];
        
        // Apply patterns while preserving spaces between words
        text = patterns.reduce((acc, pattern) => {
          // Replace matches with a space to preserve word separation
          return acc.replace(pattern, ' ');
        }, text)
        // Normalize whitespace: replace multiple spaces with a single space
        .replace(/\s+/g, ' ')
        .trim();
        
        // Filter lines
        const lines = text.split('\n');
        const cleanedLines = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 0 && 
            !trimmed.startsWith('/IF') && 
            !trimmed.startsWith('ELSE') && 
            !trimmed.startsWith('SET') &&
            !/^case \d+SET Scene to \d+$/.test(trimmed) &&
            !/^defaultSET Scene to \d+$/.test(trimmed) &&
            trimmed !== '/button' &&
            !trimmed.startsWith('src=') &&
            !trimmed.startsWith('widget') &&
            !trimmed.includes('layer') &&
            !trimmed.includes('class=') &&
            !trimmed.includes('img$image_dir+') &&
            // Additional base64 image checks
            !trimmed.startsWith('data:image/') &&
            !trimmed.includes(';base64,');
        });
        
        // Join lines and normalize newlines
        const content = cleanedLines.length > 0 ? `[${name}]\n${cleanedLines.join('\n')}\n` : '';
        return content.replace(/\n{3,}/g, '\n\n');
      } else {
        // Basic cleaning - just remove empty lines and trim
        text = text
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .join('\n');
        
        // Normalize newlines in basic cleaning mode too
        const content = `[${name}]\n${text}\n`;
        return content.replace(/\n{3,}/g, '\n\n');
      }
    }).join('\n').replace(/\n{3,}/g, '\n\n');
  };

  // Split content into chunks
  const splitIntoChunks = (content: string): string[] => {
    const chunks: string[] = [];
    const lines = content.split('\n');
    let currentChunk = '';
    let currentLength = 0;

    for (const line of lines) {
      if (currentLength + line.length + 1 > MAX_CONTENT_LENGTH) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
        currentLength = line.length + 1;
      } else {
        currentChunk += line + '\n';
        currentLength += line.length + 1;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        setFileContent(content);
        
        // Clean the content
        const cleaned = cleanContent(content, useAggressiveClean);
        setCleanedContent(cleaned);
        
        // Split into chunks if needed
        if (cleaned.length > MAX_CONTENT_LENGTH) {
          const chunks = splitIntoChunks(cleaned);
          setContentChunks(chunks);
          setSelectedChunkIndex(0);
        } else {
          setContentChunks([]);
          setSelectedChunkIndex(0);
        }
        
        setError('');
      } catch (err) {
        setError('Error processing file: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.readAsText(file);
  };

  // Handle chunk selection
  useEffect(() => {
    if (contentChunks.length > 0 && selectedChunkIndex < contentChunks.length) {
      setCleanedContent(contentChunks[selectedChunkIndex]);
    }
  }, [selectedChunkIndex, contentChunks]);

  // Handle cleaning mode change
  useEffect(() => {
    if (fileContent) {
      const cleaned = cleanContent(fileContent, useAggressiveClean);
      if (cleaned.length > MAX_CONTENT_LENGTH) {
        const chunks = splitIntoChunks(cleaned);
        setContentChunks(chunks);
        setSelectedChunkIndex(0);
        setCleanedContent(chunks[0]);
      } else {
        setContentChunks([]);
        setSelectedChunkIndex(0);
        setCleanedContent(cleaned);
      }
    }
  }, [useAggressiveClean, fileContent]);

  // Handle data extraction
  const handleExtractData = async () => {
    if (!cleanedContent) return;
    
    setIsLoading(true);
    setError('');
    setExtractionProgress(0);
    
    try {
      const extractedData = await extractDataFromTwine(
        cleanedContent,
        nextPromptInstructions,
        extractionCount,
        (completed) => {
          setExtractionProgress(completed);
        }
      );

      if (extractedData.failedChunks > 0) {
        setError(`Warning: ${extractedData.failedChunks} out of ${extractionCount} chunks failed to process.`);
      }

      // Only update preview if we have valid data
      if (extractedData.chunks && extractedData.chunks.length > 0) {
        setPreview({
          showPreview: true,
          step: 'generation',
          originalNodes: nodes,
          content: cleanedContent,
          extractedData: extractedData
        });
      } else {
        setError('No data was extracted. Please try again with different settings.');
      }
    } catch (err) {
      setError('Failed to extract data. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
      setExtractionProgress(0);
    }
  };

  // Handle node generation
  const handleGenerateNodes = async () => {
    if (!preview.extractedData) {
      setError('Please extract data first before generating nodes.');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const nodeResponse = await generateNodesFromExtractedData(
        preview.extractedData,
        nodes,
        importMode,
        secondPromptInstructions
      );

      // Normalize rules to strings and ensure updateImage is set
      if (nodeResponse) {
        if (nodeResponse.new) {
          nodeResponse.new = nodeResponse.new.map((node: Partial<Node>) => ({
            ...node,
            rules: Array.isArray(node.rules) ? node.rules.join(', ') : node.rules,
            updateImage: node.updateImage ?? false
          }));
        }
        if (nodeResponse.update) {
          nodeResponse.update = nodeResponse.update.map((update: { id: string; longDescription?: string; rules?: string | string[]; updateImage?: boolean }) => ({
            ...update,
            rules: Array.isArray(update.rules) ? update.rules.join(', ') : update.rules,
            updateImage: update.updateImage ?? false
          }));
        }
      }

      // Only update preview if we have valid data
      if (nodeResponse && (nodeResponse.new?.length > 0 || nodeResponse.update?.length > 0)) {
        setPreview(prev => ({
          ...prev,
          step: 'preview',
          changes: nodeResponse
        }));
      } else {
        setError('No nodes were generated. Please try again with different settings.');
      }
    } catch (err) {
      setError('Failed to generate nodes. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle confirmation
  const handleConfirm = () => {
    if (preview.changes) {
      const changes = {
        merge: [
          ...(preview.changes.new?.map(node => ({
            id: node.id || '',
            name: node.name || '',
            longDescription: node.longDescription || '',
            rules: typeof node.rules === 'string' ? node.rules : (Array.isArray(node.rules) ? (node.rules as string[]).join(', ') : ''),
            type: node.type || '',
            image: node.image || '',
            updateImage: node.updateImage || false,
            imageSeed: node.imageSeed || 0
          } as Node)) || []),
          ...(preview.changes.update?.map(update => {
            const existingNode = nodes.find(n => n.id === update.id);
            if (!existingNode) return null;
            return {
              ...existingNode,
              longDescription: update.longDescription ?? existingNode.longDescription,
              rules: update.rules ?? existingNode.rules,
              updateImage: update.updateImage === undefined ? existingNode.updateImage : update.updateImage
            };
          }).filter(Boolean) as Node[]) || []
        ],
        delete: preview.changes.delete || [],
        newNodes: (preview.changes.new?.map(node => node.id).filter((id): id is string => id !== undefined) || [])
      };
      updateGraph(changes);
      closeOverlay();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-3/4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Import Twine Story</h2>
          <button onClick={closeOverlay} className="text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* File Upload Section */}
        <div className="mb-6">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".html,.twee"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Upload Twine File
          </button>
          {contentChunks.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm font-medium mb-2">
                Select Content Chunk ({contentChunks.length} chunks available)
              </label>
              <select
                value={selectedChunkIndex}
                onChange={(e) => setSelectedChunkIndex(Number(e.target.value))}
                className="w-full p-2 bg-gray-700 text-white rounded"
              >
                {contentChunks.map((chunk, index) => (
                  <option key={index} value={index}>
                    Chunk {index + 1} ({chunk.length.toLocaleString()} characters)
                  </option>
                ))}
              </select>
              <div className="text-sm text-gray-400 mt-1">
                File was split into {contentChunks.length} chunks due to size. Each chunk is approximately 4 million characters.
              </div>
            </div>
          )}
        </div>

        {/* Content Display Section */}
        {cleanedContent && (
          <div className="mb-6">
            <div className="flex space-x-4 mb-4">
              <button
                onClick={() => setUseAggressiveClean(false)}
                className={`px-4 py-2 rounded ${!useAggressiveClean ? 'bg-blue-600' : 'bg-gray-700'}`}
              >
                Basic Clean
              </button>
              <button
                onClick={() => setUseAggressiveClean(true)}
                className={`px-4 py-2 rounded ${useAggressiveClean ? 'bg-blue-600' : 'bg-gray-700'}`}
              >
                Aggressive Clean
              </button>
            </div>
            <textarea
              value={cleanedContent}
              readOnly
              className="w-full h-64 p-2 bg-gray-700 text-white rounded"
              placeholder="Processed content will appear here..."
            />
          </div>
        )}

        {/* Import Mode Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Import Mode</label>
          <div className="flex space-x-4">
            <button
              onClick={() => setImportMode('new_game')}
              className={`px-4 py-2 rounded ${importMode === 'new_game' ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              New Game
            </button>
            <button
              onClick={() => setImportMode('merge_story')}
              className={`px-4 py-2 rounded ${importMode === 'merge_story' ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              Merge with Existing
            </button>
          </div>
        </div>

        {/* Character Count and Chunk Splitting */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium">
              Number of Parallel Extractions: {extractionCount}
            </label>
            <span className="text-sm text-blue-400">
              ({Math.ceil(Math.min(cleanedContent.length, MAX_CONTENT_LENGTH) / extractionCount)} characters per extraction)
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="40"
            value={extractionCount}
            onChange={(e) => setExtractionCount(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Prompt Selector */}
        <div className="mb-6">
          <PromptSelector onPromptSelect={(dataExtraction, nodeGeneration) => {
            setNextPromptInstructions(dataExtraction);
            setSecondPromptInstructions(nodeGeneration);
          }} />
        </div>

        {/* Prompt Instructions */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Instructions for Data Extraction (First Prompt)</label>
          <textarea
            value={nextPromptInstructions}
            onChange={(e) => setNextPromptInstructions(e.target.value)}
            className="w-full h-32 p-2 bg-gray-700 text-white rounded"
            placeholder="Enter instructions for data extraction..."
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Instructions for Node Generation (Second Prompt)</label>
          <textarea
            value={secondPromptInstructions}
            onChange={(e) => setSecondPromptInstructions(e.target.value)}
            className="w-full h-32 p-2 bg-gray-700 text-white rounded"
            placeholder="Enter instructions for node generation..."
          />
        </div>

        {/* Progress Indicators */}
        {processingProgress > 0 && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm">Processing content: {processingProgress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${processingProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4">
          <button
            onClick={closeOverlay}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
          >
            Cancel
          </button>
          {preview.step === 'extraction' && (
            <button
              onClick={handleExtractData}
              disabled={isLoading || !cleanedContent}
              className={`px-4 py-2 rounded ${isLoading || !cleanedContent ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
            >
              {isLoading ? `Extracting... ${extractionProgress}/${extractionCount}` : 'Extract Data'}
            </button>
          )}
          {preview.step === 'generation' && (
            <button
              onClick={handleGenerateNodes}
              disabled={isLoading}
              className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
            >
              {isLoading ? 'Generating...' : 'Generate Nodes'}
            </button>
          )}
          {preview.step === 'preview' && (
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
            >
              Confirm
            </button>
          )}
        </div>

        {/* Preview Section */}
        {preview.showPreview && (
          <div className="mt-6">
            {preview.step === 'generation' && preview.extractedData && (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold">Extracted Data Preview</h3>
                  <button
                    onClick={handleExtractData}
                    disabled={isLoading}
                    className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                  >
                    {isLoading ? `Extracting... ${extractionProgress}/${extractionCount}` : 'Re-extract Data'}
                  </button>
                </div>
                <div className="bg-gray-700 p-4 rounded">
                  <pre className="text-white whitespace-pre-wrap">
                    {JSON.stringify(preview.extractedData, null, 2)}
                  </pre>
                </div>
              </div>
            )}
            {preview.step === 'preview' && preview.changes && (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold">Generated Nodes Preview</h3>
                  <button
                    onClick={handleGenerateNodes}
                    disabled={isLoading}
                    className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                  >
                    {isLoading ? 'Regenerating...' : 'Regenerate Nodes'}
                  </button>
                </div>
                {preview.changes.new?.map((node, index) => (
                  <div key={index} className="p-4 bg-gray-800 rounded">
                    <h4 className="text-lg font-bold mb-2">{node.name}</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Current</h4>
                        <div className="text-sm space-y-2">
                          <div>
                            <span className="font-semibold block mb-1">Long Description:</span>
                            <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                              {createDiffSpans('', node.longDescription || '', true)}
                            </div>
                          </div>
                          <div>
                            <span className="font-semibold block mb-1">Rules:</span>
                            <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                              {createDiffSpans('', node.rules || '', true)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">New</h4>
                        <div className="text-sm space-y-2">
                          <div>
                            <span className="font-semibold block mb-1">Long Description:</span>
                            <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                              {createDiffSpans('', node.longDescription || '', false)}
                            </div>
                          </div>
                          <div>
                            <span className="font-semibold block mb-1">Rules:</span>
                            <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                              {createDiffSpans('', node.rules || '', false)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <span className="font-semibold block mb-1">Type:</span>
                      <div className="p-2 bg-gray-700 rounded text-white">
                        {node.type}
                      </div>
                    </div>
                    <div className="mt-2">
                      <span className="font-semibold block mb-1">Image Generation:</span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => toggleImageUpdate(node.id || '')}
                          className={`px-3 py-1 rounded ${
                            node.updateImage 
                              ? 'bg-green-600 hover:bg-green-700' 
                              : 'bg-gray-600 hover:bg-gray-700'
                          } text-white transition-colors`}
                        >
                          {node.updateImage ? 'Will generate image' : 'No image generation needed'}
                        </button>
                        <span className="text-sm text-gray-400">
                          (Click to toggle)
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {preview.changes.update?.map((update, index) => {
                  const existingNode = nodes.find(n => n.id === update.id);
                  if (!existingNode) return null;
                  return (
                    <div key={index} className="p-4 bg-gray-800 rounded">
                      <h4 className="text-lg font-bold mb-2">{existingNode.name}</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-sm font-semibold mb-1">Current</h4>
                          <div className="text-sm space-y-2">
                            <div>
                              <span className="font-semibold block mb-1">Long Description:</span>
                              <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                                {createDiffSpans(existingNode.longDescription, update.longDescription || existingNode.longDescription, true)}
                              </div>
                            </div>
                            <div>
                              <span className="font-semibold block mb-1">Rules:</span>
                              <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                                {createDiffSpans(existingNode.rules, update.rules || existingNode.rules, true)}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold mb-1">Updated</h4>
                          <div className="text-sm space-y-2">
                            <div>
                              <span className="font-semibold block mb-1">Long Description:</span>
                              <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                                {createDiffSpans(existingNode.longDescription, update.longDescription || existingNode.longDescription, false)}
                              </div>
                            </div>
                            <div>
                              <span className="font-semibold block mb-1">Rules:</span>
                              <div className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                                {createDiffSpans(existingNode.rules, update.rules || existingNode.rules, false)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2">
                        <span className="font-semibold block mb-1">Image Update:</span>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => toggleImageUpdate(update.id)}
                            className={`px-3 py-1 rounded ${
                              update.updateImage 
                                ? 'bg-green-600 hover:bg-green-700' 
                                : 'bg-gray-600 hover:bg-gray-700'
                            } text-white transition-colors`}
                          >
                            {update.updateImage ? 'Will generate new image' : 'No image update needed'}
                          </button>
                          <span className="text-sm text-gray-400">
                            (Click to toggle)
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {preview.changes.delete?.map((nodeId, index) => (
                  <div key={index} className="p-4 bg-red-900 rounded">
                    <h4 className="text-lg font-bold">Node to Delete: {nodeId}</h4>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-4 bg-red-900 text-white rounded">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default TwineImportOverlay;