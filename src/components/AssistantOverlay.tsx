import React, { useState } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromPrompt } from '../services/llm';
import { Message } from '../context/ChatContext';
import DiffViewer from './DiffViewer';
import { moxusService } from '../services/MoxusService';
import { LLMNodeEditionResponse, NodeSpecificUpdates } from '../models/nodeOperations';
import { regenerateSingleNode } from '../services/twineImportLLMService';

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
    newNodes?: Node[];
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

      const llmResponseData = await generateNodesFromPrompt(query, nodes, moxusMemoryData, moxusPersonalityData);
      
      setPreview({
        showPreview: true,
        llmResponse: llmResponseData,
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
      newEditedNodes.set(nodeId, { ...existingEdit, [field]: value });
      return { ...prev, editedNodes: newEditedNodes };
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
      
      // Create a minimal extractedData object for the regenerateSingleNode function
      const dummyExtractedData = { 
        chunks: [[]], 
      };
      
      // Use the prompt as node generation instructions
      const nodeGenerationInstructions = preview.prompt || '';
      
      // Call regenerateSingleNode from the twine import service
      const regeneratedNodeData = await regenerateSingleNode(
        nodeId,
        nodeToRegenerate,
        dummyExtractedData,
        nodes,
        'merge_story', // Always use merge mode in assistant
        nodeGenerationInstructions,
        nodeToRegenerate // Pass as the recently generated version
      );

      // Update the preview state with the regenerated node
      setPreview(prev => {
        if (!prev.llmResponse) return prev;
        
        const newLLMResponse = { ...prev.llmResponse };
        const userEdits = prev.editedNodes?.get(nodeId) || {};
        
        // Apply user edits on top of regenerated node data
        const finalNodeData = { ...regeneratedNodeData, ...userEdits };
        
        // Update either in merge array or add to it if not present
        if (newLLMResponse.merge) {
          const existingIndex = newLLMResponse.merge.findIndex(n => n.id === nodeId);
          if (existingIndex >= 0) {
            newLLMResponse.merge[existingIndex] = { 
              ...newLLMResponse.merge[existingIndex], 
              ...finalNodeData 
            };
          } else {
            newLLMResponse.merge.push({ id: nodeId, ...finalNodeData });
          }
        } else {
          newLLMResponse.merge = [{ id: nodeId, ...finalNodeData }];
        }
        
        return { 
          ...prev, 
          llmResponse: newLLMResponse
        };
      });
      
    } catch (err) {
      console.error('Error regenerating node:', err);
      setError(`Failed to regenerate node: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (preview.llmResponse) {
      const u_nodes: { [nodeId: string]: NodeSpecificUpdates } = {};
      
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
      
      const nodeEditionPayload: LLMNodeEditionResponse = {
        callId: `assistant-${Date.now()}`,
        u_nodes: Object.keys(u_nodes).length > 0 ? u_nodes : undefined,
        d_nodes: preview.llmResponse.delete?.length ? preview.llmResponse.delete : undefined,
        n_nodes: preview.llmResponse.newNodes?.length ? preview.llmResponse.newNodes : undefined,
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
        <div className="grid grid-cols-3 gap-4 mt-2">
          <div>
            <h4 className="text-sm font-semibold mb-1">Original</h4>
            {originalNode ? (
              <div className="text-sm space-y-2">
                <div>
                  <span className="font-semibold block mb-1">Long Description:</span>
                  <textarea readOnly value={originalNode.longDescription} className="w-full p-2 bg-gray-700/30 rounded text-gray-400 resize-none" style={{ height: calculateHeight(originalNode.longDescription, true), overflowY: 'auto' }} />
                </div>
                <div>
                  <span className="font-semibold block mb-1">Type:</span>
                  <input readOnly value={originalNode.type} className="w-full p-2 bg-gray-700/30 rounded text-gray-400" />
                </div>
              </div>
            ) : (
              <p className="text-gray-400 italic">New Node</p>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-1">AI Proposed</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <DiffViewer original={originalNode?.longDescription || ''} updated={suggestedNodeChange.longDescription || ''} isCurrent={false} className="w-full bg-gray-700/50" style={{ height: calculateHeight(suggestedNodeChange.longDescription || '', true), overflowY: 'auto' }} />
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <DiffViewer original={originalNode?.type || ''} updated={suggestedNodeChange.type || ''} isCurrent={false} className="w-full bg-gray-700/50" />
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
          {preview.llmResponse.delete && preview.llmResponse.delete.length > 0 && (
            <div className="mb-4 p-4 bg-red-900/50 rounded">
              <h3 className="text-lg font-bold mb-2">Nodes to be deleted:</h3>
              <ul className="list-disc list-inside">
                {preview.llmResponse.delete.map(id => {
                  const node = preview.originalNodes.find(n => n.id === id);
                  return <li key={id}>{node?.name || id}</li>;
                })}
              </ul>
            </div>
          )}
          {preview.llmResponse.newNodes && preview.llmResponse.newNodes.map(newNode => (
            renderNodeComparison(null, newNode)
          ))}
          {preview.llmResponse.merge && preview.llmResponse.merge.map(updatedNode => {
            const originalNode = preview.originalNodes.find(n => n.id === updatedNode.id) || null;
            return renderNodeComparison(originalNode, updatedNode);
          })}
          
          <div className="flex justify-end space-x-4 mt-4">
            <button onClick={() => setPreview({ showPreview: false, originalNodes: nodes, editedNodes: new Map() })} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">
              Back
            </button>
            <button onClick={handleConfirm} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
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
          <button onClick={closeOverlay} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isLoading || !query.trim()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {isLoading ? 'Processing...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssistantOverlay;