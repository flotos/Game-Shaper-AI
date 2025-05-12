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
  }, 
  imagePrompts?: { nodeId: string; prompt: string }[], 
  chatHistory?: Message[],
  isFromUserInteraction?: boolean) => Promise<void>;
}

const NodeGraphInterface: React.FC<NodeGraphInterfaceProps> = React.memo(({ nodes, updateGraph, onNodesSorted }) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [updatedNodes, setUpdatedNodes] = useState<Set<string>>(new Set());
  const [compressedImages, setCompressedImages] = useState<Map<string, string>>(new Map());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [deletingNode, setDeletingNode] = useState<string | null>(null);

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

  // Optimize image compression by using a worker pool and caching
  useEffect(() => {
    if (!nodes.length) return;
    
    // Skip image processing immediately after a deletion
    if (deletingNode) return;
    
    // Only process nodes that have changed or are new
    const nodesToProcess = nodes.filter(node => {
      // Skip nodes without images or being deleted
      if (!node.image || deletingNode === node.id) return false;
      
      // Skip nodes that already have compressed images unless they have been updated
      if (compressedImages.has(node.id) && !updatedNodes.has(node.id)) {
        // Check if the image URL has changed even if not marked as updated
        const cachedImageUrl = compressedImages.get(node.id);
        const originalImageUrl = node.image;
        if (cachedImageUrl && originalImageUrl && cachedImageUrl !== originalImageUrl) {
          return true; // Process if URL has changed
        }
        return false;
      }
      
      // Process this node
      return true;
    });
    
    if (!nodesToProcess.length) return;
    
    let isMounted = true;
    const newCompressedImages = new Map(compressedImages);
    let processedNodes = 0;
    
    // Process nodes in smaller batches to avoid UI freezes
    const batchSize = 3;
    const totalBatches = Math.ceil(nodesToProcess.length / batchSize);
    
    const processBatch = (batchIndex: number) => {
      if (!isMounted) return;
      
      const startIdx = batchIndex * batchSize;
      const endIdx = Math.min(startIdx + batchSize, nodesToProcess.length);
      const currentBatch = nodesToProcess.slice(startIdx, endIdx);
      
      currentBatch.forEach(node => {
        if (!node.image || !node.image.startsWith('data:image')) return;
        
        const img = new Image();
        
        img.onload = () => {
          if (!isMounted) return;
          
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Use a smaller size for node thumbnails
          const maxSize = 384; // Reduced from 512
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
          
          // Use a lower quality for thumbnails to save memory
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
          newCompressedImages.set(node.id, compressedBase64);
          
          processedNodes++;
          
          // Update the state in batches using requestAnimationFrame for better performance
          if (processedNodes % 3 === 0 || processedNodes === nodesToProcess.length) {
            requestAnimationFrame(() => {
              if (isMounted) {
                setCompressedImages(new Map(newCompressedImages));
              }
            });
          }
        };
        
        // Set src after defining handlers
        img.src = node.image;
      });
      
      // Process next batch if there are more
      if (endIdx < nodesToProcess.length && isMounted) {
        setTimeout(() => processBatch(batchIndex + 1), 50);
      }
    };
    
    // Start processing the first batch
    processBatch(0);
    
    return () => {
      isMounted = false;
    };
  }, [nodes, updatedNodes, compressedImages, deletingNode]);

  const handleNodeSelect = useCallback((node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleRegenerateImage = useCallback(async (node: Node) => {
    if (!updateGraph) {
      console.error('updateGraph function is not available');
      return;
    }
    console.log('Regenerating image for node:', node.id);
    
    // Immediately clear this node from the compressed images cache
    if (compressedImages.has(node.id)) {
      setCompressedImages(prevImages => {
        const newImages = new Map(prevImages);
        newImages.delete(node.id);
        return newImages;
      });
    }
    
    // Mark node as needing image update
    const nodeEdition = {
      merge: [{
        id: node.id,
        updateImage: true
      }]
    };
    console.log('Sending node edition:', nodeEdition);
    try {
      // Pass empty array for chatHistory to prevent Moxus feedback triggers
      await updateGraph(nodeEdition, [], []);
      console.log('Node edition processed successfully');
    } catch (error) {
      console.error('Error regenerating image:', error);
    }
  }, [updateGraph, compressedImages]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!updateGraph) {
      console.error('updateGraph function is not available');
      return;
    }
    
    if (nodeId === nodeToDelete) {
      // This is the confirmation click
      console.log('Deleting node:', nodeId);
      setSelectedNode(null); // Clear selected node if it's the one being deleted
      
      // Set a loading state for the node being deleted
      setDeletingNode(nodeId);
      
      // Find the node that's being deleted (for later image cleanup)
      const nodeToRemove = nodes.find(node => node.id === nodeId);
      
      // Then update the graph using updateGraph which will update the state
      const nodeEdition = {
        delete: [nodeId]
      };
      
      try {
        await updateGraph(nodeEdition, [], []);
        console.log('Node deleted successfully');
        
        // Clean up image object URLs if any
        if (nodeToRemove?.image && nodeToRemove.image.startsWith('blob:')) {
          URL.revokeObjectURL(nodeToRemove.image);
        }
        
        // Clean up compressed images
        setCompressedImages(prevImages => {
          const newImages = new Map(prevImages);
          newImages.delete(nodeId);
          return newImages;
        });
      } catch (error) {
        console.error('Error deleting node:', error);
      } finally {
        setDeletingNode(null);
      }
      
      setNodeToDelete(null);
    } else {
      // First click - set this node for deletion
      setNodeToDelete(nodeId);
    }
  }, [updateGraph, nodeToDelete, nodes, setCompressedImages]);

  // Reset the delete confirmation when mouse leaves the node
  const handleMouseLeave = useCallback((nodeId: string) => {
    setHoveredNodeId(null);
    if (nodeId === nodeToDelete) {
      setNodeToDelete(null);
    }
  }, [nodeToDelete]);

  const getCompressedImageUrl = useCallback((nodeId: string, originalImage: string) => {
    // Check if a compressed image exists and if the node has been updated
    if (compressedImages.has(nodeId) && !updatedNodes.has(nodeId)) {
      // Check if the cached image matches the current image URL
      const cachedImage = compressedImages.get(nodeId);
      if (cachedImage && cachedImage.startsWith('data:image') && originalImage.startsWith('data:image')) {
        // Extract a short signature from both images to compare
        const getImageSignature = (url: string) => {
          // Use the first 20 chars after data:image/ as signature
          const match = url.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/]{20})/);
          return match ? match[1] : '';
        };
        
        const originalSignature = getImageSignature(originalImage);
        const cachedSignature = getImageSignature(cachedImage);
        
        // Only use cached version if signatures match (indicating they're the same base image)
        if (originalSignature && cachedSignature && originalSignature === cachedSignature) {
          return cachedImage;
        }
        
        // Signatures don't match, don't use the cached image
        return originalImage;
      }
    }
    return originalImage;
  }, [compressedImages, updatedNodes]);

  // Memoize the nodes grid to prevent unnecessary re-renders
  const nodesGrid = useMemo(() => (
    <div className="flex flex-wrap gap-4">
      {nodes.map((node) => (
        <div 
          key={node.id} 
          className="w-[calc(33.333%-1rem)] flex-shrink-0"
          onMouseEnter={() => setHoveredNodeId(node.id)}
          onMouseLeave={() => handleMouseLeave(node.id)}
        >
          <div 
            className={`relative cursor-pointer rounded overflow-hidden aspect-square transition-all duration-200 ${
              updatedNodes.has(node.id) ? 'animate-pulse border-2' : ''
            } ${deletingNode === node.id ? 'opacity-50' : ''} 
            ${!node.image ? 'bg-gradient-to-br from-black to-gray-800' : ''}`}
          >
            {node.image && deletingNode !== node.id ? (
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
              <div 
                className={`w-full h-full flex items-center justify-center ${
                  deletingNode === node.id ? 'bg-red-900 bg-opacity-25' : ''
                }`} 
                onClick={() => handleNodeSelect(node)}
              >
                {deletingNode === node.id && (
                  <div className="text-white">Deleting...</div>
                )}
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-white p-2 text-center">{node.name}</div>
            {hoveredNodeId === node.id && deletingNode !== node.id && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRegenerateImage(node);
                  }}
                  className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-sm transition-colors"
                >
                  Regenerate
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteNode(node.id);
                  }}
                  className={`absolute top-2 left-2 ${
                    nodeToDelete === node.id
                      ? 'bg-red-700 hover:bg-red-800'
                      : 'bg-red-600 hover:bg-red-700'
                  } text-white p-1 rounded text-sm transition-colors`}
                  title={nodeToDelete === node.id ? 'Click again to confirm deletion' : 'Delete node'}
                >
                  {nodeToDelete === node.id ? 'Confirm ✗' : '✗'}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  ), [nodes, updatedNodes, hoveredNodeId, nodeToDelete, deletingNode, getCompressedImageUrl, handleNodeSelect, handleRegenerateImage, handleDeleteNode, handleMouseLeave]);

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
