import React, { useState } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromPrompt } from '../services/LLMService';

interface AssistantOverlayProps {
  nodes: Node[];
  updateGraph: (nodeEdition: { merge?: Partial<Node>[], delete?: string[] }) => void;
  closeOverlay: () => void;
}

interface PreviewState {
  showPreview: boolean;
  changes?: {
    merge?: Partial<Node>[];
    delete?: string[];
  };
  originalNodes: Node[];
  prompt?: string;
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

const AssistantOverlay: React.FC<AssistantOverlayProps> = ({ nodes, updateGraph, closeOverlay }) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewState>({
    showPreview: false,
    originalNodes: nodes
  });

  const handleSubmit = async () => {
    if (!query.trim()) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const response = await generateNodesFromPrompt(query, nodes);
      setPreview({
        showPreview: true,
        changes: response,
        originalNodes: nodes,
        prompt: query
      });
    } catch (err) {
      setError('Failed to process your request. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (preview.changes) {
      updateGraph(preview.changes);
      closeOverlay();
    }
  };

  const renderDiffField = (original: string, updated: string, rows: number, isLongDescription: boolean = false) => {
    return (
      <div className="relative">
        <div
          className="w-full p-2 bg-gray-700 rounded text-white resize-none overflow-x-auto whitespace-pre-wrap"
          style={{ 
            height: calculateHeight(updated, isLongDescription, rows),
            overflowY: 'auto'
          }}
        >
          {createDiffSpans(original, updated, false)}
        </div>
      </div>
    );
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
                <span className="font-semibold block mb-1">Short Description:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ height: '4.5rem', overflowY: 'auto' }}
                  >
                    {createDiffSpans(originalNode?.shortDescription || '', updatedNode.shortDescription || '', true)}
                  </div>
                </div>
              </div>
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
                <span className="font-semibold block mb-1">Short Description:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ height: '4.5rem', overflowY: 'auto' }}
                  >
                    {createDiffSpans(originalNode?.shortDescription || '', updatedNode.shortDescription || '', false)}
                  </div>
                </div>
              </div>
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

  if (preview.showPreview && preview.changes) {
    return (
      <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
        <div className="bg-slate-900 p-6 rounded shadow-md w-5/6 max-w-[100vw] max-h-[95vh] overflow-y-auto">
          <h2 className="text-xl mb-4 text-white">Preview Changes</h2>
          
          {preview.prompt && (
            <div className="mb-4 p-4 bg-gray-800 rounded">
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Your Request:</h3>
              <p className="text-white whitespace-pre-wrap">{preview.prompt}</p>
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
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-3/4 max-w-2xl">
        <h2 className="text-xl mb-4 text-white">Game Assistant</h2>
        <p className="text-gray-300 mb-4">
          Ask the assistant to modify your game. Examples:
          <ul className="list-disc list-inside mt-2 text-gray-400">
            <li>Make the game more challenging</li>
            <li>Change the story to be more like a fantasy adventure</li>
            <li>Add more puzzle elements</li>
          </ul>
        </p>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter your request here..."
          className="w-full p-2 mb-4 border border-gray-700 rounded bg-gray-900 text-white min-h-[100px]"
        />
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <div className="flex justify-end space-x-4">
          <button
            onClick={closeOverlay}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !query.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Processing...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssistantOverlay; 