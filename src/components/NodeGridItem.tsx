import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Node } from '../models/Node';
import { compressImage } from '../services/ImageService';

// Helper hook to get the previous value of a prop or state
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

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

const getNodeBorderColor = (nodeType: string): string => {
  switch (nodeType.toLowerCase()) {
    case 'assistant':
    case 'image-generation':
    case 'system':
      return 'border-black';
    case 'character':
      return 'border-green-500';
    case 'location':
      return 'border-emerald-500';
    case 'event':
      return 'border-teal-500';
    case 'item':
    case 'object':
      return 'border-cyan-500';
    case 'mechanic':
    case 'concept':
      return 'border-sky-500';
    case 'library':
      return 'border-blue-500';
    default:
      return 'border-gray-700';
  }
};

const getNodeBadgeColorClass = (nodeType: string): string => {
  switch (nodeType.toLowerCase()) {
    case 'assistant':
    case 'image-generation':
    case 'system':
      return 'bg-gray-300'; // Light gray for good contrast on dark background
    case 'character':
      return 'bg-green-500';
    case 'location':
      return 'bg-emerald-500';
    case 'event':
      return 'bg-teal-500';
    case 'item':
    case 'object':
      return 'bg-cyan-500';
    case 'mechanic':
    case 'concept':
      return 'bg-sky-500';
    case 'library':
      return 'bg-blue-500';
    default:
      return 'bg-gray-500'; // A visible gray for default cases
  }
};

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
  const prevImage = usePrevious(node.image);
  const prevIsUpdated = usePrevious(isUpdated);

  useEffect(() => {
    let isMounted = true;
    // Remove compression logic for thumbnails for now
    // let shouldCompress = false;
    // let reasonForCompression = "";
    // let imageToCompress: string | null = null;

    if (node.image !== prevImage) { // Image URL itself changed
      if (node.image) {
        // console.log(`NodeGridItem ${node.id}: Image changed to ${node.image.substring(0,30)}. Displaying directly.`);
        setThumbnailUrl(node.image); 
      } else {
        // console.log(`NodeGridItem ${node.id}: Image changed to null.`);
        setThumbnailUrl(null);
      }
    } else if (isUpdated && !prevIsUpdated && node.image) { // isUpdated just flipped from false to true, and image is the same
      // console.log(`NodeGridItem ${node.id}: isUpdated became true, image ${node.image.substring(0,30)} (unchanged). Displaying directly.`);
      // Ensure thumbnailUrl reflects current node.image if it was somehow different
      if (thumbnailUrl !== node.image) {
        setThumbnailUrl(node.image);
      }
    } else if (!node.image && thumbnailUrl !== null) { 
      // This case handles if node.image becomes null and thumbnailUrl wasn't updated yet
      // (e.g. if prevImage was not null, but current node.image is null, and isUpdated didn't change)
      setThumbnailUrl(null);
    }

    // The original compression block is removed:
    // if (shouldCompress && imageToCompress) {
    //   const capturedImageToCompress = imageToCompress; 
    //   compressImage(capturedImageToCompress, { qualityProfile: 'thumbnail' }) 
    //     .then(compressedUrl => {
    //       if (isMounted && node.image === capturedImageToCompress) {
    //         setThumbnailUrl(compressedUrl);
    //       }
    //     })
    //     .catch(error => {
    //       console.error(`Error compressing thumbnail for node ${node.id} (reason: ${reasonForCompression}, image: ${capturedImageToCompress ? capturedImageToCompress.substring(0,30) : 'N/A'}):`, error);
    //       if (isMounted && node.image === capturedImageToCompress) {
    //         setThumbnailUrl(capturedImageToCompress); 
    //       }
    //     });
    // } else if (!node.image && thumbnailUrl !== null) { 
    //     setThumbnailUrl(null);
    // }

    return () => {
      isMounted = false;
    };
  }, [node.id, node.image, isUpdated, prevImage, prevIsUpdated, thumbnailUrl]);

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

  const borderColorClass = getNodeBorderColor(node.type);
  const badgeColorClass = getNodeBadgeColorClass(node.type);
  const nodeTypeLower = node.type.toLowerCase();

  let dynamicBadgeClasses = '';
  if (nodeTypeLower === 'event') {
    const badgeBorderColor = badgeColorClass.replace('bg-', 'border-');
    dynamicBadgeClasses = `border-2 ${badgeBorderColor} rounded-full`;
  } else if (nodeTypeLower === 'character') {
    dynamicBadgeClasses = `${badgeColorClass}`; // Square, filled, no rounded-full
  } else {
    dynamicBadgeClasses = `${badgeColorClass} rounded-full`; // Default: filled circle
  }

  return (
    <div 
      className="w-[calc(33.333%-1rem)] flex-shrink-0"
      onMouseEnter={handleMouseEnterItem}
      onMouseLeave={handleMouseLeaveItem}
    >
      <div 
        className={`relative cursor-pointer rounded overflow-hidden aspect-square transition-all duration-200 border-b-2 ${borderColorClass} ${
          isUpdated ? 'animate-pulse' : ''
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
        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 text-white p-2 flex items-center justify-between">
          <span className="truncate max-w-[calc(100%-2.5rem)]">{node.name}</span>
          <span 
            className={`w-3 h-3 ${dynamicBadgeClasses} flex-shrink-0`}
          ></span>
        </div>
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