import React, { useState, useEffect } from 'react';
import { Node } from '../models/Node';
import ReactMarkdown from 'react-markdown';

interface NodeGraphInterfaceProps {
  nodes: Node[];
}

const NodeGraphInterface: React.FC<NodeGraphInterfaceProps> = ({ nodes }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [updatedNodes, setUpdatedNodes] = useState<Set<string>>(new Set());

  // Track node updates
  useEffect(() => {
    const newUpdatedNodes = new Set<string>();
    nodes.forEach(node => {
      if (node.updateImage) {
        newUpdatedNodes.add(node.id);
      }
    });
    setUpdatedNodes(newUpdatedNodes);
  }, [nodes]);

  // Clear updated nodes after animation completes
  useEffect(() => {
    if (updatedNodes.size > 0) {
      const timer = setTimeout(() => {
        setUpdatedNodes(new Set());
      }, 1000); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [updatedNodes]);

  const handleNodeSelect = (node: Node) => {
    setSelectedNode(node);
  };

  return (
    <div className="w-1/2 p-4 flex flex-col space-y-4 relative overflow-y-auto">
      <div className="flex-grow overflow-y-auto grid grid-cols-2 gap-4">
        {nodes.map((node) => (
          <div 
            key={node.id} 
            className={`relative cursor-pointer rounded overflow-hidden h-64 transition-all duration-200 ${
              updatedNodes.has(node.id) ? 'animate-pulse border-2' : ''
            } ${!node.image ? 'bg-gradient-to-br from-black to-gray-800' : ''}`}
          >
            {node.image ? (
              <img 
                src={node.image} 
                alt={node.name} 
                className="w-full h-64 object-cover" 
                onClick={() => handleNodeSelect(node)} 
              />
            ) : (
              <div className="w-full h-64" onClick={() => handleNodeSelect(node)} />
            )}
            <div className="absolute bottom-0 left-0 w-full bg-black bg-opacity-70 text-white p-2 text-center">{node.name}</div>
          </div>
        ))}
      </div>
      {selectedNode && (
        <div className="absolute inset-0 bg-gray-900 bg-opacity-95 p-4 flex flex-col items-start text-white z-10 overflow-y-auto">
          <div className="flex justify-between w-full mb-4">
            <p className="text-xl font-bold break-all">{selectedNode.name}</p>
            <button className="py-2 px-4 bg-red-900 rounded" onClick={() => setSelectedNode(null)}>Close</button>
          </div>
          <div className="max-h-full">
            <img src={selectedNode.image} alt={selectedNode.name} className="w-full object-contain max-h-[70vh] mb-4" />
            <div className="prose prose-invert max-w-none">
              <ReactMarkdown>{selectedNode.longDescription}</ReactMarkdown>
            </div>
            <p className="text-xs mt-5 break-all">Hidden Description: {selectedNode.rules}</p>
            <p className="text-xs break-all">Type: {selectedNode.type}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeGraphInterface;
