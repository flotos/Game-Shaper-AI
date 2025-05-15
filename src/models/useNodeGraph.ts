import { useState, useEffect, useCallback, useMemo } from 'react';
import { Node } from './Node';
import { generateImage } from '../services/ImageService';
import { generateImagePrompt } from '../services/llm';
import LZString from 'lz-string';
import { imageQueueService } from '../services/ImageQueueService';
import { sortNodesByRelevance } from '../services/llm';
import { useChat, Message } from '../context/ChatContext';
import { moxusService } from '../services/MoxusService';

const initNodes: Node[] = [
  {
    id: '0tg',
    name: 'Adventure game',
    rules: `PlayerGainsLevelOnBeat;CharactersHaveHealthAndPower;DenyImpossibleActions;GameControlsEvents;GameChallengesPlayer;
      NoTeleportAllowed;GameHandlesEncounters;WriteDialogInChatText;WriteLikeNovel;
      AvoidToUpdateImageOnLocations;DescribeNewCharactersInNewNodes_WithHairClothesAndBodyShape;Always_DisplayPlayerAppearanceOnItsDescription`,
    longDescription: "",
    image: 'https://i.ibb.co/rvy5zgd/fec82e01-b0ad-4c96-a79f-745f675b4d15.webp',
    type: 'Game Rule'
  },
  {
    id: '854euh',
    name: 'Tavern',
    rules: 'JoyfulFacade;TavernIsTrapForPlayer;FakeWarmth;LivelyAtmosphereHidesDanger;DiverseCrowd;RusticDecor;RoaringFire;SubtleTension;IfPlayerOrderBeerStartAmbush',
    longDescription: `The tavern is a warm, lively place in the bustling town. As you enter, cheerful chatter and music welcome you. 
      The room is filled with a diverse crowd, from adventurers to townsfolk. Rustic decorations and a roaring fire add to the cozy ambiance. 
      Despite the joyful environment, there's a subtle tension, as if the joy hides something sinister.`,
    image: 'https://popmenucloud.com/cdn-cgi/image/width%3D1200%2Cheight%3D1200%2Cfit%3Dscale-down%2Cformat%3Dauto%2Cquality%3D60/tsycfvqg/1325dd76-60a9-431f-b53d-a95ad105af43.jpg',
    type: 'Location'
  },
  {
    id: '8phg',
    name: 'Player',
    rules: 'Stats:HP Healthy; Strength Low; Agility Low; Intelligence Low; Charisma Low;',
    longDescription: "You are a man, aged 25 with an average appearance, wearing used clothes.",
    image: 'https://i.ibb.co/WBYTzDZ/DALL-E-2024-06-13-17-46-08-A-character-sheet-icon-with-a-fantasy-theme-The-icon-should-depict-a-scro.webp',
    type: 'Game Rules'
  },
];

function useNodeGraph() {
  const [nodes, setNodes] = useState<Node[]>(() => {
    try {
      const savedNodes = localStorage.getItem('nodeGraph');
      if (savedNodes) {
        const decompressedNodes = LZString.decompress(savedNodes);
        return decompressedNodes ? JSON.parse(decompressedNodes) : initNodes;
      }
      return initNodes;
    } catch (error) {
      console.warn('Error loading nodes from localStorage:', error);
      return initNodes;
    }
  });

  const { chatHistory, addMessage } = useChat();

  // Memoize the nodes array to prevent unnecessary re-renders
  const memoizedNodes = useMemo(() => nodes, [nodes]);

  useEffect(() => {
    let isMounted = true;
    
    const saveNodes = () => {
      try {
        // Create a clean version of nodes without the updateImage flag before saving
        const nodesToSave = nodes.map(({ updateImage, ...rest }) => rest);
        const compressedNodes = LZString.compress(JSON.stringify(nodesToSave));
        localStorage.setItem('nodeGraph', compressedNodes);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded. Attempting to clean up...');
          // Try to remove old data to make space
          try {
            localStorage.removeItem('nodeGraph');
            // Ensure updateImage is stripped here too on retry
            const nodesToSaveOnRetry = nodes.map(({ updateImage, ...rest }) => rest);
            const compressedNodesOnRetry = LZString.compress(JSON.stringify(nodesToSaveOnRetry));
            localStorage.setItem('nodeGraph', compressedNodesOnRetry);
          } catch (cleanupError) {
            console.error('Failed to save nodes even after cleanup:', cleanupError);
          }
        } else {
          console.error('Error saving nodes:', error);
        }
      }
    };

    if (isMounted) {
      saveNodes();
    }

    return () => {
      isMounted = false;
    };
  }, [nodes]);

  const addNode = useCallback((node: Node): void => {
    setNodes(prevNodes => [...prevNodes, node]);
  }, []);

  const updateNode = useCallback((updatedNode: Node): void => {
    setNodes(prevNodes => prevNodes.map(node => (node.id === updatedNode.id ? updatedNode : node)));
  }, []);

  const deleteNode = useCallback((nodeId: string): void => {
    setNodes(prevNodes => {
      // Find the node to delete
      const nodeToDelete = prevNodes.find(node => node.id === nodeId);
      
      // Clean up image resources if it has any
      if (nodeToDelete?.image) {
        if (nodeToDelete.image.startsWith('blob:')) {
          // Revoke any blob URLs to prevent memory leaks
          URL.revokeObjectURL(nodeToDelete.image);
        }
      }
      
      // Remove the node from the array
      return prevNodes.filter(node => node.id !== nodeId);
    });
  }, []);

  const updateGraph = useCallback(async (nodeEdition: { 
    merge?: Partial<Node>[];
    delete?: string[];
    newNodes?: string[];
  }, 
  imagePrompts: { nodeId: string; prompt: string }[] = [], 
  providedChatHistory?: Message[],
  isFromUserInteraction: boolean = false
  ): Promise<void> => {
    if (!nodeEdition) return;

    console.log('Starting graph update with node edition:', nodeEdition);
    console.log('Image prompts to process:', imagePrompts);
    console.log('Is from user interaction:', isFromUserInteraction);
    
    // Check if this is a delete-only operation
    const isDeleteOnly = 
      nodeEdition.delete && 
      nodeEdition.delete.length > 0 && 
      !nodeEdition.merge && 
      !nodeEdition.newNodes;
    
    // Use providedChatHistory if available, otherwise fallback to context
    const currentChatHistory = providedChatHistory || chatHistory;

    // Create a new array to hold all updates
    const newNodes = [...nodes];
    let nodesToProcess: Partial<Node>[] = [];
    const processedNodeIds = new Set<string>();
    const imageUrls = new Map<string, string>();

    // Initialize the image queue service with the update callback
    imageQueueService.setUpdateNodeCallback((updatedNode: Node) => {
      setNodes(currentNodes => {
        const index = currentNodes.findIndex(n => n.id === updatedNode.id);
        if (index !== -1) {
          const updatedNodes = [...currentNodes];
          
          // Clean up old image if it's a blob URL to prevent memory leaks
          if (updatedNodes[index].image?.startsWith('blob:')) {
            URL.revokeObjectURL(updatedNodes[index].image);
          }
          
          // Preserve all existing node properties and only update image and updateImage flag
          updatedNodes[index] = {
            ...updatedNodes[index],
            image: updatedNode.image,
            updateImage: false // Reset the flag after image is generated
          };
          return updatedNodes;
        }
        return currentNodes;
      });
    });

    // Process deletions first
    if (nodeEdition.delete && nodeEdition.delete.length > 0) {
      console.log('Processing deletions:', nodeEdition.delete);
      
      // Collect image URLs that need to be revoked
      nodeEdition.delete.forEach(id => {
        const nodeToDelete = newNodes.find(node => node.id === id);
        if (nodeToDelete?.image?.startsWith('blob:')) {
          imageUrls.set(id, nodeToDelete.image);
        }
      });
      
      // Remove deleted nodes from array
      const filteredNodes = newNodes.filter(node => !nodeEdition.delete?.includes(node.id));
      newNodes.length = 0; // Clear the array without creating a new one
      newNodes.push(...filteredNodes); // Add the filtered nodes back
      
      // Revoke blob URLs after the state update
      setTimeout(() => {
        imageUrls.forEach(url => {
          URL.revokeObjectURL(url);
        });
      }, 100);
      
      // If this is a delete-only operation, clear nodesToProcess to prevent any image regeneration
      if (isDeleteOnly) {
        nodesToProcess = [];
      }
    }

    // Process updates and new nodes
    if (nodeEdition.merge && nodeEdition.merge.length > 0) {
      console.log('Processing merges:', nodeEdition.merge);
      
      // Batch update processing to improve performance
      for (const updatedNode of nodeEdition.merge) {
        if (!updatedNode.id) continue; // Skip if no ID

        const index = newNodes.findIndex(node => node.id === updatedNode.id);
        
        if (index !== -1) {
          // Update existing node
          const existingNode = newNodes[index];
          
          // Check if image is changing and needs cleanup
          if (updatedNode.updateImage && existingNode.image?.startsWith('blob:')) {
            imageUrls.set(existingNode.id, existingNode.image);
          }
          
          newNodes[index] = { ...existingNode, ...updatedNode };
          
          // Only add to processing queue if updateImage is true and not already processed
          if (updatedNode.updateImage && !processedNodeIds.has(updatedNode.id) && 
              !nodeEdition.newNodes?.includes(updatedNode.id)) {
            nodesToProcess.push(newNodes[index]);
            processedNodeIds.add(updatedNode.id);
          }
        } else {
          // Add new node
          newNodes.push(updatedNode as Node);
          
          // Only add to processing queue if updateImage is true and not already processed
          if (updatedNode.updateImage && !processedNodeIds.has(updatedNode.id) && 
              !nodeEdition.newNodes?.includes(updatedNode.id)) {
            nodesToProcess.push(updatedNode);
            processedNodeIds.add(updatedNode.id);
          }
        }
      }
      
      // Revoke image URLs after processing
      setTimeout(() => {
        imageUrls.forEach(url => {
          URL.revokeObjectURL(url);
        });
      }, 100);
    }

    // Process new nodes
    if (nodeEdition.newNodes && nodeEdition.newNodes.length > 0) {
      console.log('Adding new nodes:', nodeEdition.newNodes);
      
      for (const nodeId of nodeEdition.newNodes) {
        const node = newNodes.find(n => n.id === nodeId);
        if (node && !processedNodeIds.has(nodeId) && node.updateImage) {
          nodesToProcess.push(node);
          processedNodeIds.add(nodeId);
        }
      }
    }

    let finalNodesState = [...newNodes]; // Keep track of the final state
    
    // Update nodes state before sorting to provide immediate UI feedback
    setNodes(newNodes);

    // Sort nodes only if this update is from user interaction and chat history exists
    if (isFromUserInteraction && currentChatHistory && currentChatHistory.length > 0) {
      try {
        console.log('Sorting nodes by relevance based on chat history');
        
        // Use a timeout to prevent UI blocking during sorting process
        setTimeout(async () => {
          try {
            const sortedIds = await sortNodesByRelevance(newNodes, currentChatHistory);
            const sortedNodes = [...newNodes].sort((a, b) => {
              const aIndex = sortedIds.indexOf(a.id);
              const bIndex = sortedIds.indexOf(b.id);
              if (aIndex === -1) return 1;
              if (bIndex === -1) return -1;
              return aIndex - bIndex;
            });
            
            setNodes(sortedNodes); // Update state with sorted nodes
            finalNodesState = sortedNodes; // Update final state reference
            
            // Trigger Moxus feedback after sorting is complete
            triggerMoxusFeedback(finalNodesState, currentChatHistory, isOnlyImageUpdate(nodeEdition));
          } catch (error) {
            console.error('Error in delayed sorting:', error);
          }
        }, 50);
      } catch (error) {
        console.error('Error sorting nodes:', error);
        
        // Still trigger Moxus feedback even if sorting fails
        triggerMoxusFeedback(finalNodesState, currentChatHistory, isOnlyImageUpdate(nodeEdition));
      }
    } else {
      // If no chat history or not from user interaction, trigger Moxus feedback directly
      triggerMoxusFeedback(finalNodesState, currentChatHistory, isOnlyImageUpdate(nodeEdition));
    }

    // Skip image generation for delete-only operations
    if (isDeleteOnly) {
      console.log('Skipping image generation for delete-only operation');
      return;
    }

    // Queue image generation for nodes that need it (using imagePrompts argument)
    // Use the imagePrompts argument passed to the function
    const nodesToProcessForImages = nodesToProcess.length > 0 ? nodesToProcess : 
                                   finalNodesState.filter(node => node.updateImage);
                                   
    if (nodesToProcessForImages.length > 0) {
      console.log('Processing images for nodes:', nodesToProcessForImages.map(n => n.id));
      
      // Process images in batches to improve performance
      const batchSize = 3;
      
      for (let i = 0; i < nodesToProcessForImages.length; i += batchSize) {
        const batch = nodesToProcessForImages.slice(i, i + batchSize);
        
        // Process each batch with a slight delay to prevent UI freezing
        setTimeout(() => {
          batch.forEach(node => {
            // Find matching prompt from imagePrompts if available
            const matchingPrompt = imagePrompts.find(p => p.nodeId === node.id);
            
            if (matchingPrompt) {
              console.log('Using provided prompt for node:', node.id);
              imageQueueService.addToQueueWithExistingPrompt(node as Node, matchingPrompt.prompt);
            } else {
              console.log('Generating new prompt for node:', node.id);
              imageQueueService.addToQueue(node as Node, finalNodesState, currentChatHistory);
            }
          });
        }, i * 50); // Stagger image processing
      }
    }
  }, [nodes, chatHistory, addMessage]);
  
  // Helper function to check if the update only affects images
  const isOnlyImageUpdate = useCallback((nodeEdition: { 
    merge?: Partial<Node>[]; 
    delete?: string[];
    newNodes?: string[];
  }) => {
    // Check if this is a delete-only operation
    if (nodeEdition.delete?.length && !nodeEdition.merge && !nodeEdition.newNodes) {
      return false; // Delete operations are significant content changes, not just image updates
    }
    
    // Check if the update only includes image updates
    return (nodeEdition.merge?.every(node => 
      Object.keys(node).length <= 2 && // Only id and updateImage properties
      'id' in node && 
      ('updateImage' in node || !Object.keys(node).some(key => key !== 'id'))
    ) ?? true) && 
    !nodeEdition.delete?.length && 
    !nodeEdition.newNodes?.length;
  }, []);
  
  // Helper function to trigger Moxus feedback
  const triggerMoxusFeedback = useCallback((
    finalNodesState: Node[], 
    currentChatHistory?: Message[],
    isOnlyImageUpdates: boolean = false
  ) => {
    // Only trigger Moxus if:
    // 1. There are actual content changes (not just image updates)
    // 2. OR if it's an update triggered by chat interaction (with chat history)
    // 3. AND we have chat history available (required for proper analysis)
    if (currentChatHistory && currentChatHistory.length > 0 && !isOnlyImageUpdates) {
      console.log('[useNodeGraph] Queueing Moxus post-sorting feedback tasks.');
      moxusService.addTask('storyFeedback', {
        chatHistory: currentChatHistory
      });
      moxusService.addTask('nodeUpdateFeedback', {
        nodes: finalNodesState, // Use the final state after sorting/update
        chatHistory: currentChatHistory
      });
      moxusService.addTask('finalReport', {}, currentChatHistory); // Pass chat history for context
    } else {
      console.log('[useNodeGraph] Skipping Moxus feedback for image-only update or no history');
    }
  }, []);

  return { 
    nodes: memoizedNodes, 
    addNode, 
    updateNode, 
    deleteNode, 
    updateGraph, 
    setNodes 
  };
}

export default useNodeGraph;
