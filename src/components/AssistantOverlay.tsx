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
}

// Helper function to create diff spans
const createDiffSpans = (original: string, updated: string) => {
  const result: JSX.Element[] = [];
  let i = 0;
  let j = 0;
  
  while (i < original.length || j < updated.length) {
    if (i < original.length && j < updated.length && original[i] === updated[j]) {
      // Same character, add as normal
      result.push(<span key={`same-${i}`}>{original[i]}</span>);
      i++;
      j++;
    } else {
      // Different characters, handle deletions and additions
      if (i < original.length) {
        result.push(<span key={`del-${i}`} className="bg-red-900/50">{original[i]}</span>);
        i++;
      }
      if (j < updated.length) {
        result.push(<span key={`add-${j}`} className="bg-green-900/50">{updated[j]}</span>);
        j++;
      }
    }
  }
  
  return result;
};

// Helper function to calculate height based on content length
const calculateHeight = (text: string, isLongDescription: boolean = false, defaultRows: number = 10) => {
  if (!isLongDescription) return `${defaultRows * 1.5}rem`; // 1.5rem per row
  const lineCount = (text || '').split('\n').length;
  const minHeight = '25rem'; // Increased minimum height for long description
  const calculatedHeight = `${Math.max(25, lineCount * 2)}rem`; // 2rem per line, increased from 1.5rem
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
        originalNodes: nodes
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
    const diffSpans = createDiffSpans(original || '', updated || '');
    const height = calculateHeight(updated, isLongDescription, rows);
    
    return (
      <div className="relative" style={{ height }}>
        <textarea
          readOnly
          value={updated}
          className="w-full p-2 bg-gray-700 rounded text-white resize-none overflow-x-auto"
          style={{ height: '100%', overflowY: 'hidden' }}
        />
        <div 
          className="absolute inset-0 pointer-events-none p-2 whitespace-pre-wrap overflow-x-auto"
          style={{ height: '100%', overflowY: 'hidden' }}
        >
          {diffSpans}
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
                <textarea
                  readOnly
                  value={originalNode?.shortDescription || ''}
                  className="w-full p-2 bg-gray-700 rounded text-white resize-none"
                  rows={3}
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <textarea
                  readOnly
                  value={originalNode?.longDescription || ''}
                  className="w-full p-2 bg-gray-700 rounded text-white resize-none overflow-x-auto"
                  style={{ height: calculateHeight(originalNode?.longDescription || '', true), overflowY: 'hidden' }}
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                <textarea
                  readOnly
                  value={originalNode?.rules || ''}
                  className="w-full p-2 bg-gray-700 rounded text-white resize-none"
                  rows={5}
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <input
                  readOnly
                  value={originalNode?.type || ''}
                  className="w-full p-2 bg-gray-700 rounded text-white"
                />
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-1">New</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Short Description:</span>
                {renderDiffField(originalNode?.shortDescription || '', updatedNode.shortDescription || '', 3)}
              </div>
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                {renderDiffField(originalNode?.longDescription || '', updatedNode.longDescription || '', 10, true)}
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                {renderDiffField(originalNode?.rules || '', updatedNode.rules || '', 5)}
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                {renderDiffField(originalNode?.type || '', updatedNode.type || '', 1)}
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