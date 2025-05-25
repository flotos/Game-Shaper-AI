import React, { useState } from 'react';
import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import { moxusService } from '../services/MoxusService';
import { LLMNodeEditionResponse } from '../models/nodeOperations';

interface NodeEditorOverlayProps {
  nodes: Node[];
  addNode: (node: Node) => void;
  updateNode: (node: Node) => void;
  deleteNode: (nodeId: string) => void;
  closeOverlay: () => void;
  updateGraph: (
    nodeEdition: LLMNodeEditionResponse,
    imagePrompts?: { nodeId: string; prompt: string }[],
    chatHistory?: Message[],
    isFromUserInteraction?: boolean
  ) => Promise<void>;
  initialSelectedNodeId?: string;
}

const NodeEditorOverlay: React.FC<NodeEditorOverlayProps> = ({ nodes, addNode, updateNode, deleteNode, closeOverlay, updateGraph, initialSelectedNodeId }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(() => {
    if (initialSelectedNodeId) {
      return nodes.find(node => node.id === initialSelectedNodeId) || null;
    }
    return null;
  });
  const [isCreatingNewNode, setIsCreatingNewNode] = useState<boolean>(false);

  const generateRandomId = () => {
    return Math.random().toString(36).substring(2, 6);
  };

  const handleSave = () => {
    if (!selectedNode) return;

    const originalNode = nodes.find(n => n.id === selectedNode.id);
    
    updateNode(selectedNode);
    
    if (originalNode) {
      moxusService.recordManualNodeEdit(originalNode, selectedNode, 'Manual edit via node editor');
    } else {
      console.warn(`[NodeEditorOverlay] Could not find original node state for ID: ${selectedNode.id} to send to Moxus.`);
    }
    
    closeOverlay();
  };

  const handleDelete = () => {
    if (selectedNode) {
      const nodeEdition: LLMNodeEditionResponse = {
        callId: `delNodeManual-${selectedNode.id}-${Date.now()}`,
        d_nodes: [selectedNode.id]
      };
      updateGraph(nodeEdition, [], []);
      setSelectedNode(null);
      closeOverlay();
    }
  };

  const handleAddNew = () => {
    const newNode: Node = {
      id: generateRandomId(),
      name: 'new node',
      longDescription: '',
      image: '',
      type: 'Default',
      updateImage: true
    };
    
    addNode(newNode);
    setSelectedNode(newNode);
    setIsCreatingNewNode(true);
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-3/4 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl">{selectedNode ? 'Edit Node' : 'Add Node'}</h2>
          <button onClick={closeOverlay} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
            Close
          </button>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1">
            <label className="block text-gray-100 bg-grey-900 mb-2">Select Node to Edit:</label>
            <select
              value={selectedNode?.id || ''}
              onChange={(e) => {
                const node = nodes.find(n => n.id === e.target.value) || null;
                setSelectedNode(node);
                setIsCreatingNewNode(false);
              }}
              className="w-full p-2 border border-gray-700 rounded bg-gray-900"
            >
              <option value="">Select a node...</option>
              {nodes.map(node => (
                <option key={node.id} value={node.id}>{node.name}</option>
              ))}
            </select>
          </div>
          <button onClick={handleAddNew} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 whitespace-nowrap">
            Add New Node
          </button>
        </div>

        {selectedNode && (
          <div className="flex-1 overflow-y-auto">
            <div className="mb-4">
              <label className="block text-gray-100 bg-grey-900 mb-2">Node Name:</label>
              <input
                type="text"
                value={selectedNode.name}
                onChange={(e) => setSelectedNode({ ...selectedNode, name: e.target.value })}
                className="w-full p-2 border border-gray-700 rounded bg-gray-900"
              />
            </div>
            <div className="mb-4">
              <label className="block text-gray-100 bg-grey-900 mb-2">Long Description:</label>
              <textarea
                value={selectedNode.longDescription}
                onChange={(e) => setSelectedNode({ ...selectedNode, longDescription: e.target.value })}
                className="w-full p-2 border border-gray-700 rounded bg-gray-900"
                rows={10}
                style={{ minHeight: '200px' }}
              />
            </div>
            <div className="mb-4">
              <label className="block text-gray-100 bg-grey-900 mb-2">Node Type:</label>
              <input
                type="text"
                value={selectedNode.type}
                onChange={(e) => setSelectedNode({ ...selectedNode, type: e.target.value })}
                className="w-full p-2 border border-gray-700 rounded bg-gray-900"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-4 mt-4 pt-4 border-t border-gray-700">
          <button 
            onClick={handleSave} 
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            disabled={!selectedNode}
          >
            Save
          </button>
          {selectedNode && (
            <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeEditorOverlay;
