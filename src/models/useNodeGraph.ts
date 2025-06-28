import { useState, useEffect, useCallback, useMemo } from 'react';
import { Node } from './Node';
import { generateImage } from '../services/ImageService';
import LZString from 'lz-string';
import { imageQueueService } from '../services/ImageQueueService';
import { sortNodesByRelevance } from '../services/llm';
import { useChat, Message } from '../context/ChatContext';
import { moxusService } from '../services/MoxusService';
import { LLMNodeEditionResponse, FieldUpdateOperation } from './nodeOperations';
import { applyTextDiffInstructions } from '../utils/textUtils';
import { safeLocalStorageSetItem } from '../utils/localStorageUtils';

const initNodes: Node[] = [
  {
    id: '0tg',
    name: 'Adventure game',
    longDescription: "",
    image: 'https://i.ibb.co/rvy5zgd/fec82e01-b0ad-4c96-a79f-745f675b4d15.webp',
    type: 'Game Rule'
  },
  {
    id: '854euh',
    name: 'Tavern',
    longDescription: `The tavern is a warm, lively place in the bustling town. As you enter, cheerful chatter and music welcome you. 
      The room is filled with a diverse crowd, from adventurers to townsfolk. Rustic decorations and a roaring fire add to the cozy ambiance. 
      Despite the joyful environment, there's a subtle tension, as if the joy hides something sinister.`,
    image: 'https://popmenucloud.com/cdn-cgi/image/width%3D1200%2Cheight%3D1200%2Cfit%3Dscale-down%2Cformat%3Dauto%2Cquality%3D60/tsycfvqg/1325dd76-60a9-431f-b53d-a95ad105af43.jpg',
    type: 'Location'
  },
  {
    id: '8phg',
    name: 'Player',
    longDescription: "You are a man, aged 25 with an average appearance, wearing used clothes.",
    image: 'https://i.ibb.co/WBYTzDZ/DALL-E-2024-06-13-17-46-08-A-character-sheet-icon-with-a-fantasy-theme-The-icon-should-depict-a-scro.webp',
    type: 'Game Rules'
  },
];

function useNodeGraph() {
  const nonDeletableNodeTypes = ["system", "assistant", "image_generation", "image_generation_prompt", "image_generation_prompt_negative"].map(type => type.toLowerCase());
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

  const getNodes = useCallback(() => {
    return nodes; // Provides access to the current nodes state
  }, [nodes]);

  useEffect(() => {
    let isMounted = true;
    
    const saveNodes = () => {
      try {
        // Create a clean version of nodes without the updateImage flag before saving
        const nodesToSave = nodes.map(({ updateImage, ...rest }) => rest);
        const compressedNodes = LZString.compress(JSON.stringify(nodesToSave));
        
        const success = safeLocalStorageSetItem('nodeGraph', compressedNodes);
        if (!success) {
          console.error('Failed to save nodes even after automated cleanup attempts');
        }
      } catch (error) {
        console.error('Error preparing nodes for save:', error);
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
  }, [nodes]);

  const updateGraph = useCallback(async (
    nodeEdition: LLMNodeEditionResponse,
    imagePrompts: { nodeId: string; prompt: string }[] = [], 
    providedChatHistory?: Message[],
    isFromUserInteraction: boolean = false
  ): Promise<void> => {
    if (!nodeEdition || (!nodeEdition.n_nodes && !nodeEdition.u_nodes && !nodeEdition.d_nodes)) {
      console.log('No node operations to perform (YAML structure).');
      return;
    }

    console.log('Starting graph update (YAML structure):', nodeEdition, 'Call ID:', nodeEdition.callId);
    const currentChatHistory = providedChatHistory || chatHistory;
    let workingNodes = [...nodes]; 
    let nodesToProcessForImageUpdate: Partial<Node>[] = []; 
    const processedNodeIdsForImage = new Set<string>();
    let hasContentChanges = false; 

    imageQueueService.setUpdateNodeCallback((updatedNode: Node) => {
      setNodes(currentNodes => {
        const index = currentNodes.findIndex(n => n.id === updatedNode.id);
        if (index !== -1) {
          const updatedNodesState = [...currentNodes];
          if (updatedNodesState[index].image?.startsWith('blob:')) {
            URL.revokeObjectURL(updatedNodesState[index].image!);
          }
          updatedNodesState[index] = {
            ...updatedNodesState[index],
            image: updatedNode.image,
            updateImage: false
          };
          return updatedNodesState;
        }
        return currentNodes;
      });
    });

    // 1. Process Deletions (d_nodes)
    if (nodeEdition.d_nodes && nodeEdition.d_nodes.length > 0) {
      console.log('Processing deletions:', nodeEdition.d_nodes);
      const deleteIds = new Set(nodeEdition.d_nodes);
      const originalWorkingNodesLength = workingNodes.length;

      workingNodes = workingNodes.filter(node => {
        if (deleteIds.has(node.id)) {
          // Node is to be deleted, perform cleanup before removing
          if (node.image?.startsWith('blob:')) {
            URL.revokeObjectURL(node.image);
            console.log(`Revoked blob URL for deleted node ${node.id}`);
          }
          processedNodeIdsForImage.delete(node.id);
          return false;
        }
        return true;
      });
      
      if (workingNodes.length !== originalWorkingNodesLength) {
          hasContentChanges = true;
      }
    }

    // 2. Process Updates (u_nodes)
    if (nodeEdition.u_nodes) {
      console.log('Processing updates:', nodeEdition.u_nodes);
      for (const nodeId in nodeEdition.u_nodes) {
        const updatesForNode = nodeEdition.u_nodes[nodeId];
        const nodeIndex = workingNodes.findIndex(n => n.id === nodeId);

        if (nodeIndex === -1) {
          console.warn(`updateGraph: Node with ID ${nodeId} not found for update.`);
          continue;
        }

        const originalNode = workingNodes[nodeIndex];
        let modifiedNode = { ...originalNode }; 
        let nodeSpecificContentChanged = false;

        for (const fieldName in updatesForNode) {
          if (fieldName === 'img_upd') continue; 

          const fieldUpdate = updatesForNode[fieldName] as FieldUpdateOperation;

          if (fieldUpdate.rpl !== undefined) {
            (modifiedNode as any)[fieldName] = fieldUpdate.rpl;
            console.log(`updateGraph: Node ${nodeId}, field ${fieldName} replaced.`);
            nodeSpecificContentChanged = true;
          } else if (fieldUpdate.df && (fieldName === 'longDescription')) {
            const currentText = (originalNode as any)[fieldName] as string;
            if (typeof currentText === 'string') {
              try {
                const newText = applyTextDiffInstructions(currentText, fieldUpdate.df);
                if (newText !== currentText) {
                  (modifiedNode as any)[fieldName] = newText;
                  nodeSpecificContentChanged = true;
                }
              } catch (e) {
                const errorMsg = `Error applying text diff to node ${nodeId}, field ${fieldName}: ${e instanceof Error ? e.message : String(e)}`;
                console.error(errorMsg, fieldUpdate.df);
                if (nodeEdition.callId) {
                  moxusService.failLLMCallRecord(nodeEdition.callId, errorMsg);
                }
              }
            } else {
              console.warn(`updateGraph: Field ${fieldName} on node ${nodeId} is not a string, cannot apply diff.`);
            }
          } else if (fieldUpdate.df) {
            console.warn(`updateGraph: 'diff' operation attempted on non-string or unsupported field '${fieldName}' for node ${nodeId}.`);
          }
        }
        
        if (updatesForNode.img_upd === true) {
            modifiedNode.updateImage = true;
            nodeSpecificContentChanged = true; 
        }

        if (nodeSpecificContentChanged) {
            hasContentChanges = true;
        }
        
        workingNodes[nodeIndex] = modifiedNode; 

        if (modifiedNode.updateImage && !processedNodeIdsForImage.has(nodeId)) {
            nodesToProcessForImageUpdate.push(modifiedNode);
            processedNodeIdsForImage.add(nodeId);
        }
      }
    }

    // 3. Process New Nodes (n_nodes)
    if (nodeEdition.n_nodes && nodeEdition.n_nodes.length > 0) {
      console.log('Processing new nodes:', nodeEdition.n_nodes);
      nodeEdition.n_nodes.forEach(newNode => {
        if (!workingNodes.find(n => n.id === newNode.id)) {
          workingNodes.push(newNode);
          if (newNode.updateImage && !processedNodeIdsForImage.has(newNode.id)) {
            nodesToProcessForImageUpdate.push(newNode);
            processedNodeIdsForImage.add(newNode.id);
          }
        } else {
          console.warn(`updateGraph: New node with ID ${newNode.id} already exists. Skipping addition.`);
        }
      });
      hasContentChanges = true;
    }
    
    let finalNodesState = workingNodes; 
    setNodes(finalNodesState);

    // Sorting and Moxus feedback logic (can remain largely the same, using hasContentChanges)
    if (isFromUserInteraction && currentChatHistory && currentChatHistory.length > 0) {
      if (import.meta.env.VITE_FEATURE_SORT_NODES !== "false") {
        try {
          console.log('Sorting nodes by relevance (YAML structure)');
          setTimeout(async () => {
            try {
              const sortedIds = await sortNodesByRelevance(finalNodesState, currentChatHistory);
              const sortedNodes = [...finalNodesState].sort((a, b) => {
                const aIndex = sortedIds.indexOf(a.id);
                const bIndex = sortedIds.indexOf(b.id);
                if (aIndex === -1 && bIndex === -1) return 0;
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
              });
              setNodes(sortedNodes);
              finalNodesState = sortedNodes; 
            } catch (error) {
              console.error('Error in delayed sorting:', error);
            }
          }, 50);
        } catch (error) {
          console.error('Error sorting nodes:', error);
        }
      } else {
        console.log('[useNodeGraph] Node sorting disabled. Moxus feedback relies on LLM call finalization elsewhere.');
      }
    } else {
        console.log('[useNodeGraph] Not a user interaction or no chat history, Moxus trigger relies on LLM call finalization elsewhere.');
    }

    // Image Generation Queuing
    if (nodesToProcessForImageUpdate.length > 0) {
      console.log('Queueing images for nodes:', nodesToProcessForImageUpdate.map(n => n.id));
      const batchSize = 3;
      for (let i = 0; i < nodesToProcessForImageUpdate.length; i += batchSize) {
        const batch = nodesToProcessForImageUpdate.slice(i, i + batchSize);
        setTimeout(() => {
          batch.forEach(node => {
            const matchingPrompt = imagePrompts.find(p => p.nodeId === node.id);
            if (matchingPrompt) {
              imageQueueService.addToQueueWithExistingPrompt(node as Node, matchingPrompt.prompt);
            } else {
              imageQueueService.addToQueue(node as Node, finalNodesState, currentChatHistory);
            }
          });
        }, i * 50); 
      }
    }
  }, [nodes, chatHistory, addMessage]); 

  return { 
    nodes: memoizedNodes, 
    addNode, 
    updateNode, 
    deleteNode, 
    updateGraph, 
    setNodes, 
    getNodes // Export getNodes
  };
}

export default useNodeGraph;
