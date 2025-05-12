import { useState, useEffect, useCallback, useMemo } from 'react';
import { Node } from './Node';
import { generateImage } from '../services/ImageService';
import { generateImagePrompt } from '../services/LLMService';
import LZString from 'lz-string';
import { imageQueueService } from '../services/ImageQueueService';
import { sortNodesByRelevance } from '../services/LLMService';
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
        const compressedNodes = LZString.compress(JSON.stringify(nodes));
        localStorage.setItem('nodeGraph', compressedNodes);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded. Attempting to clean up...');
          // Try to remove old data to make space
          try {
            localStorage.removeItem('nodeGraph');
            const compressedNodes = LZString.compress(JSON.stringify(nodes));
            localStorage.setItem('nodeGraph', compressedNodes);
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
    setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeId));
  }, []);

  const updateGraph = useCallback(async (nodeEdition: { 
    merge?: Partial<Node>[];
    delete?: string[];
    newNodes?: string[];
  }, 
  imagePrompts: { nodeId: string; prompt: string }[] = [], 
  providedChatHistory?: Message[]
  ) => {
    if (!nodeEdition) return;

    console.log('Starting graph update with node edition:', nodeEdition);
    console.log('Image prompts to process:', imagePrompts);
    
    // Use providedChatHistory if available, otherwise fallback to context
    const currentChatHistory = providedChatHistory || chatHistory;

    // Create a new array to hold all updates
    const newNodes = [...nodes];
    let nodesToProcess: Partial<Node>[] = [];
    const processedNodeIds = new Set<string>();

    // Initialize the image queue service with the update callback
    imageQueueService.setUpdateNodeCallback((updatedNode: Node) => {
      setNodes(currentNodes => {
        const index = currentNodes.findIndex(n => n.id === updatedNode.id);
        if (index !== -1) {
          const updatedNodes = [...currentNodes];
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
    if (nodeEdition.delete) {
      console.log('Processing deletions:', nodeEdition.delete);
      nodeEdition.delete.forEach(id => {
        const index = newNodes.findIndex(node => node.id === id);
        if (index !== -1) {
          newNodes.splice(index, 1);
        }
      });
    }

    // Process updates and new nodes
    if (nodeEdition.merge) {
      console.log('Processing merges:', nodeEdition.merge);
      nodeEdition.merge.forEach(updatedNode => {
        if (!updatedNode.id) return; // Skip if no ID
        const index = newNodes.findIndex(node => node.id === updatedNode.id);
        if (index !== -1) {
          const existingNode = newNodes[index];
          newNodes[index] = { ...existingNode, ...updatedNode };
          // Only add to processing queue if updateImage is true and not in newNodes
          if (updatedNode.updateImage && !nodeEdition.newNodes?.includes(updatedNode.id)) {
            nodesToProcess.push(newNodes[index]);
          }
        } else {
          newNodes.push(updatedNode as Node);
          // Only add to processing queue if updateImage is true and not in newNodes
          if (updatedNode.updateImage && !nodeEdition.newNodes?.includes(updatedNode.id)) {
            nodesToProcess.push(updatedNode);
          }
        }
      });
    }

    // Process new nodes
    if (nodeEdition.newNodes) {
      console.log('Adding new nodes:', nodeEdition.newNodes);
      nodeEdition.newNodes.forEach(nodeId => {
        const node = newNodes.find(n => n.id === nodeId);
        if (node && !processedNodeIds.has(nodeId) && node.updateImage) {
          nodesToProcess.push(node);
        }
      });
    }

    let finalNodesState: Node[] = [...newNodes]; // Keep track of the final state

    // Sort nodes if chat history exists
    if (currentChatHistory && currentChatHistory.length > 0) {
      try {
        console.log('Sorting nodes by relevance based on chat history');
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

      } catch (error) {
        console.error('Error sorting nodes:', error);
        setNodes(newNodes); // Update state with unsorted nodes on error
        finalNodesState = newNodes; // Update final state reference
      }
    } else {
      // If no chat history, just update the nodes without sorting
      setNodes(newNodes); // Update state with unsorted nodes
      finalNodesState = newNodes; // Update final state reference
    }

    // --- Moxus Post-Sorting Triggers --- 
    // Check if the update was likely triggered by chat (which includes sorting attempt)
    // Only trigger Moxus feedback for actual content changes, not just image updates
    const isOnlyImageUpdates = nodeEdition.merge?.every(node => 
      Object.keys(node).length === 2 && 'id' in node && 'updateImage' in node
    ) ?? false;
    
    // Trigger Moxus only if:
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
        moxusService.addTask('finalReport', {}); // Trigger the final report synthesis
    } else {
        console.log('[useNodeGraph] Skipping Moxus feedback for image-only update');
    }
    // --- End Moxus Triggers --- 

    // Queue image generation for nodes that need it (using imagePrompts argument)
    // Use the imagePrompts argument passed to the function
    const nodesToProcessForImages = finalNodesState.filter(node => node.updateImage);
    if (nodesToProcessForImages.length > 0) {
      console.log('Queueing image generation for nodes');
      // Process nodes in batches of 3
      for (let i = 0; i < nodesToProcessForImages.length; i += 3) {
        const batch = nodesToProcessForImages.slice(i, i + 3);
        await Promise.all(batch.map(async (node) => {
          // Find matching prompt from imagePrompts argument, or generate if needed?
          // Current logic seems to use node.updateImage flag directly.
          // We might need to cross-reference with the imagePrompts array if that contains specific instructions.
          // For now, assuming the existing image queue logic is sufficient based on updateImage flag.
          console.log(`Queueing image generation for node: ${node.id}`);
          await imageQueueService.addToQueue(node, finalNodesState, currentChatHistory); // Pass history
        }));
      }
    }
  }, [nodes, chatHistory]);

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
