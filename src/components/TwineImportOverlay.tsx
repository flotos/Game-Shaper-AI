import React, { useState, useRef, useEffect } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromTwine, TWINE_DATA_EXTRACTION_PROMPT, TWINE_NODE_GENERATION_PROMPT_NEW_GAME, TWINE_NODE_GENERATION_PROMPT_MERGE } from '../services/LLMService';

interface TagStats {
  [key: string]: number;
}

interface PreviewState {
  showPreview: boolean;
  changes?: {
    merge?: Partial<Node>[];
    delete?: string[];
    newNodes?: string[];
  };
  originalNodes: Node[];
  content?: string;
}

interface TwineImportOverlayProps {
  nodes: Node[];
  updateGraph: (nodeEdition: { 
    merge: Node[];
    delete: string[];
    newNodes: string[];
  }, imagePrompts?: { nodeId: string; prompt: string }[]) => Promise<void>;
  closeOverlay: () => void;
}

// Helper function to create diff spans
const createDiffSpans = (original: string, updated: string, isCurrent: boolean) => {
  // Split into words and normalize whitespace
  const originalWords = original.trim().split(/\s+/);
  const updatedWords = updated.trim().split(/\s+/);
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
};

// Helper function to calculate height based on content length
const calculateHeight = (text: string, isLongDescription: boolean = false, defaultRows: number = 10) => {
  if (!isLongDescription) return `${defaultRows * 1.5}rem`;
  const lineCount = (text || '').split('\n').length;
  const minHeight = '15rem';
  const calculatedHeight = `${Math.max(15, lineCount * 1.5)}rem`;
  return calculatedHeight;
};

const TwineImportOverlay: React.FC<TwineImportOverlayProps> = ({ nodes, updateGraph, closeOverlay }) => {
  const [rawContent, setRawContent] = useState('');
  const [basicContent, setBasicContent] = useState('');
  const [aggressiveContent, setAggressiveContent] = useState('');
  const [selectedContent, setSelectedContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [tagStats, setTagStats] = useState<TagStats>({});
  const [importMode, setImportMode] = useState<'new_game' | 'merge_story'>('new_game');
  const [useAggressiveTrim, setUseAggressiveTrim] = useState(false);
  const [trimPercentage, setTrimPercentage] = useState(0);
  const [extractionCount, setExtractionCount] = useState(1);
  const [nextPromptInstructions, setNextPromptInstructions] = useState('');
  const [secondPromptInstructions, setSecondPromptInstructions] = useState('');
  const [preview, setPreview] = useState<PreviewState>({
    showPreview: false,
    originalNodes: nodes
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyzeTags = (content: string): TagStats => {
    const stats: TagStats = {};
    const tagRegex = /<([a-zA-Z0-9-]+)(?:\s|>)/g;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      const tagName = match[1].toLowerCase();
      stats[tagName] = (stats[tagName] || 0) + 1;
    }

    return stats;
  };

  // Function to process content with basic cleaning
  const processBasicContent = (content: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const passages = Array.from(doc.querySelectorAll('tw-passagedata'));
    
    return passages.map(passage => {
      const name = passage.getAttribute('name') || 'Untitled';
      let text = passage.textContent || '';
      
      // Basic cleaning - just remove empty lines and trim
      text = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');

      return `[${name}]\n${text}\n`;
    }).join('\n');
  };

  // Function to process content with aggressive cleaning
  const processAggressiveContent = (content: string, trimPercent: number = trimPercentage) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const passages = Array.from(doc.querySelectorAll('tw-passagedata'));
    
    // Process all passages and combine them
    let processedContent = passages.map(passage => {
      const name = passage.getAttribute('name') || 'Untitled';
      let text = passage.textContent || '';
      
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
      
      // Remove macro blocks and macro-related content
      text = text
        // Remove [Macros] blocks and everything after them until a double newline or end
        .replace(/\[Macros\][\s\S]*?(?=\n\n|$)/g, '')
        // Remove any line containing only parentheses and macro-like content
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // Skip lines that are just parentheses, numbers, or macro-like content
          if (/^[()\d\s,]+$/.test(trimmed)) return false;
          if (/^\)+$/.test(trimmed)) return false;
          if (/^\(forget-undos:/.test(trimmed)) return false;
          if (/^\(for:/.test(trimmed)) return false;
          if (/^\(print:/.test(trimmed)) return false;
          if (/^\(link:/.test(trimmed)) return false;
          if (/^\(dm:/.test(trimmed)) return false;
          return true;
        })
        .join('\n')
        // Remove any remaining macro-like patterns
        .replace(/\([^)]*\)/g, '')  // Remove simple parentheses content
        .replace(/\)+/g, '')        // Remove any remaining closing parentheses
        .replace(/\(+/g, '')        // Remove any remaining opening parentheses
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .trim();
      
      // Aggressive cleaning
      text = text
        .split('\n')
        .map(line => {
          // Remove HTML tags
          line = line.replace(/<[^>]+>/g, '');
          // Remove Twine macros
          line = line.replace(/<<[^>]+>>/g, '');
          // Remove image tags
          line = line.replace(/\[img\[[^\]]+\]\[[^\]]+\]\]/g, '');
          // Remove links
          line = line.replace(/\[\[[^\]]+\]\]/g, '');
          // Remove style tags
          line = line.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
          // Remove script tags
          line = line.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
          // Remove HTML entities
          line = line.replace(/&[^;]+;/g, '');
          // Remove standalone '>' characters
          line = line.replace(/^>\s*/g, '');
          // Remove any remaining '>' characters
          line = line.replace(/>/g, '');
          // Remove any remaining '<' characters
          line = line.replace(/</g, '');
          // Remove any remaining '[' or ']' characters that aren't part of passage names
          line = line.replace(/[\[\]]/g, '');
          return line.trim();
        })
        .filter(line => {
          const trimmedLine = line.trim();
          return trimmedLine.length > 0 && 
            !trimmedLine.startsWith('/IF') && 
            !trimmedLine.startsWith('ELSE') && 
            !trimmedLine.startsWith('SET') &&
            !/^case \d+SET Scene to \d+$/.test(trimmedLine) &&
            !/^defaultSET Scene to \d+$/.test(trimmedLine) &&
            trimmedLine !== '/button' &&
            !trimmedLine.startsWith('src=') &&
            !trimmedLine.startsWith('widget') &&
            !trimmedLine.includes('layer') &&
            !trimmedLine.includes('class=') &&
            !trimmedLine.match(/^SAVES from version/) &&
            // Additional script-related filters
            !trimmedLine.startsWith('/*') &&
            !trimmedLine.startsWith('//') &&
            !trimmedLine.startsWith('function') &&
            !trimmedLine.startsWith('const') &&
            !trimmedLine.startsWith('let') &&
            !trimmedLine.startsWith('var') &&
            !trimmedLine.includes('=>') &&
            !trimmedLine.includes('{') &&
            !trimmedLine.includes('}') &&
            !trimmedLine.includes(';') &&
            !trimmedLine.includes('()') &&
            !trimmedLine.includes('return') &&
            // Skip lines that are just prices (e.g., "25$")
            !line.match(/^\d+\$$/) &&
            // Skip lines containing image directory references
            !line.includes('img$image_dir+');
        })
        .join('\n');

      // Remove repetitive and low-content lines
      const lines = text.split('\n');
      const cleanedLines = [];
      let shortLineCount = 0;
      let lastLine = '';
      let groupStartIndex = 0;
      let groupCharCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) continue;
        
        // Skip lines that are just passage() or similar
        if (line.match(/^[^a-zA-Z]*passage\(\)[^a-zA-Z]*$/)) continue;
        
        // Skip lines that are just prices (e.g., "25$")
        if (line.match(/^\d+\$$/)) continue;
        
        // Skip lines that are just repeated content
        if (line === lastLine) continue;
        
        // Skip lines containing image directory references
        if (line.includes('img$image_dir+')) continue;

        // Check character density in groups of 15 lines
        groupCharCount += line.length;
        if (i - groupStartIndex >= 14) { // We have a group of 15 lines
          if (groupCharCount < 250) {
            // Remove all lines in this group
            cleanedLines.splice(groupStartIndex, i - groupStartIndex + 1);
          }
          groupStartIndex = i + 1;
          groupCharCount = 0;
        }
        
        // Count consecutive short lines
        if (line.length < 20) {
          shortLineCount++;
        } else {
          shortLineCount = 0;
        }
        
        // Only add the line if we haven't seen 5 consecutive short lines
        if (shortLineCount < 5) {
          cleanedLines.push(line);
          lastLine = line;
        }
      }

      // Check the last group if it's not a full 15 lines
      if (lines.length - groupStartIndex > 0) {
        if (groupCharCount < 250) {
          cleanedLines.splice(groupStartIndex);
        }
      }

      return cleanedLines.length > 0 ? `[${name}]\n${cleanedLines.join('\n')}\n` : '';
    }).join('\n');

    // Remove multiple consecutive line breaks
    processedContent = processedContent.replace(/\n{3,}/g, '\n\n');

    // Apply middle trimming to the final combined string
    if (trimPercent > 0) {
      const lines = processedContent.split('\n');
      const totalLines = lines.length;
      const linesToRemove = Math.floor(totalLines * (trimPercent / 100));
      const startIndex = Math.floor((totalLines - linesToRemove) / 2);
      const trimmedLines = lines.filter((_, index) => 
        index < startIndex || index >= startIndex + linesToRemove
      );
      return trimmedLines.join('\n');
    }

    return processedContent;
  };

  // Update selected content when toggle changes
  useEffect(() => {
    setSelectedContent(useAggressiveTrim ? aggressiveContent : basicContent);
  }, [useAggressiveTrim, basicContent, aggressiveContent]);

  // Update content when trim percentage changes
  useEffect(() => {
    if (rawContent) {
      const newAggressiveContent = processAggressiveContent(rawContent, trimPercentage);
      setAggressiveContent(newAggressiveContent);
      setSelectedContent(useAggressiveTrim ? newAggressiveContent : basicContent);
    }
  }, [trimPercentage, rawContent, useAggressiveTrim, basicContent]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
  
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        setRawContent(content);
        setBasicContent(processBasicContent(content));
        setAggressiveContent(processAggressiveContent(content));
        setSelectedContent(useAggressiveTrim ? processAggressiveContent(content) : processBasicContent(content));
        setError('');
      } catch (err) {
        setError('Failed to parse Twine file. Please ensure it is a valid Twine HTML export.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };

  const renderNodeComparison = (originalNode: Node | null, updatedNode: Partial<Node>) => {
    return (
      <div className="mb-4 p-4 bg-gray-800 rounded">
        <h3 className="text-lg font-bold mb-2">{updatedNode.name}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-1">Current</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ 
                      height: calculateHeight(originalNode?.longDescription || '', true),
                      overflowY: 'auto'
                    }}
                  >
                    {createDiffSpans(originalNode?.longDescription || '', updatedNode.longDescription || '', true)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ height: '7.5rem', overflowY: 'auto' }}
                  >
                    {createDiffSpans(originalNode?.rules || '', updatedNode.rules || '', true)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <div className="relative">
                  <div className="w-full p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                    {createDiffSpans(originalNode?.type || '', updatedNode.type || '', true)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-1">New</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ 
                      height: calculateHeight(updatedNode.longDescription || '', true),
                      overflowY: 'auto'
                    }}
                  >
                    {createDiffSpans(originalNode?.longDescription || '', updatedNode.longDescription || '', false)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ height: '7.5rem', overflowY: 'auto' }}
                  >
                    {createDiffSpans(originalNode?.rules || '', updatedNode.rules || '', false)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <div className="relative">
                  <div className="w-full p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                    {createDiffSpans(originalNode?.type || '', updatedNode.type || '', false)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleNext = async () => {
    if (!selectedContent) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const nodeResponse = await generateNodesFromTwine(
        selectedContent,
        nodes,
        importMode,
        nextPromptInstructions,
        secondPromptInstructions,
        extractionCount
      );
      setPreview({
        showPreview: true,
        changes: nodeResponse,
        originalNodes: nodes,
        content: selectedContent
      });
    } catch (err) {
      setError('Failed to process the Twine content. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (preview.changes) {
      // Convert Partial<Node>[] to Node[] for updateGraph
      const changes = {
        merge: preview.changes.merge?.map(node => ({
          id: node.id || '',
          name: node.name || '',
          longDescription: node.longDescription || '',
          rules: node.rules || '',
          type: node.type || '',
          parent: node.parent || '',
          child: node.child || [],
          image: node.image || '',
          updateImage: node.updateImage || false,
          imageSeed: node.imageSeed || 0
        } as Node)) || [],
        delete: preview.changes.delete || [],
        newNodes: preview.changes.newNodes || []
      };
      updateGraph(changes);
      closeOverlay();
    }
  };

  if (preview.showPreview && preview.changes) {
    return (
      <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
        <div className="bg-slate-900 p-6 rounded shadow-md w-5/6 max-w-[100vw] max-h-[95vh] overflow-y-auto">
          <h2 className="text-xl mb-4 text-white">Preview Changes</h2>
          
          {preview.content && (
            <div className="mb-4 p-4 bg-gray-800 rounded">
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Twine Content:</h3>
              <div 
                className="w-full p-2 bg-gray-700 rounded text-white whitespace-pre-wrap overflow-y-auto"
                style={{ maxHeight: '200px' }}
              >
                {preview.content}
              </div>
            </div>
          )}
          
          {preview.changes.delete && preview.changes.delete.length > 0 && (
            <div className="mb-4 p-4 bg-red-900/50 rounded">
              <h3 className="text-lg font-bold mb-2">Nodes to be deleted:</h3>
              <ul className="list-disc list-inside">
                {preview.changes.delete.map(id => {
                  const node = preview.originalNodes.find(n => n.id === id);
                  return <li key={id}>{node?.name || id}</li>;
                })}
              </ul>
            </div>
          )}

          {preview.changes.merge && preview.changes.merge.map(updatedNode => {
            const originalNode = preview.originalNodes.find(n => n.id === updatedNode.id) || null;
            return renderNodeComparison(originalNode, updatedNode);
          })}

          <div className="flex justify-end space-x-4 mt-4">
            <button
              onClick={() => setPreview({ showPreview: false, originalNodes: nodes })}
              className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-[98%] h-[96vh] max-h-[96vh] overflow-y-auto">
        <h2 className="text-xl mb-4 text-white">Import Twine Game</h2>
        
        <div className="mb-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Upload Twine HTML File
          </button>
          <input
            type="file"
            accept=".html"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {rawContent && (
          <div className="mb-4">
            <h3 className="text-lg mb-2 text-white">Import Mode (Always use your currently loaded nodes as examples)</h3>
            <div className="flex space-x-4 mb-4">
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  value="new_game"
                  checked={importMode === 'new_game'}
                  onChange={(e) => setImportMode(e.target.value as 'new_game' | 'merge_story')}
                  className="form-radio text-blue-600"
                />
                <span className="text-white">Create New Game</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  value="merge_story"
                  checked={importMode === 'merge_story'}
                  onChange={(e) => setImportMode(e.target.value as 'new_game' | 'merge_story')}
                  className="form-radio text-blue-600"
                />
                <span className="text-white">Merge with Existing Nodes</span>
              </label>
            </div>

            <div className="mb-4">
              <div className="flex items-center mb-2">
                <label className="text-white block">
                  Instructions for Data Extraction (First Prompt):
                </label>
                <div className="relative ml-2">
                  <button
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded"
                    onMouseEnter={(e) => {
                      const tooltip = e.currentTarget.nextElementSibling as HTMLElement;
                      if (tooltip) tooltip.style.display = 'block';
                    }}
                    onMouseLeave={(e) => {
                      const tooltip = e.currentTarget.nextElementSibling as HTMLElement;
                      if (tooltip) tooltip.style.display = 'none';
                    }}
                  >
                    View Prompt
                  </button>
                  <div className="hidden absolute z-50 w-[600px] left-0 mt-2 p-4 bg-gray-800 border border-gray-600 rounded shadow-lg max-w-[90vw]">
                    <pre className="whitespace-pre-wrap text-xs text-white font-mono">
                      {TWINE_DATA_EXTRACTION_PROMPT}
                    </pre>
                  </div>
                </div>
              </div>
              <textarea
                value={nextPromptInstructions}
                onChange={(e) => setNextPromptInstructions(e.target.value)}
                className="w-full p-2 border border-gray-700 rounded bg-gray-900 text-white"
                placeholder="Enter specific instructions for how to extract and structure data from the Twine story..."
                rows={3}
              />
            </div>

            <div className="mb-4">
              <div className="flex items-center mb-2">
                <label className="text-white block">
                  Instructions for Node Generation (Second Prompt):
                </label>
                <div className="relative ml-2">
                  <button
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded"
                    onMouseEnter={(e) => {
                      const tooltip = e.currentTarget.nextElementSibling as HTMLElement;
                      if (tooltip) tooltip.style.display = 'block';
                    }}
                    onMouseLeave={(e) => {
                      const tooltip = e.currentTarget.nextElementSibling as HTMLElement;
                      if (tooltip) tooltip.style.display = 'none';
                    }}
                  >
                    View Prompt
                  </button>
                  <div className="hidden absolute z-50 w-[600px] left-0 mt-2 p-4 bg-gray-800 border border-gray-600 rounded shadow-lg max-w-[90vw]">
                    <pre className="whitespace-pre-wrap text-xs text-white font-mono">
                      {importMode === 'new_game' ? TWINE_NODE_GENERATION_PROMPT_NEW_GAME : TWINE_NODE_GENERATION_PROMPT_MERGE}
                    </pre>
                  </div>
                </div>
              </div>
              <textarea
                value={secondPromptInstructions}
                onChange={(e) => setSecondPromptInstructions(e.target.value)}
                className="w-full p-2 border border-gray-700 rounded bg-gray-900 text-white"
                placeholder="Enter specific instructions for how to generate game nodes from the extracted data..."
                rows={3}
              />
            </div>

            <div className="flex items-center space-x-2 mb-4">
              <input
                type="checkbox"
                id="useAggressiveTrim"
                checked={useAggressiveTrim}
                onChange={(e) => setUseAggressiveTrim(e.target.checked)}
                className="form-checkbox h-5 w-5 text-blue-600"
              />
              <label htmlFor="useAggressiveTrim" className="text-white">
                Use Aggressive Content Trimming
              </label>
            </div>

            <div className="mb-4">
              <label className="text-white block mb-2">
                Middle Content Trim: {trimPercentage}%
              </label>
              <input
                type="range"
                min="0"
                max="95"
                value={trimPercentage}
                onChange={(e) => setTrimPercentage(Number(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        )}

        {rawContent && (
          <div className="mb-4">
            <h3 className="text-lg mb-2 text-white">Content Preview:</h3>
            <div className="flex space-x-4">
              <div className="flex-1">
                <h4 className="text-sm text-gray-400 mb-2">
                  Basic Content Extraction
                  <span className="ml-2 text-blue-400">
                    ({basicContent.length} characters)
                  </span>
                </h4>
                <textarea
                  value={basicContent}
                  readOnly
                  className="w-full h-[750px] p-2 border border-gray-700 rounded bg-gray-900 text-white font-mono text-sm"
                />
              </div>
              <div className="flex flex-col items-center justify-center px-4">
                <div className="text-sm text-gray-400">
                  {basicContent.length > 0 && (
                    <span className={`${aggressiveContent.length < basicContent.length ? 'text-red-400' : 'text-green-400'}`}>
                      {Math.round((1 - aggressiveContent.length / basicContent.length) * 100)}% reduction
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <h4 className="text-sm text-gray-400 mb-2">
                  Aggressive Content Extraction
                  <span className="ml-2 text-blue-400">
                    ({aggressiveContent.length} characters)
                  </span>
                </h4>
                <textarea
                  value={aggressiveContent}
                  readOnly
                  className="w-full h-[750px] p-2 border border-gray-700 rounded bg-gray-900 text-white font-mono text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {Object.keys(tagStats).length > 0 && (
          <div className="mb-4 p-4 bg-gray-800 rounded">
            <h3 className="text-lg mb-2 text-white">Tag Statistics:</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(tagStats)
                .sort(([, a], [, b]) => b - a)
                .map(([tag, count]) => (
                  <div key={tag} className="flex justify-between text-sm">
                    <span className="text-gray-300">{tag}:</span>
                    <span className="text-blue-400">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {error && <p className="text-red-500 mb-4">{error}</p>}

        <div className="mb-4">
          <label className="text-white block mb-2">
            Number of Parallel Extractions: {extractionCount}
            <span className="ml-2 text-blue-400">
              ({Math.ceil((useAggressiveTrim ? aggressiveContent.length : basicContent.length) / extractionCount)} characters per extraction)
            </span>
          </label>
          <input
            type="range"
            min="1"
            max="10"
            value={extractionCount}
            onChange={(e) => setExtractionCount(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <div className="flex justify-end space-x-4 sticky bottom-0 bg-slate-900 pt-4">
          <button
            onClick={closeOverlay}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleNext}
            disabled={!selectedContent || isLoading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Processing...' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TwineImportOverlay; 