import React, { useState, useRef, useEffect } from 'react';
import { Node } from '../models/Node';
import {
  extractDataFromTwine,
  generateNodesFromExtractedData,
  regenerateSingleNode,
  ExtractedData
} from '../services/llm';
import { PromptSelector } from './PromptSelector';
import { Message } from '../context/ChatContext';
import DiffViewer from './DiffViewer';
import { LLMNodeEditionResponse, NodeSpecificUpdates } from '../models/nodeOperations';

const MAX_CONTENT_LENGTH = 4000000; // 4 million characters

// Helper function to calculate height based on content length
const calculateHeight = (text: string, isLongDescription: boolean = false, defaultRows: number = 10) => {
  if (!isLongDescription) return `${defaultRows * 1.5}rem`;
  const lineCount = (text || '').split('\n').length;
  const minHeight = '15rem';
  const calculatedHeight = `${Math.max(15, lineCount * 1.5)}rem`;
  return calculatedHeight;
};

interface TwineImportOverlayProps {
  nodes: Node[];
  updateGraph: (
    nodeEdition: LLMNodeEditionResponse,
    imagePrompts?: { nodeId: string; prompt: string }[],
    chatHistory?: Message[],
    isFromUserInteraction?: boolean
  ) => Promise<void>;
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
  const [regenerationProgress, setRegenerationProgress] = useState<{ [key: string]: number }>({});

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
        updateImage?: boolean;
        name?: string;
        type?: string;
      }[];
      delete?: string[];
    };
    editedNodes?: Map<string, Partial<Node>>;
  }>({
    showPreview: false,
    step: 'extraction',
    originalNodes: nodes,
    editedNodes: new Map()
  });

  // Add this function after the createDiffSpans function
  const toggleImageUpdate = (nodeId: string) => {
    setPreview(prev => {
      if (!prev.changes?.update && !prev.changes?.new) return prev;
      
      const newEditedNodes = new Map(prev.editedNodes);
      const existingEdit = newEditedNodes.get(nodeId) || {};
      const currentUpdateFlag = existingEdit.updateImage ?? 
                                (prev.changes.update?.find(u => u.id === nodeId)?.updateImage) ?? 
                                (prev.changes.new?.find(n => n.id === nodeId)?.updateImage) ?? false;

      newEditedNodes.set(nodeId, { ...existingEdit, updateImage: !currentUpdateFlag });
      
      return {
        ...prev,
        editedNodes: newEditedNodes
      };
    });
  };

  // Add this function after the toggleImageUpdate function
  const handleNodeEdit = (nodeId: string, field: keyof Node, value: string | boolean) => {
    setPreview(prev => {
      const newEditedNodes = new Map(prev.editedNodes || new Map());
      const existingEdit = newEditedNodes.get(nodeId) || {};
      newEditedNodes.set(nodeId, { ...existingEdit, [field]: value });
      return { ...prev, editedNodes: newEditedNodes };
    });
  };

  // Add new function to regenerate a single node
  const handleRegenerateNode = async (nodeId: string, isNewNode: boolean) => {
    if (!preview.extractedData) return;
    setIsLoading(true);
    setError('');
    try {
      const baseNodeForRegen = isNewNode 
        ? preview.changes?.new?.find(n => n.id === nodeId)
        : preview.changes?.update?.find(n => n.id === nodeId) || nodes.find(n => n.id === nodeId);

      if (!baseNodeForRegen) throw new Error('Node not found for regeneration');

      const regeneratedNodeData = await regenerateSingleNode(
        nodeId,
        baseNodeForRegen,
        preview.extractedData,
        nodes, // Pass original nodes as context
        importMode,
        secondPromptInstructions,
        baseNodeForRegen // Pass itself as the recently generated version for this context
      );

      if (regeneratedNodeData) {
        setPreview(prev => {
          if (!prev.changes) return prev;
          const newChanges = { ...prev.changes };
          const userEdits = prev.editedNodes?.get(nodeId) || {};
          const finalRegeneratedNode = {...regeneratedNodeData, ...userEdits };

          if (isNewNode && newChanges.new) {
            newChanges.new = newChanges.new.map(n => n.id === nodeId ? { ...n, ...finalRegeneratedNode } : n);
          } else if (!isNewNode && newChanges.update) {
            newChanges.update = newChanges.update.map(u => u.id === nodeId ? { ...u, ...finalRegeneratedNode } : u);
          } else if (!isNewNode && !newChanges.update && nodes.find(n => n.id === nodeId)) {
            // If it was an original node not in .update, add it to .update
            newChanges.update = [...(newChanges.update || []), {id: nodeId, ...finalRegeneratedNode}];
          }
          return { ...prev, changes: newChanges };
        });
      }
    } catch (err) {
      setError('Failed to regenerate node. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
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
        (completed) => setExtractionProgress(completed)
      );
      if ((extractedData.failedChunks ?? 0) > 0) {
        setError(`Warning: ${extractedData.failedChunks} out of ${extractionCount} chunks failed to process.`);
      }
      if (extractedData.chunks && extractedData.chunks.length > 0) {
        setPreview({
          showPreview: true,
          step: 'generation',
          originalNodes: nodes,
          content: cleanedContent,
          extractedData: extractedData,
          editedNodes: new Map() // Reset edits
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
      if (nodeResponse && (nodeResponse.new?.length || nodeResponse.update?.length)) {
        setPreview(prev => ({
          ...prev,
          step: 'preview',
          changes: nodeResponse, // Store the structure { new?: Partial<Node>[], update?: ..., delete?: ... }
          editedNodes: new Map() // Reset edits
        }));
        // Further regeneration logic after this, if any, would go here or be triggered by user
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
      const n_nodes: Node[] = [];
      const u_nodes: { [nodeId: string]: NodeSpecificUpdates } = {};

      // Process new nodes
      preview.changes.new?.forEach(newNodePartial => {
        if (!newNodePartial.id) newNodePartial.id = `twineNew-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const userEdits = preview.editedNodes?.get(newNodePartial.id) || {};
        const finalNewNode: Node = {
          id: newNodePartial.id!,
          name: userEdits.name ?? newNodePartial.name ?? 'Untitled Twine Node',
          longDescription: userEdits.longDescription ?? newNodePartial.longDescription ?? '',
          type: userEdits.type ?? newNodePartial.type ?? 'location',
          image: userEdits.image ?? newNodePartial.image ?? '',
          updateImage: userEdits.updateImage ?? newNodePartial.updateImage ?? true,
          imageSeed: userEdits.imageSeed ?? newNodePartial.imageSeed ?? undefined,
          // Ensure position is an object, even if empty or default
          position: userEdits.position ?? newNodePartial.position ?? { x: Math.random() * 400, y: Math.random() * 300 }
        };
        n_nodes.push(finalNewNode);
      });

      // Process updated nodes
      preview.changes.update?.forEach(updateInstruction => {
        const existingNode = nodes.find(n => n.id === updateInstruction.id);
        if (existingNode) {
          const userEdits = preview.editedNodes?.get(updateInstruction.id) || {};
          const updateOps: NodeSpecificUpdates = {};
          let hasChanges = false;

          // Iterate over fields in updateInstruction and userEdits
          const allKeys = new Set([...Object.keys(updateInstruction), ...Object.keys(userEdits)]);
          
          allKeys.forEach(key => {
            if (key === 'id') return;
            const finalValue = (userEdits as any)[key] !== undefined ? (userEdits as any)[key] : (updateInstruction as any)[key];
            
            if (finalValue !== undefined) {
              if (key === 'updateImage' || key === 'img_upd') {
                if (finalValue) updateOps.img_upd = true;
                // else if updateOps.img_upd was true and finalValue is false, it remains true unless explicitly set false in userEdits
                // For simplicity, if updateImage is edited to false, we assume img_upd should not be set true from original suggestion.
                // If userEdits.updateImage is explicitly false, then img_upd should be false.
                if (userEdits.updateImage === false) updateOps.img_upd = false;
                else if (finalValue) updateOps.img_upd = true; 

                hasChanges = true;
              } else if (key === 'imageSeed' || key === 'position') { // These are direct replacements
                 updateOps[key] = { rpl: finalValue };
                 hasChanges = true;
              } else { // For name, longDescription, type
                updateOps[key] = { rpl: finalValue };
                hasChanges = true;
              }
            }
          });

          if (hasChanges) {
            u_nodes[updateInstruction.id] = updateOps;
          }
        }
      });
      
      const nodeEditionPayload: LLMNodeEditionResponse = {
        callId: `twineImport-${Date.now()}`,
        n_nodes: n_nodes.length > 0 ? n_nodes : undefined,
        u_nodes: Object.keys(u_nodes).length > 0 ? u_nodes : undefined,
        d_nodes: preview.changes.delete?.length ? preview.changes.delete : undefined,
      };

      updateGraph(nodeEditionPayload, undefined, undefined, false);
      closeOverlay();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-5/6 max-h-[95vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 className="text-xl font-bold">Import Twine Story</h2>
          <button onClick={closeOverlay} className="text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-grow overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          {/* File Upload Section */}
          {!preview.showPreview && (
            <>
              <div className="mb-6">
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".html,.twee" className="hidden"/>
                <button onClick={() => fileInputRef.current?.click()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
                  Upload Twine File
                </button>
                {contentChunks.length > 0 && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Select Content Chunk ({contentChunks.length} chunks available)</label>
                    <select value={selectedChunkIndex} onChange={(e) => setSelectedChunkIndex(Number(e.target.value))} className="w-full p-2 bg-gray-700 text-white rounded">
                      {contentChunks.map((chunk, index) => (<option key={index} value={index}>Chunk {index + 1} ({chunk.length.toLocaleString()} chars)</option>))}
                    </select>
                    <div className="text-sm text-gray-400 mt-1">File split due to size. Max chunk: {MAX_CONTENT_LENGTH.toLocaleString()} chars.</div>
                  </div>
                )}
              </div>
              {cleanedContent && (
                <div className="mb-6">
                  <div className="flex space-x-4 mb-4">
                    <button onClick={() => setUseAggressiveClean(false)} className={`px-4 py-2 rounded ${!useAggressiveClean ? 'bg-blue-600' : 'bg-gray-700'}`}>Basic Clean</button>
                    <button onClick={() => setUseAggressiveClean(true)} className={`px-4 py-2 rounded ${useAggressiveClean ? 'bg-blue-600' : 'bg-gray-700'}`}>Aggressive Clean</button>
                  </div>
                  <textarea value={cleanedContent} readOnly className="w-full h-40 p-2 bg-gray-700 text-white rounded" placeholder="Processed content..."/>
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Import Mode</label>
                <div className="flex space-x-4">
                  <button onClick={() => setImportMode('new_game')} className={`px-4 py-2 rounded ${importMode === 'new_game' ? 'bg-blue-600' : 'bg-gray-700'}`}>New Game</button>
                  <button onClick={() => setImportMode('merge_story')} className={`px-4 py-2 rounded ${importMode === 'merge_story' ? 'bg-blue-600' : 'bg-gray-700'}`}>Merge with Existing</button>
                </div>
              </div>
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">Parallel Extractions: {extractionCount}</label>
                  <span className="text-sm text-blue-400">({Math.ceil(Math.min(cleanedContent.length, MAX_CONTENT_LENGTH) / extractionCount)} chars/extraction)</span>
                </div>
                <input type="range" min="1" max="40" value={extractionCount} onChange={(e) => setExtractionCount(Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"/>
              </div>
              <div className="mb-6">
                <PromptSelector onPromptSelect={(dataExtraction, nodeGeneration) => { setNextPromptInstructions(dataExtraction); setSecondPromptInstructions(nodeGeneration); }} />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Data Extraction Instructions (First Prompt)</label>
                <textarea value={nextPromptInstructions} onChange={(e) => setNextPromptInstructions(e.target.value)} className="w-full h-20 p-2 bg-gray-700 text-white rounded" placeholder="Instructions for data extraction..."/>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Node Generation Instructions (Second Prompt)</label>
                <textarea value={secondPromptInstructions} onChange={(e) => setSecondPromptInstructions(e.target.value)} className="w-full h-20 p-2 bg-gray-700 text-white rounded" placeholder="Instructions for node generation..."/>
              </div>
            </>
          )}

          {/* Preview Section Here */}
          {preview.showPreview && (
            <div className="mt-6">
              {preview.step === 'generation' && preview.extractedData && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold">Extracted Data Preview</h3>
                    <button onClick={handleExtractData} disabled={isLoading} className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                      {isLoading ? `Extracting... ${extractionProgress}/${extractionCount}` : 'Re-extract Data'}
                    </button>
                  </div>
                  <div className="bg-gray-700 p-4 rounded max-h-60 overflow-y-auto"><pre className="text-white whitespace-pre-wrap">{JSON.stringify(preview.extractedData, null, 2)}</pre></div>
                </div>
              )}
              {preview.step === 'preview' && preview.changes && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold">Generated Nodes Preview</h3>
                    <button onClick={handleGenerateNodes} disabled={isLoading} className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                      {isLoading ? 'Regenerating...' : 'Regenerate Nodes'}
                    </button>
                  </div>
                  {/* New Nodes Preview */}
                  {preview.changes.new?.map((node) => {
                    const edited = preview.editedNodes?.get(node.id!) || {};
                    const displayNode = {...node, ...edited};
                    return (
                      <div key={node.id} className="p-4 bg-gray-700/50 rounded mb-2">
                        <h4 className="text-md font-semibold text-green-400">New: {displayNode.name} (ID: {node.id})</h4>
                        {/* Add editable fields for new nodes similar to updated nodes */}
                        {/* For brevity, just showing name and type here, expand as needed */}
                        <label>Name: <input type="text" value={displayNode.name} onChange={e => handleNodeEdit(node.id!, 'name', e.target.value)} className="bg-gray-600 p-1 rounded" /></label>
                        <label className="ml-2">Type: <input type="text" value={displayNode.type} onChange={e => handleNodeEdit(node.id!, 'type', e.target.value)} className="bg-gray-600 p-1 rounded" /></label>
                        <label className="ml-2"><input type="checkbox" checked={!!displayNode.updateImage} onChange={e => handleNodeEdit(node.id!, 'updateImage', e.target.checked)} /> Update Image</label>
                        <DiffViewer original="" updated={`Desc: ${displayNode.longDescription}`} isCurrent={false} />
                      </div>
                    );
                  })}
                  {/* Updated Nodes Preview */}
                  {preview.changes.update?.map((update) => {
                    const originalNode = nodes.find(n => n.id === update.id);
                    if (!originalNode) return null;
                    const edited = preview.editedNodes?.get(update.id) || {};
                    const displayNode = {
                        name: edited.name ?? update.name ?? originalNode.name,
                        longDescription: edited.longDescription ?? update.longDescription ?? originalNode.longDescription,
                        type: edited.type ?? update.type ?? originalNode.type,
                        updateImage: edited.updateImage ?? update.updateImage ?? originalNode.updateImage
                    };
                    return (
                      <div key={update.id} className="p-4 bg-gray-700/50 rounded mb-2">
                        <h4 className="text-md font-semibold text-yellow-400">Update: {displayNode.name} (ID: {update.id})</h4>
                        <label>Name: <input type="text" value={displayNode.name} onChange={e => handleNodeEdit(update.id, 'name', e.target.value)} className="bg-gray-600 p-1 rounded" /></label>
                        <label className="ml-2">Type: <input type="text" value={displayNode.type} onChange={e => handleNodeEdit(update.id, 'type', e.target.value)} className="bg-gray-600 p-1 rounded" /></label>
                        <label className="ml-2"><input type="checkbox" checked={!!displayNode.updateImage} onChange={e => handleNodeEdit(update.id, 'updateImage', e.target.checked)} /> Update Image</label>
                        <p className="text-xs mt-1">Desc Diff:</p>
                        <DiffViewer original={originalNode.longDescription} updated={displayNode.longDescription} isCurrent={false}/>
                      </div>
                    );
                  })}
                  {/* Deleted Nodes Preview */}
                  {preview.changes.delete?.map((nodeId) => (<div key={nodeId} className="p-2 bg-red-700/50 rounded mb-2 text-red-300">Delete: {nodes.find(n=>n.id === nodeId)?.name || nodeId}</div>))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 pt-4 border-t border-gray-700 flex justify-end space-x-4 flex-shrink-0">
          <button onClick={closeOverlay} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded">Cancel</button>
          {preview.step === 'extraction' && !preview.showPreview && (
            <button onClick={handleExtractData} disabled={isLoading || !cleanedContent} className={`px-4 py-2 rounded ${isLoading || !cleanedContent ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
              {isLoading ? `Extracting... ${extractionProgress}/${extractionCount}` : 'Extract Data'}
            </button>
          )}
          {preview.step === 'generation' && preview.showPreview && (
            <button onClick={handleGenerateNodes} disabled={isLoading} className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
              {isLoading ? 'Generating...' : 'Generate Nodes'}
            </button>
          )}
          {preview.step === 'preview' && preview.showPreview && (
            <button onClick={handleConfirm} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded">Confirm Import</button>
          )}
        </div>
        {error && (<div className="mt-4 p-4 bg-red-800 text-white rounded">{error}</div>)}
      </div>
    </div>
  );
};

export default TwineImportOverlay;