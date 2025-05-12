import React, { useState } from 'react';
import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import { moxusService } from '../services/MoxusService';

interface NodeEditorOverlayProps {
  nodes: Node[];
  addNode: (node: Node) => void;
  updateNode: (node: Node) => void;
  deleteNode: (nodeId: string) => void;
  closeOverlay: () => void;
  updateGraph: (nodeEdition: { 
    merge?: Partial<Node>[]; 
    delete?: string[];
    newNodes?: string[];
  }, 
  imagePrompts?: { nodeId: string; prompt: string }[],
  chatHistory?: Message[],
  isFromUserInteraction?: boolean
  ) => Promise<void>;
}

const NodeEditorOverlay: React.FC<NodeEditorOverlayProps> = ({ nodes, addNode, updateNode, deleteNode, closeOverlay, updateGraph }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [newNode, setNewNode] = useState<Partial<Node>>({});
  const [isCreatingNewNode, setIsCreatingNewNode] = useState<boolean>(false);

  const generateRandomId = () => {
    return Math.random().toString(36).substring(2, 6);
  };

  const handleSave = () => {
    if (selectedNode) {
      const originalNode = nodes.find(n => n.id === selectedNode.id);
      
      updateNode(selectedNode);
      
      if (originalNode) {
        moxusService.addTask('nodeEditFeedback', {
            before: originalNode, 
            after: selectedNode
        });
      } else {
        console.warn(`[NodeEditorOverlay] Could not find original node state for ID: ${selectedNode.id} to send to Moxus.`);
      }
      
    } else {
      // Create a complete Node object with all required fields
      const nodeWithId: Node = {
        id: generateRandomId(),
        name: newNode.name || 'New Node',
        rules: newNode.rules || '',
        longDescription: newNode.longDescription || '',
        image: newNode.image || '',
        type: newNode.type || 'Default',
        updateImage: true // Request image generation for new nodes
      };
      
      console.log('Adding new node:', nodeWithId);
      addNode(nodeWithId);
      
      // Optionally request image generation via updateGraph if needed
      if (!nodeWithId.image) {
        updateGraph(
          { 
            merge: [{ id: nodeWithId.id, updateImage: true }],
            newNodes: [nodeWithId.id]
          }, 
          [], 
          []
        ).catch(error => console.error('Failed to generate image for new node:', error));
      }
    }
    closeOverlay();
  };

  const handleDelete = () => {
    if (selectedNode) {
      updateGraph({ delete: [selectedNode.id] }, [], []);
      setSelectedNode(null);
      closeOverlay();
    }
  };

  const handleAddNew = () => {
    setSelectedNode(null);
    setNewNode({});
    setIsCreatingNewNode(true);
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-3/4">
        <h2 className="text-xl mb-4">{selectedNode ? 'Edit Node' : 'Add Node'}</h2>
        <div className="mb-4">
          <label className="block text-gray-100 bg-grey-900">Select Node to Edit:</label>
          <select
            value={selectedNode?.id || ''}
            onChange={(e) => {
              const node = nodes.find(n => n.id === e.target.value) || null;
              setSelectedNode(node);
              setNewNode({});
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
        <input
          type="text"
          placeholder="Name"
          value={selectedNode ? selectedNode.name : newNode.name || ''}
          onChange={(e) => selectedNode ? setSelectedNode({ ...selectedNode, name: e.target.value }) : setNewNode({ ...newNode, name: e.target.value })}
          className="w-full p-2 mb-4 border border-gray-700 rounded bg-gray-900"
        />
        <textarea
          placeholder="Long description"
          value={selectedNode ? selectedNode.longDescription : newNode.longDescription || ''}
          onChange={(e) => selectedNode ? setSelectedNode({ ...selectedNode, longDescription: e.target.value }) : setNewNode({ ...newNode, longDescription: e.target.value })}
          className="w-full p-2 mb-4 border border-gray-700 rounded bg-gray-900"
          rows={30}
          style={{ minHeight: '200px' }}
        />
        <textarea
          placeholder="Rules (will be hidden to players later on)"
          value={selectedNode ? selectedNode.rules : newNode.rules || ''}
          onChange={(e) => selectedNode ? setSelectedNode({ ...selectedNode, rules: e.target.value }) : setNewNode({ ...newNode, rules: e.target.value })}
          className="w-full p-2 mb-4 border border-gray-700 rounded bg-gray-900"
        />
        <div className="mb-4">
          <label className="block text-gray-100 bg-grey-900">Node Type:</label>
          <input
            type="text"
            placeholder="Enter node type"
            value={selectedNode ? selectedNode.type : newNode.type || ''}
            onChange={(e) => selectedNode ? setSelectedNode({ ...selectedNode, type: e.target.value }) : setNewNode({ ...newNode, type: e.target.value })}
            className="w-full p-2 border border-gray-700 rounded bg-gray-900"
          />
        </div>
        <div className="flex justify-between">
          <button 
            onClick={handleSave} 
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            disabled={selectedNode === null && !isCreatingNewNode}
          >
            Save
          </button>
          <button onClick={handleAddNew} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
            Add New Node
          </button>
          {selectedNode && (
            <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
              Delete
            </button>
          )}
          <button onClick={closeOverlay} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default NodeEditorOverlay;
