import React, { useState } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromPrompt } from '../services/llm';
import { Message } from '../context/ChatContext';
import DiffViewer from './DiffViewer';
import { moxusService } from '../services/MoxusService';
import { LLMNodeEditionResponse, NodeSpecificUpdates } from '../models/nodeOperations';
import { regenerateSingleNode } from '../services/twineImportLLMService';
import { AssistantPromptSelector } from './AssistantPromptSelector';

interface AssistantOverlayProps {
  nodes: Node[];
  updateGraph: (
    nodeEdition: LLMNodeEditionResponse,
    imagePrompts?: { nodeId: string; prompt: string }[],
    chatHistory?: Message[],
    isFromUserInteraction?: boolean
  ) => Promise<void>;
  closeOverlay: () => void;
}

interface PreviewState {
  showPreview: boolean;
  llmResponse?: {
    merge?: Partial<Node>[];
    delete?: string[];
    newNodes?: Partial<Node>[];
  };
  originalNodes: Node[];
  prompt?: string;
  editedNodes?: Map<string, Partial<Node>>;
  newNodesEdits?: Map<string, Partial<Node>>;
  deletedNodesConfirm?: Set<string>;
}

// Helper to calculate textarea height
const calculateHeight = (value: string, isLong = false) => {
  const numberOfLines = (value.match(/\n/g) || []).length + 1;
  const minHeight = isLong ? 100 : 40;
  return `${Math.max(minHeight, numberOfLines * 20)}px`;
};

const AssistantOverlay: React.FC<AssistantOverlayProps> = ({ nodes, updateGraph, closeOverlay }) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sendMoxusContext, setSendMoxusContext] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({
    showPreview: false,
    originalNodes: nodes,
    editedNodes: new Map<string, Partial<Node>>(),
    newNodesEdits: new Map<string, Partial<Node>>(),
    deletedNodesConfirm: new Set<string>()
  });

  const handlePromptSelect = (promptText: string) => {
    setQuery(promptText);
  };

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

      const llmResponseData = await generateNodesFromPrompt(query, nodes, moxusMemoryData, moxusPersonalityData);
      
      // Normalize response format to handle both old (merge) and new (u_nodes) formats
      const normalizedResponse = {
        merge: llmResponseData.merge || [],
        delete: llmResponseData.delete || [],
        newNodes: llmResponseData.newNodes || llmResponseData.n_nodes || [],
      };
      
      setPreview({
        showPreview: true,
        llmResponse: normalizedResponse,
        originalNodes: nodes,
        prompt: query,
        editedNodes: new Map<string, Partial<Node>>(),
        newNodesEdits: new Map<string, Partial<Node>>(),
        deletedNodesConfirm: new Set<string>()
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
      const newEditedNodes = new Map(prev.editedNodes || new Map<string, Partial<Node>>());
      const existingEdit = newEditedNodes.get(nodeId) || {};
      newEditedNodes.set(nodeId, { ...existingEdit, [field]: value });
      return { ...prev, editedNodes: newEditedNodes };
    });
  };

  const handleNewNodeEdit = (nodeId: string, field: keyof Node, value: string | boolean) => {
    setPreview(prev => {
      const newNodesEdits = new Map(prev.newNodesEdits || new Map<string, Partial<Node>>());
      const existingEdit = newNodesEdits.get(nodeId) || {};
      newNodesEdits.set(nodeId, { ...existingEdit, [field]: value });
      return { ...prev, newNodesEdits: newNodesEdits };
    });
  };

  const toggleDeleteConfirmation = (nodeId: string) => {
    setPreview(prev => {
      const newDeletedNodesConfirm = new Set(prev.deletedNodesConfirm || new Set<string>());
      if (newDeletedNodesConfirm.has(nodeId)) {
        newDeletedNodesConfirm.delete(nodeId);
      } else {
        newDeletedNodesConfirm.add(nodeId);
      }
      return { ...prev, deletedNodesConfirm: newDeletedNodesConfirm };
    });
  };

  const handleRegenerateNode = async (nodeId: string) => {
    if (!preview.llmResponse) {
      setError("No preview data available for regeneration.");
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      // Get the node to regenerate (either from merge or original nodes)
      const nodeToRegenerate = preview.llmResponse.merge?.find(n => n.id === nodeId) || 
                              nodes.find(n => n.id === nodeId);
      
      if (!nodeToRegenerate) {
        throw new Error('Node not found for regeneration');
      }
      
      // Use the prompt as node generation instructions
      const nodeGenerationInstructions = preview.prompt || '';
      
      // Call regenerateSingleNode from the twine import service
      const regeneratedNodeData = await regenerateSingleNode(
        nodeId,
        nodes, // Pass all nodes, not just the one to regenerate
        [], // Empty extracted data since we're not using Twine content
        nodeGenerationInstructions,
        JSON.stringify(nodeToRegenerate) // Pass the node details as a string
      );
      
      // Update the preview state with the regenerated node data
      setPreview(prev => {
        if (!prev.llmResponse) return prev;
        
        // Create new arrays to avoid mutating state directly
        const newMerge = [...(prev.llmResponse.merge || [])];
        
        // Find the index of the node in the merge array
        const nodeIndex = newMerge.findIndex(n => n.id === nodeId);
        
        if (nodeIndex !== -1) {
          // Replace the node with regenerated version
          newMerge[nodeIndex] = regeneratedNodeData;
        } else {
          // Add it to the merge array if not found
          newMerge.push(regeneratedNodeData);
        }
        
        return {
          ...prev,
          llmResponse: {
            ...prev.llmResponse,
            merge: newMerge
          }
        };
      });
    } catch (err) {
      setError('Failed to regenerate node. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerateNewNode = async (nodeIndex: number) => {
    if (!preview.llmResponse || !preview.llmResponse.newNodes) {
      setError("No preview data available for regeneration.");
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const nodeToRegenerate = preview.llmResponse.newNodes[nodeIndex];
      
      if (!nodeToRegenerate) {
        throw new Error('New node not found for regeneration');
      }
      
      // Use the prompt as node generation instructions
      const nodeGenerationInstructions = preview.prompt || '';
      
      // Temporarily assign an ID for regeneration
      const tempNodeId = `temp-new-${nodeIndex}`;
      const nodeWithId: Node = { 
        id: tempNodeId,
        name: nodeToRegenerate.name || 'New Node',
        longDescription: nodeToRegenerate.longDescription || '',
        type: nodeToRegenerate.type || 'unknown',
        image: nodeToRegenerate.image || ''
      };
      
      // Call regenerateSingleNode from the twine import service
      const regeneratedNodeData = await regenerateSingleNode(
        tempNodeId,
        [...nodes, nodeWithId], // Add the temporary node to the nodes list
        [], // Empty extracted data since we're not using Twine content
        nodeGenerationInstructions,
        JSON.stringify(nodeWithId) // Pass the node details as a string
      );
      
      // Update the preview state with the regenerated node data
      setPreview(prev => {
        if (!prev.llmResponse || !prev.llmResponse.newNodes) return prev;
        
        // Create new arrays to avoid mutating state directly
        const newNodes = [...prev.llmResponse.newNodes];
        
        // Replace the node with regenerated version (without the temp id)
        const { id, ...nodeWithoutId } = regeneratedNodeData;
        newNodes[nodeIndex] = nodeWithoutId;
        
        return {
          ...prev,
          llmResponse: {
            ...prev.llmResponse,
            newNodes: newNodes
          }
        };
      });
    } catch (err) {
      setError('Failed to regenerate new node. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (preview.llmResponse) {
      const u_nodes: { [nodeId: string]: NodeSpecificUpdates } = {};
      
      // Process updated nodes
      if (preview.llmResponse.merge) {
        preview.llmResponse.merge.forEach(suggestedNodeUpdate => {
          if (suggestedNodeUpdate.id) {
            const userEdits = preview.editedNodes?.get(suggestedNodeUpdate.id) || {};
            const finalUpdate = { ...suggestedNodeUpdate, ...userEdits };
            const updateOps: NodeSpecificUpdates = {};
            let hasChanges = false;

            Object.keys(finalUpdate).forEach(key => {
              if (key === 'id') return;
              if (key === 'updateImage') {
                if (finalUpdate.updateImage) updateOps.img_upd = true;
                hasChanges = true;
                return;
              }
              (updateOps as any)[key] = { rpl: (finalUpdate as any)[key] };
              hasChanges = true;
            });
            if (hasChanges) {
                u_nodes[suggestedNodeUpdate.id] = updateOps;
            }
          }
        });
      }
      
      // Process new nodes with user edits
      const n_nodes: Partial<Node>[] = preview.llmResponse.newNodes ? [...preview.llmResponse.newNodes] : [];
      if (preview.newNodesEdits && preview.newNodesEdits.size > 0 && n_nodes.length > 0) {
        for (let i = 0; i < n_nodes.length; i++) {
          const nodeId = `new-${i}`;
          const userEdits = preview.newNodesEdits.get(nodeId) || {};
          n_nodes[i] = { ...n_nodes[i], ...userEdits };
        }
      }
      
      // Process nodes to delete (filter to only include confirmed deletions)
      let d_nodes = preview.llmResponse.delete ? [...preview.llmResponse.delete] : [];
      if (preview.deletedNodesConfirm && preview.deletedNodesConfirm.size > 0) {
        d_nodes = d_nodes.filter(nodeId => preview.deletedNodesConfirm?.has(nodeId));
      } else {
        // If user didn't confirm any deletions, don't delete anything
        d_nodes = [];
      }
      
      const nodeEditionPayload: LLMNodeEditionResponse = {
        callId: `assistant-${Date.now()}`,
        u_nodes: Object.keys(u_nodes).length > 0 ? u_nodes : undefined,
        d_nodes: d_nodes.length > 0 ? d_nodes : undefined,
        n_nodes: n_nodes.length > 0 ? n_nodes.map(node => ({
          id: node.id || `new-node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: node.name || "New Node",
          longDescription: node.longDescription || "",
          type: node.type || "unknown",
          updateImage: node.updateImage || false,
          image: "" // Required by the Node interface, will be generated based on updateImage flag
        })) : undefined,
      };

      try {
        await updateGraph(nodeEditionPayload, undefined, undefined, false);
        
        closeOverlay();
        moxusService.addTask('assistantFeedback', {
          query: preview.prompt,
          result: nodeEditionPayload 
        });
      } catch (error) {
        console.error("Error updating graph or adding Moxus task:", error);
        setError('Failed to apply changes. Please try again.');
      }
    }
  };

  const renderNodeComparison = (originalNode: Node | null, suggestedNodeChange: Partial<Node>) => {
    const nodeId = suggestedNodeChange.id || '';
    if (!nodeId) return null;

    const userEditsForThisNode = preview.editedNodes?.get(nodeId) || {};

    const currentName = userEditsForThisNode.name ?? suggestedNodeChange.name ?? originalNode?.name ?? '';
    const currentLongDescription = userEditsForThisNode.longDescription ?? suggestedNodeChange.longDescription ?? originalNode?.longDescription ?? '';
    const currentType = userEditsForThisNode.type ?? suggestedNodeChange.type ?? originalNode?.type ?? '';
    const currentUpdateImage = userEditsForThisNode.updateImage ?? suggestedNodeChange.updateImage ?? false;
    
    return (
      <div key={nodeId} className="mb-4 p-4 bg-gray-800 rounded">
        <h3 className="text-lg font-bold mb-2 text-white">{currentName} (ID: {nodeId})</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-1">Original</h4>
            {originalNode ? (
              <div className="text-sm space-y-2">
                <div>
                  <span className="font-semibold block mb-1">Name:</span>
                  <p className="p-2 bg-gray-700 rounded text-white">{originalNode.name}</p>
                </div>
                <div>
                  <span className="font-semibold block mb-1">Long Description:</span>
                  <p className="p-2 bg-gray-700 rounded text-white whitespace-pre-wrap" style={{ height: calculateHeight(originalNode.longDescription || '', true), overflowY: 'auto' }}>{originalNode.longDescription}</p>
                </div>
                <div>
                  <span className="font-semibold block mb-1">Type:</span>
                  <p className="p-2 bg-gray-700 rounded text-white">{originalNode.type}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 italic p-2">No original node (new node)</p>
            )}
          </div>
          
          <div>
            <h4 className="text-sm font-semibold mb-1">Suggested Updates</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Name:</span>
                <DiffViewer original={originalNode?.name || ''} updated={suggestedNodeChange.name || ''} isCurrent={false} />
              </div>
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <DiffViewer original={originalNode?.longDescription || ''} updated={suggestedNodeChange.longDescription || ''} isCurrent={false} />
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <DiffViewer original={originalNode?.type || ''} updated={suggestedNodeChange.type || ''} isCurrent={false} />
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="text-sm font-semibold mb-1">Final Edit</h4>
            <div className="text-sm space-y-2">
               <div>
                <span className="font-semibold block mb-1">Name:</span>
                <input type="text" value={currentName} onChange={(e) => handleNodeEdit(nodeId, 'name', e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white" placeholder="Node Name"/>
              </div>
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <textarea value={currentLongDescription} onChange={(e) => handleNodeEdit(nodeId, 'longDescription', e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white resize-none" style={{ height: calculateHeight(currentLongDescription || '', true), overflowY: 'auto' }} placeholder="Enter long description..."/>
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <input type="text" value={currentType} onChange={(e) => handleNodeEdit(nodeId, 'type', e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white" placeholder="Enter type..."/>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between items-center space-x-4">
          <div>
            <span className="font-semibold block mb-1 text-sm">Image Generation:</span>
            <div className="flex items-center space-x-2">
              <button onClick={() => handleNodeEdit(nodeId, 'updateImage', !currentUpdateImage)} className={`px-3 py-1 rounded text-sm ${currentUpdateImage ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'} text-white transition-colors`}>
                {currentUpdateImage ? 'Will generate image' : 'No image generation'}
              </button>
              <span className="text-xs text-gray-400">(Click to toggle)</span>
            </div>
          </div>
          <button onClick={() => handleRegenerateNode(nodeId)} disabled={isLoading} className={`px-4 py-2 rounded text-sm ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
            {isLoading ? 'Processing...' : 'Regenerate Node'}
          </button>
        </div>
      </div>
    );
  };

  const renderNewNodeEditor = (newNode: Partial<Node>, index: number) => {
    const nodeId = `new-${index}`;
    const userEditsForThisNode = preview.newNodesEdits?.get(nodeId) || {};

    const currentName = userEditsForThisNode.name ?? newNode.name ?? '';
    const currentLongDescription = userEditsForThisNode.longDescription ?? newNode.longDescription ?? '';
    const currentType = userEditsForThisNode.type ?? newNode.type ?? '';
    const currentUpdateImage = userEditsForThisNode.updateImage ?? newNode.updateImage ?? false;
    
    return (
      <div key={nodeId} className="mb-4 p-4 bg-green-900/50 rounded">
        <h3 className="text-lg font-bold mb-2 text-white">New Node: {currentName}</h3>
        
        <div className="text-sm space-y-2">
          <div>
            <span className="font-semibold block mb-1">Name:</span>
            <input type="text" value={currentName} onChange={(e) => handleNewNodeEdit(nodeId, 'name', e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white" placeholder="Node Name"/>
          </div>
          <div>
            <span className="font-semibold block mb-1">Long Description:</span>
            <textarea value={currentLongDescription} onChange={(e) => handleNewNodeEdit(nodeId, 'longDescription', e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white resize-none" style={{ height: calculateHeight(currentLongDescription || '', true), overflowY: 'auto' }} placeholder="Enter long description..."/>
          </div>
          <div>
            <span className="font-semibold block mb-1">Type:</span>
            <input type="text" value={currentType} onChange={(e) => handleNewNodeEdit(nodeId, 'type', e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white" placeholder="Enter type..."/>
          </div>
        </div>
        
        <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between items-center space-x-4">
          <div>
            <span className="font-semibold block mb-1 text-sm">Image Generation:</span>
            <div className="flex items-center space-x-2">
              <button onClick={() => handleNewNodeEdit(nodeId, 'updateImage', !currentUpdateImage)} className={`px-3 py-1 rounded text-sm ${currentUpdateImage ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'} text-white transition-colors`}>
                {currentUpdateImage ? 'Will generate image' : 'No image generation'}
              </button>
              <span className="text-xs text-gray-400">(Click to toggle)</span>
            </div>
          </div>
          <button onClick={() => handleRegenerateNewNode(index)} disabled={isLoading} className={`px-4 py-2 rounded text-sm ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
            {isLoading ? 'Processing...' : 'Regenerate Node'}
          </button>
        </div>
      </div>
    );
  };

  const renderNodeToDelete = (nodeId: string) => {
    const node = preview.originalNodes.find(n => n.id === nodeId);
    const isConfirmed = preview.deletedNodesConfirm?.has(nodeId) || false;
    
    if (!node) return null;
    
    return (
      <div key={nodeId} className="mb-4 p-4 bg-red-900/50 rounded">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-bold mb-2 text-white">{node.name} (ID: {nodeId})</h3>
            <p className="text-sm text-gray-300 mb-2">Type: {node.type}</p>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{node.longDescription}</p>
          </div>
          <button 
            onClick={() => toggleDeleteConfirmation(nodeId)} 
            className={`px-4 py-2 rounded text-sm ${isConfirmed ? 'bg-red-700 hover:bg-red-800' : 'bg-gray-600 hover:bg-gray-700'} text-white ml-4`}
          >
            {isConfirmed ? 'Deletion Confirmed' : 'Confirm Deletion'}
          </button>
        </div>
      </div>
    );
  };

  if (preview.showPreview && preview.llmResponse) {
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
          
          {preview.llmResponse.newNodes && preview.llmResponse.newNodes.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-bold mb-2 text-white">New Nodes to Create:</h3>
              {preview.llmResponse.newNodes.map((newNode, index) => renderNewNodeEditor(newNode, index))}
            </div>
          )}
          
          {preview.llmResponse.delete && preview.llmResponse.delete.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-bold mb-2 text-white">Nodes to Delete (requires confirmation):</h3>
              {preview.llmResponse.delete.map(nodeId => renderNodeToDelete(nodeId))}
            </div>
          )}
          
          {preview.llmResponse.merge && preview.llmResponse.merge.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-bold mb-2 text-white">Nodes to Update:</h3>
              {preview.llmResponse.merge.map(updatedNode => {
                const originalNode = preview.originalNodes.find(n => n.id === updatedNode.id) || null;
                return renderNodeComparison(originalNode, updatedNode);
              })}
            </div>
          )}
          
          <div className="flex justify-between mt-6">
            <button onClick={closeOverlay} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded">
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={isLoading} className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
              {isLoading ? 'Processing...' : 'Apply Changes'}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-800/50 text-white rounded">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-5/6 max-w-4xl">
        <h2 className="text-xl mb-4 text-white">Assistant</h2>
        
        <div className="mb-4">
          <AssistantPromptSelector onPromptSelect={handlePromptSelect} />
        </div>
        
        <textarea
          className="w-full p-3 bg-gray-800 text-white rounded mb-4"
          placeholder="Describe what changes you want to make to the game..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={6}
        />
        
        <div className="flex items-center mb-4">
          <input
            type="checkbox"
            id="moxus-context-checkbox"
            checked={sendMoxusContext}
            onChange={() => setSendMoxusContext(!sendMoxusContext)}
            className="mr-2"
          />
          <label htmlFor="moxus-context-checkbox" className="text-white text-sm">
            Include Moxus context for better AI responses
          </label>
        </div>
        
        <div className="flex justify-between">
          <button
            onClick={closeOverlay}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !query.trim()}
            className={`px-4 py-2 rounded ${
              isLoading || !query.trim() ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'
            } text-white`}
          >
            {isLoading ? 'Processing...' : 'Generate'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-800/50 text-white rounded">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default AssistantOverlay;