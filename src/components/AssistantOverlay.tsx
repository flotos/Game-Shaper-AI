import React, { useState } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromPrompt } from '../services/llm';
import { Message } from '../context/ChatContext';
import DiffViewer from './DiffViewer';
import { moxusService } from '../services/MoxusService';

interface AssistantOverlayProps {
  nodes: Node[];
  updateGraph: (nodeEdition: { 
    merge?: Partial<Node>[]; 
    delete?: string[];
    newNodes?: string[];
  }, 
  imagePrompts?: { nodeId: string; prompt: string }[],
  chatHistory?: Message[],
  isFromUserInteraction?: boolean
  ) => Promise<void>;
  closeOverlay: () => void;
}

interface PreviewState {
  showPreview: boolean;
  changes?: {
    merge?: Partial<Node>[];
    delete?: string[];
    appendEnd?: Partial<Node>[];
  };
  originalNodes: Node[];
  prompt?: string;
  editedNodes?: Map<string, Partial<Node>>;
}

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
  const [sendMoxusContext, setSendMoxusContext] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({
    showPreview: false,
    originalNodes: nodes,
    editedNodes: new Map()
  });

  const handleSubmit = async () => {
    if (!query.trim()) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      let moxusMemoryData: { general?: string; chatText?: string; nodeEdition?: string; } | undefined = undefined;
      let moxusPersonalityData: string | undefined = undefined;

      if (sendMoxusContext) {
        const fullMoxusMemory = moxusService.getMoxusMemory();
        if (fullMoxusMemory) {
          moxusMemoryData = {
            general: fullMoxusMemory.GeneralMemory,
            chatText: fullMoxusMemory.featureSpecificMemory?.chatText,
            nodeEdition: fullMoxusMemory.featureSpecificMemory?.nodeEdition,
          };
        }
        moxusPersonalityData = moxusService.getMoxusPersonalityContext();
      }

      const response = await generateNodesFromPrompt(query, nodes, moxusMemoryData, moxusPersonalityData);
      const changesWithImageFlag = {
        ...response,
        merge: response.merge?.map((node: Partial<Node>) => ({ ...node, updateImage: node.updateImage ?? false }))
      };
      setPreview({
        showPreview: true,
        changes: changesWithImageFlag,
        originalNodes: nodes,
        prompt: query,
        editedNodes: new Map()
      });
    } catch (err) {
      setError('Failed to process your request. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNodeEdit = (nodeId: string, field: keyof Node, value: string | boolean) => {
    setPreview(prev => {
      const newEditedNodes = new Map(prev.editedNodes || new Map());
      const existingEdit = newEditedNodes.get(nodeId) || {};
      
      newEditedNodes.set(nodeId, {
        ...existingEdit,
        [field]: value
      });

      return {
        ...prev,
        editedNodes: newEditedNodes
      };
    });
  };

  const handleRegenerateNode = async (nodeId: string) => {
    console.log(`Regenerate node ${nodeId} - Placeholder action`);
    setError(`Regeneration for node ${nodeId} is not yet implemented.`);
    // TODO: Implement regeneration logic if needed for the assistant context.
    // This might involve calling generateNodesFromPrompt again with specific instructions
    // or a dedicated backend endpoint.
  };

  const handleConfirm = async () => {
    if (preview.changes) {
      const finalMerge = preview.changes.merge?.map(node => {
        const editedNode = preview.editedNodes?.get(node.id || '');
        if (!editedNode) return node;

        return {
          ...node,
          ...editedNode,
        };
      }) || [];

      const finalChanges = {
        merge: finalMerge,
        delete: preview.changes.delete || [],
        newNodes: [] // Assuming generateNodesFromPrompt result structure
      };

      try {
        // Call updateGraph with only the necessary nodeEdition.
        // Let useNodeGraph handle image prompts based on flags and chat history from context.
        // Explicitly pass false for isFromUserInteraction to prevent sorting
        await updateGraph(finalChanges, undefined, undefined, false); 
        
        closeOverlay();
        // Add Moxus task after closing the overlay
        moxusService.addTask('assistantFeedback', {
          query: preview.prompt,
          result: finalChanges
        });
      } catch (error) {
        console.error("Error updating graph or adding Moxus task:", error);
        setError('Failed to apply changes. Please try again.');
      }
    }
  };

  const renderDiffField = (original: string, updated: string, rows: number, isLongDescription: boolean = false) => {
    return (
      <div className="relative">
        <DiffViewer
          original={original}
          updated={updated}
          isCurrent={false}
          className="w-full"
          style={{ 
            height: calculateHeight(updated, isLongDescription, rows),
            overflowY: 'auto'
          }}
        />
      </div>
    );
  };

  const renderNodeComparison = (originalNode: Node | null, updatedNode: Partial<Node>) => {
    const nodeId = updatedNode.id || '';
    const editedNode = preview.editedNodes?.get(nodeId) || {};

    // Determine the current values for the edit column, considering edits
    const currentName = editedNode.name ?? updatedNode.name ?? '';
    const currentLongDescription = editedNode.longDescription ?? updatedNode.longDescription ?? '';
    const currentRules = editedNode.rules ?? updatedNode.rules ?? '';
    const currentType = editedNode.type ?? updatedNode.type ?? '';
    const currentUpdateImage = editedNode.updateImage ?? updatedNode.updateImage ?? false;

    if (!nodeId) return null;

    return (
      <div className="mb-4 p-4 bg-gray-800 rounded">
        {/* Node Name - Display Only (Edit below) */}
        <h3 className="text-lg font-bold mb-2 text-white">{updatedNode.name} (ID: {nodeId})</h3>
        
        <div className="grid grid-cols-3 gap-4 mt-2"> 
          {/* Column 1: Current State (Read-only Diff vs AI proposal) */}
          <div>
            <h4 className="text-sm font-semibold mb-1">Current</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <DiffViewer
                  original={originalNode?.longDescription || ''}
                  updated={updatedNode.longDescription || ''} // Show original proposed change for diff
                  isCurrent={true}
                  className="w-full bg-gray-700/50"
                  style={{ 
                    height: calculateHeight(originalNode?.longDescription || '', true),
                    overflowY: 'auto'
                  }}
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                <DiffViewer
                  original={originalNode?.rules || ''}
                  updated={updatedNode.rules || ''} // Show original proposed change for diff
                  isCurrent={true}
                  className="w-full bg-gray-700/50"
                  style={{ height: '7.5rem', overflowY: 'auto' }}
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <DiffViewer
                  original={originalNode?.type || ''}
                  updated={updatedNode.type || ''} // Show original proposed change for diff
                  isCurrent={true}
                  className="w-full bg-gray-700/50"
                />
              </div>
            </div>
          </div>

          {/* Column 2: New State (Read-only Diff vs Original) */}
          <div>
            <h4 className="text-sm font-semibold mb-1">New (AI Proposed)</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                 <DiffViewer
                  original={originalNode?.longDescription || ''} // Compare AI proposal to original
                  updated={updatedNode.longDescription || ''}
                  isCurrent={false} // Show additions in green
                  className="w-full bg-gray-700/50"
                  style={{ 
                    height: calculateHeight(updatedNode.longDescription || '', true),
                    overflowY: 'auto'
                  }}
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                 <DiffViewer
                  original={originalNode?.rules || ''} // Compare AI proposal to original
                  updated={updatedNode.rules || ''}
                  isCurrent={false} // Show additions in green
                  className="w-full bg-gray-700/50"
                  style={{ height: '7.5rem', overflowY: 'auto' }}
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                 <DiffViewer
                  original={originalNode?.type || ''} // Compare AI proposal to original
                  updated={updatedNode.type || ''}
                  isCurrent={false} // Show additions in green
                  className="w-full bg-gray-700/50"
                />
              </div>
            </div>
          </div>
          
          {/* Column 3: Editable Fields */}
          <div>
            <h4 className="text-sm font-semibold mb-1">Edit</h4>
            <div className="text-sm space-y-2">
               <div>
                <span className="font-semibold block mb-1">Name:</span>
                <input
                  type="text"
                  value={currentName}
                  onChange={(e) => handleNodeEdit(nodeId, 'name', e.target.value)}
                  className="w-full p-2 bg-gray-700 rounded text-white"
                  placeholder="Node Name"
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <textarea
                  value={currentLongDescription}
                  onChange={(e) => handleNodeEdit(nodeId, 'longDescription', e.target.value)}
                  className="w-full p-2 bg-gray-700 rounded text-white resize-none"
                  style={{ 
                    height: calculateHeight(currentLongDescription || '', true),
                    overflowY: 'auto'
                  }}
                  placeholder="Enter long description..."
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                <textarea
                  value={currentRules}
                  onChange={(e) => handleNodeEdit(nodeId, 'rules', e.target.value)}
                  className="w-full p-2 bg-gray-700 rounded text-white resize-none"
                  style={{ height: '7.5rem', overflowY: 'auto' }}
                  placeholder="Enter rules..."
                />
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <input
                  type="text"
                  value={currentType}
                  onChange={(e) => handleNodeEdit(nodeId, 'type', e.target.value)}
                  className="w-full p-2 bg-gray-700 rounded text-white"
                  placeholder="Enter type..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons - Moved below the grid */}
        <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between items-center space-x-4">
          {/* Image Generation Toggle */}
          <div>
            <span className="font-semibold block mb-1 text-sm">Image Generation:</span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleNodeEdit(nodeId, 'updateImage', !currentUpdateImage)}
                className={`px-3 py-1 rounded text-sm ${currentUpdateImage
                  ? 'bg-green-600 hover:bg-green-700' 
                  : 'bg-gray-600 hover:bg-gray-700'
                } text-white transition-colors`}
              >
                {currentUpdateImage ? 'Will generate image' : 'No image generation'}
              </button>
              <span className="text-xs text-gray-400">
                (Click to toggle)
              </span>
            </div>
          </div>

          {/* Regenerate Button */}
          <button
            onClick={() => handleRegenerateNode(nodeId)}
            disabled={isLoading} // Disable if any loading is happening
            className={`px-4 py-2 rounded text-sm ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
          >
            {isLoading ? 'Processing...' : 'Regenerate Node'}
          </button>
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

          {preview.changes.appendEnd && preview.changes.appendEnd.map(nodeToAppend => {
            const originalNode = preview.originalNodes.find(n => n.id === nodeToAppend.id) || null;
            if (!originalNode) return null;
            
            const previewNode = {
              ...originalNode,
              longDescription: originalNode.longDescription + (nodeToAppend.longDescription || ''),
              rules: originalNode.rules + (nodeToAppend.rules || ''),
              name: originalNode.name + (nodeToAppend.name || ''),
              type: originalNode.type + (nodeToAppend.type || '')
            };
            
            return (
              <div key={nodeToAppend.id} className="mb-4 p-4 bg-blue-900/50 rounded">
                <h3 className="text-lg font-bold mb-2">Appending to: {originalNode.name}</h3>
                {renderNodeComparison(originalNode, previewNode)}
              </div>
            );
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
        <div className="flex justify-end items-center space-x-4">
          {/* Toggle for sending Moxus context */}
          <div className="flex items-center space-x-2">
            <label htmlFor="sendMoxusContextToggle" className="text-sm text-gray-300">
              Send Moxus Context:
            </label>
            <button
              id="sendMoxusContextToggle"
              onClick={() => setSendMoxusContext(!sendMoxusContext)}
              className={`px-3 py-1 rounded text-sm transition-colors ${sendMoxusContext ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'} text-white`}
            >
              {sendMoxusContext ? 'Enabled' : 'Disabled'}
            </button>
          </div>
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