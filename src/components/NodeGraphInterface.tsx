import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Node } from '../models/Node';
import ReactMarkdown from 'react-markdown';
import { imageQueueService } from '../services/ImageQueueService';
import { Message } from '../context/ChatContext';

interface NodeGraphInterfaceProps {
  nodes: Node[];
  onNodesSorted?: (sortedNodes: Node[]) => void;
  updateGraph?: (nodeEdition: { 
    merge?: Partial<Node>[]; 
    delete?: string[];
    newNodes?: string[];
  }, imagePrompts?: { nodeId: string; prompt: string }[], chatHistory?: Message[]) => Promise<void>;
}

const NodeGraphInterface: React.FC<NodeGraphInterfaceProps> = React.memo(({ nodes, updateGraph }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [updatedNodes, setUpdatedNodes] = useState<Set<string>>(new Set());
  const [compressedImages, setCompressedImages] = useState<Map<string, string>>(new Map());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Track node updates with useMemo to prevent unnecessary recalculations
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

  // Clear updated nodes after animation completes
  useEffect(() => {
    if (updatedNodes.size > 0) {
      const timer = setTimeout(() => {
        setUpdatedNodes(new Set());
      }, 1000); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [updatedNodes]);

  // Optimize image compression by batching and using requestAnimationFrame
  useEffect(() => {
    const newCompressedImages = new Map<string, string>();
    let pendingCompressions = 0;
    let frameId: number;

    const compressImage = (node: Node) => {
      if (!node.image || !node.image.startsWith('data:image')) return;

      pendingCompressions++;
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const maxSize = 512;
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        ctx?.drawImage(img, 0, 0, width, height);
        
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
        newCompressedImages.set(node.id, compressedBase64);
        
        pendingCompressions--;
        if (pendingCompressions === 0) {
          frameId = requestAnimationFrame(() => {
            setCompressedImages(new Map(newCompressedImages));
          });
        }
      };
      
      img.src = node.image;
    };

    // Process images in batches of 3
    const processBatch = (startIndex: number) => {
      const batch = nodes.slice(startIndex, startIndex + 3);
      batch.forEach(compressImage);
      
      if (startIndex + 3 < nodes.length) {
        setTimeout(() => processBatch(startIndex + 3), 100);
      }
    };

    processBatch(0);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [nodes]);

  const handleNodeSelect = useCallback((node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleRegenerateImage = useCallback(async (node: Node) => {
    if (!updateGraph) {
      console.error('updateGraph function is not available');
      return;
    }
    console.log('Regenerating image for node:', node.id);
    const nodeEdition = {
      merge: [{
        id: node.id,
        updateImage: true
      }]
    };
    console.log('Sending node edition:', nodeEdition);
    try {
      await updateGraph(nodeEdition);
      console.log('Node edition processed successfully');
    } catch (error) {
      console.error('Error regenerating image:', error);
    }
  }, [updateGraph]);

  const getCompressedImageUrl = useCallback((nodeId: string, originalImage: string) => {
    return compressedImages.get(nodeId) || originalImage;
  }, [compressedImages]);

  // Memoize the nodes grid to prevent unnecessary re-renders
  const nodesGrid = useMemo(() => (
    <div className="flex flex-wrap gap-4">
      {nodes.map((node) => (
        <div 
          key={node.id} 
          className="w-[calc(33.333%-1rem)] flex-shrink-0"
          onMouseEnter={() => setHoveredNodeId(node.id)}
          onMouseLeave={() => setHoveredNodeId(null)}
        >
          <div 
            className={`relative cursor-pointer rounded overflow-hidden aspect-square transition-all duration-200 ${
              updatedNodes.has(node.id) ? 'animate-pulse border-2' : ''
            } ${!node.image ? 'bg-gradient-to-br from-black to-gray-800' : ''}`}
          >
            {node.image ? (
              <div className="w-full h-full">
                <img 
                  src={getCompressedImageUrl(node.id, node.image)} 
                  alt={node.name} 
                  className="w-full h-full object-cover" 
                  onClick={() => handleNodeSelect(node)} 
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="w-full h-full" onClick={() => handleNodeSelect(node)} />
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-white p-2 text-center">{node.name}</div>
            {hoveredNodeId === node.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRegenerateImage(node);
                }}
                className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-sm transition-colors"
              >
                Regenerate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  ), [nodes, updatedNodes, hoveredNodeId, getCompressedImageUrl, handleNodeSelect, handleRegenerateImage]);

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
              src={selectedNode.image} 
              alt={selectedNode.name} 
              className="w-full object-contain max-h-[70vh] mb-4" 
              loading="eager"
            />
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
});

NodeGraphInterface.displayName = 'NodeGraphInterface';

export default NodeGraphInterface;
