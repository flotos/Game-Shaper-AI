import React, { useState } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromPrompt } from '../services/LLMService';

interface NodeEditorOverlayProps {
  nodes: Node[];
  addNode: (node: Node) => void;
  updateNode: (node: Node) => void;
  deleteNode: (nodeId: string) => void;
  closeOverlay: () => void;
  updateGraph: (nodeEdition: { merge?: Partial<Node>[], delete?: string[] }) => void;
}

const NodeEditorOverlay: React.FC<NodeEditorOverlayProps> = ({ nodes, addNode, updateNode, deleteNode, closeOverlay, updateGraph }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [newNode, setNewNode] = useState<Partial<Node>>({});
  const [prompt, setPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const generateRandomId = () => {
    return Math.random().toString(36).substring(2, 6);
  };

  const handleSave = () => {
    if (selectedNode) {
      updateNode(selectedNode);
    } else {
      const nodeWithId: Node = {
        ...newNode,
        id: generateRandomId(),
        name: newNode.name || 'New Node',
        rules: newNode.rules || '',
        longDescription: newNode.longDescription || '',
        image: newNode.image || '',
        type: newNode.type || 'Default',
        parent: newNode.parent || '',
        child: newNode.child || []
      } as Node;
      addNode(nodeWithId);
    }
    closeOverlay();
  };

  const handleDelete = () => {
    if (selectedNode) {
      deleteNode(selectedNode.id);
      setSelectedNode(null);
    }
  };

  const handleGenerateNodes = async () => {
    setIsLoading(true);
    try {
      const queryOutput = await generateNodesFromPrompt(prompt, nodes);
      updateGraph(queryOutput);
      setIsLoading(false);
      closeOverlay();
    } catch (error) {
      console.error('Failed to generate nodes:', error);
      setIsLoading(false);
    }
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
        />
        <textarea
          placeholder="Rules (will be hidden to players later on)"
          value={selectedNode ? selectedNode.rules : newNode.rules || ''}
          onChange={(e) => selectedNode ? setSelectedNode({ ...selectedNode, rules: e.target.value }) : setNewNode({ ...newNode, rules: e.target.value })}
          className="w-full p-2 mb-4 border border-gray-700 rounded bg-gray-900"
        />
        <textarea
          placeholder="Prompt to generate nodes"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full p-2 mb-4 border border-gray-700 rounded bg-gray-900"
        />
        <div className="flex justify-between">
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Save
          </button>
          {selectedNode && (
            <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
              Delete
            </button>
          )}
          <button onClick={closeOverlay} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
            Cancel
          </button>
          <button 
            onClick={handleGenerateNodes} 
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center"
            disabled={isLoading}
          >
            {isLoading ? <div className="loader"></div> : 'Generate Nodes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NodeEditorOverlay;
