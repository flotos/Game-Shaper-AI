import React, { useState } from 'react';
import { Node } from '../models/Node';

interface NodeGraphInterfaceProps {
  nodes: Node[];
}

const NodeGraphInterface: React.FC<NodeGraphInterfaceProps> = ({ nodes }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const handleNodeSelect = (node: Node) => {
    setSelectedNode(node);
  };

  return (
    <div className="w-1/2 p-4 flex flex-col space-y-4 relative overflow-y-auto">
      <div className="flex-grow overflow-y-auto grid grid-cols-2 gap-4">
        {nodes.map((node) => (
          <div key={node.id} className="relative cursor-pointer rounded overflow-hidden h-64">
            <img src={node.image} alt={node.name} className="w-full h-64 object-cover" onClick={() => handleNodeSelect(node)} />
            <div className="absolute bottom-0 left-0 w-full bg-black bg-opacity-70 text-white p-2 text-center">{node.name}</div>
          </div>
        ))}
      </div>
      {selectedNode && (
        <div className="absolute inset-0 bg-gray-900 bg-opacity-95 p-4 flex flex-col items-start text-white z-10 overflow-y-auto">
          <div className="max-h-full">
            <p className="text-xl font-bold break-all">{selectedNode.name}</p>
            <p className="break-all">{selectedNode.longDescription}</p>
            <p className="text-xs mt-5 break-all">Hidden Description: {selectedNode.rules}</p>
            <p className="text-xs break-all">Type: {selectedNode.type}</p>
            <p className="text-xs break-all">short description: {selectedNode.shortDescription}</p>
            <img src={selectedNode.image} alt={selectedNode.name} className="w-full object-contain max-h-[70vh] mt-4" />
          </div>
          <button className="mt-4 py-2 px-4 bg-red-900 rounded w-full" onClick={() => setSelectedNode(null)}>Close</button>
        </div>
      )}
    </div>
  );
};

export default NodeGraphInterface;
