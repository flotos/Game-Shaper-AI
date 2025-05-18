import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Node } from '../models/Node';
import ReactMarkdown from 'react-markdown';
import { Message } from '../context/ChatContext';
// import { compressImage } from '../services/ImageService'; // No longer needed here directly
import NodeGridItem from './NodeGridItem'; // Import the new component
import { LLMNodeEditionResponse } from '../models/nodeOperations';

interface NodeGraphInterfaceProps {
  nodes: Node[];
  onNodesSorted?: (sortedNodes: Node[]) => void;
  updateGraph?: (
    nodeEdition: LLMNodeEditionResponse,
    imagePrompts?: { nodeId: string; prompt: string }[],
    chatHistory?: Message[],
    isFromUserInteraction?: boolean
  ) => Promise<void>;
}

const NodeGraphInterface: React.FC<NodeGraphInterfaceProps> = React.memo(({ nodes, updateGraph, onNodesSorted }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [updatedNodes, setUpdatedNodes] = useState<Set<string>>(new Set());
  // const [compressedImages, setCompressedImages] = useState<Map<string, { originalUrl: string; compressedUrl: string }>>(new Map()); // Removed
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [deletingNode, setDeletingNode] = useState<string | null>(null);

  const newUpdatedNodes = useMemo(() => {
    const updates = new Set<string>();
    nodes.forEach(node => {
      if (node.updateImage) {
        updates.add(node.id);
      }
    });
    return updates;
  }, [nodes]);

  useEffect(() => {
    setUpdatedNodes(newUpdatedNodes);
  }, [newUpdatedNodes]);

  useEffect(() => {
    if (updatedNodes.size > 0) {
      const timer = setTimeout(() => {
        setUpdatedNodes(new Set());
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [updatedNodes]);

  // The large useEffect for batch image compression is removed.
  // Thumbnail generation is now handled by NodeGridItem itself.

  const handleNodeSelect = useCallback((node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleRegenerateImage = useCallback(async (node: Node) => {
    if (!updateGraph) {
      console.error('updateGraph function is not available');
      return;
    }
    console.log('Regenerating image for node:', node.id);
    
    const nodeEdition: LLMNodeEditionResponse = {
      callId: `regenImg-${node.id}-${Date.now()}`,
      u_nodes: { [node.id]: { img_upd: true } }
    };
    console.log('Sending node edition:', nodeEdition);
    try {
      await updateGraph(nodeEdition, [], []);
      console.log('Node edition processed successfully for image regeneration');
    } catch (error) {
      console.error('Error regenerating image:', error);
    }
  }, [updateGraph]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!updateGraph) {
      console.error('updateGraph function is not available');
      return;
    }
    
    if (nodeId === nodeToDelete) {
      console.log('Deleting node:', nodeId);
      setSelectedNode(null);
      setDeletingNode(nodeId);
      
      const nodeEdition: LLMNodeEditionResponse = {
        callId: `delNode-${nodeId}-${Date.now()}`,
        d_nodes: [nodeId]
      };
      
      try {
        await updateGraph(nodeEdition, [], []);
        console.log('Node deleted successfully');
      } catch (error) {
        console.error('Error deleting node:', error);
      } finally {
        setDeletingNode(null);
      }
      setNodeToDelete(null);
    } else {
      setNodeToDelete(nodeId);
    }
  }, [updateGraph, nodeToDelete]);

  // For NodeGridItem props
  const handleMouseEnter = useCallback((nodeId: string) => setHoveredNodeId(nodeId), []);
  const handleMouseLeave = useCallback((nodeId: string) => {
    // Check nodeId to prevent resetting if mouse quickly moves between item and its own delete button
    if (hoveredNodeId === nodeId) {
      setHoveredNodeId(null);
    }
    if (nodeToDelete === nodeId) { // If mouse leaves item that was targeted for deletion, cancel confirm state
        setNodeToDelete(null);
    }
  }, [hoveredNodeId, nodeToDelete]);

  // getCompressedImageUrl is removed.

  const nodesGrid = useMemo(() => (
    <div className="flex flex-wrap gap-4">
      {nodes.map((node) => (
        <NodeGridItem
          key={node.id}
          node={node}
          isUpdated={updatedNodes.has(node.id)}
          onNodeSelect={handleNodeSelect}
          hoveredNodeId={hoveredNodeId}
          nodeToDelete={nodeToDelete}
          deletingNode={deletingNode}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave} // Pass the correctly scoped handleMouseLeave
          onRegenerateImage={handleRegenerateImage}
          onDeleteNode={handleDeleteNode}
        />
      ))}
    </div>
  ), [
    nodes, 
    updatedNodes, 
    hoveredNodeId, 
    nodeToDelete, 
    deletingNode, 
    handleNodeSelect, 
    handleMouseEnter, 
    handleMouseLeave, 
    handleRegenerateImage, 
    handleDeleteNode
  ]);

  return (
    <div className="w-1/2 p-4 flex flex-col space-y-4 relative overflow-y-auto">
      <div className="flex-grow overflow-y-auto">
        {nodesGrid}
      </div>
      {selectedNode && (
        <div className="absolute inset-0 bg-gray-900 bg-opacity-95 p-4 flex flex-col items-start text-white z-10 overflow-y-auto">
          <div className="flex justify-between w-full mb-4">
            <p className="text-xl font-bold break-all">{selectedNode.name}</p>
            <button className="py-2 px-4 bg-red-900 rounded" onClick={() => setSelectedNode(null)}>Close</button>
          </div>
          <div className="max-h-full">
            <img 
              src={selectedNode.image} // Directly use selectedNode.image as it's the 1024px base
              alt={selectedNode.name} 
              className="w-full object-contain max-h-[70vh] mb-4" 
              loading="eager"
            />
            <div className="prose prose-invert max-w-none">
              <ReactMarkdown>{selectedNode.longDescription}</ReactMarkdown>
            </div>
            <p className="text-xs break-all">Type: {selectedNode.type}</p>
          </div>
        </div>
      )}
    </div>
  );
});

NodeGraphInterface.displayName = 'NodeGraphInterface';

export default NodeGraphInterface;
