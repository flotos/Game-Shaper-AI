import React, { useState, useEffect, useCallback } from 'react';
import { Node } from '../models/Node';
import { compressImage } from '../services/ImageService';

interface NodeGridItemProps {
  node: Node;
  isUpdated: boolean;
  onNodeSelect: (node: Node) => void;
  // Props needed for delete/regenerate buttons, passed down from NodeGraphInterface
  hoveredNodeId: string | null;
  nodeToDelete: string | null;
  deletingNode: string | null;
  onMouseEnter: (nodeId: string) => void;
  onMouseLeave: (nodeId: string) => void;
  onRegenerateImage: (node: Node) => void;
  onDeleteNode: (nodeId: string) => void;
}

const NodeGridItem: React.FC<NodeGridItemProps> = React.memo((
  { 
    node, 
    isUpdated, 
    onNodeSelect, 
    hoveredNodeId,
    nodeToDelete,
    deletingNode,
    onMouseEnter,
    onMouseLeave,
    onRegenerateImage,
    onDeleteNode 
  }
) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (node.image) {
      // Initially, or if the base image changes, try to set a quick display
      // This could be the full-res image if no thumbnail was previously set for this specific item
      // or if the component is mounting for the first time.
      // If a previous thumbnail exists for this node.id from a prior render, it might be better to hold off
      // until the new one is compressed to avoid a flash of a large image.
      // For simplicity now, let's always show node.image then refine to thumbnail.
      setThumbnailUrl(node.image); // Show base image quickly

      compressImage(node.image, false) // preserveQuality: false for thumbnail
        .then(compressedUrl => {
          if (isMounted) {
            setThumbnailUrl(compressedUrl);
          }
        })
        .catch(error => {
          console.error(`Error compressing thumbnail for node ${node.id} in NodeGridItem:`, error);
          if (isMounted) {
            // Fallback to the base image if compression fails
            setThumbnailUrl(node.image);
          }
        });
    } else {
      setThumbnailUrl(null); // No image to display
    }

    return () => {
      isMounted = false;
    };
  // Effect should re-run if the source image changes or if it's explicitly marked as updated.
  // node.id is included because if the node prop itself is a new object (e.g. list reordering or replacement)
  // we need to ensure we are processing the correct image.
  }, [node.id, node.image, isUpdated]);

  const handleSelect = useCallback(() => {
    onNodeSelect(node);
  }, [node, onNodeSelect]);

  const handleRegenerate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRegenerateImage(node);
  }, [node, onRegenerateImage]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteNode(node.id);
  }, [node.id, onDeleteNode]);
  
  const handleMouseEnterItem = useCallback(() => {
    onMouseEnter(node.id);
  },[node.id, onMouseEnter]);

  const handleMouseLeaveItem = useCallback(() => {
    onMouseLeave(node.id);
  }, [node.id, onMouseLeave]);

  return (
    <div 
      className="w-[calc(33.333%-1rem)] flex-shrink-0"
      onMouseEnter={handleMouseEnterItem}
      onMouseLeave={handleMouseLeaveItem}
    >
      <div 
        className={`relative cursor-pointer rounded overflow-hidden aspect-square transition-all duration-200 ${
          isUpdated ? 'animate-pulse border-2' : ''
        } ${deletingNode === node.id ? 'opacity-50' : ''} 
        ${!thumbnailUrl ? 'bg-gradient-to-br from-black to-gray-800' : ''}`}
      >
        {thumbnailUrl && deletingNode !== node.id ? (
          <div className="w-full h-full" onClick={handleSelect}>
            <img 
              src={thumbnailUrl} 
              alt={node.name} 
              className="w-full h-full object-cover" 
              loading="lazy"
            />
          </div>
        ) : (
          <div 
            className={`w-full h-full flex items-center justify-center ${
              deletingNode === node.id ? 'bg-red-900 bg-opacity-25' : ''
            }`} 
            onClick={handleSelect}
          >
            {deletingNode === node.id && (
              <div className="text-white">Deleting...</div>
            )}
            {!thumbnailUrl && deletingNode !== node.id && (
              <div className="text-white text-xs">Loading image...</div>
            )}
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-white p-2 text-center truncate">{node.name}</div>
        {hoveredNodeId === node.id && deletingNode !== node.id && (
          <>
            <button
              onClick={handleRegenerate}
              className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-sm transition-colors"
            >
              Regenerate
            </button>
            <button
              onClick={handleDelete}
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
  );
});

NodeGridItem.displayName = 'NodeGridItem';

export default NodeGridItem; 