import React, { useState, useEffect } from 'react';
import { Node } from '../models/Node';
import ReactMarkdown from 'react-markdown';
import { imageQueueService } from '../services/ImageQueueService';

interface NodeGraphInterfaceProps {
  nodes: Node[];
  onNodesSorted?: (sortedNodes: Node[]) => void;
  updateGraph?: (nodeEdition: { 
    merge?: Partial<Node>[]; 
    delete?: string[];
    newNodes?: string[];
  }, imagePrompts?: { nodeId: string; prompt: string }[]) => Promise<void>;
}

const NodeGraphInterface: React.FC<NodeGraphInterfaceProps> = ({ nodes }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [updatedNodes, setUpdatedNodes] = useState<Set<string>>(new Set());
  const [compressedImages, setCompressedImages] = useState<Map<string, string>>(new Map());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

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

  // Create compressed versions of base64 images
  useEffect(() => {
    const newCompressedImages = new Map<string, string>();
    
    nodes.forEach(node => {
      if (node.image && node.image.startsWith('data:image')) {
        const img = new Image();
        img.onload = () => {
          // Create a canvas to resize the image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Calculate new dimensions (max 256x256 while maintaining aspect ratio)
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
          
          // Draw and compress the image
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Convert to base64 with reduced quality
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
          newCompressedImages.set(node.id, compressedBase64);
          setCompressedImages(new Map(newCompressedImages));
        };
        img.src = node.image;
      }
    });
  }, [nodes]);

  const handleNodeSelect = (node: Node) => {
    setSelectedNode(node);
  };

  const handleRegenerateImage = async (node: Node) => {
    // Set updateImage flag to true to trigger regeneration
    const updatedNode = {
      ...node,
      updateImage: true
    };
    
    // Add to image queue
    await imageQueueService.addToQueue(updatedNode, nodes, []);
  };

  // Function to get compressed image URL
  const getCompressedImageUrl = (nodeId: string, originalImage: string) => {
    return compressedImages.get(nodeId) || originalImage;
  };

  return (
    <div className="w-1/2 p-4 flex flex-col space-y-4 relative overflow-y-auto">
      <div className="flex-grow overflow-y-auto">
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
};

export default NodeGraphInterface;
