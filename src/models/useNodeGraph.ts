import { useState, useEffect } from 'react';
import { Node } from './Node';
import { generateImage } from '../services/ImageService';
import { generateImagePrompt } from '../services/LLMService';
import LZString from 'lz-string';

const initNodes: Node[] = [
  {
    id: '0tg',
    name: 'Adventure game',
    shortDescription: 'The game is an adventure where the player has to reach the max level.',
    rules: `PlayerGainsLevelOnBeat;CharactersHaveHealthAndPower;DenyImpossibleActions;GameControlsEvents;GameChallengesPlayer;
      NoTeleportAllowed;GameHandlesEncounters;WriteDialogInChatText;WriteLikeNovel;
      AvoidToUpdateImageOnLocations;DescribeNewCharactersInNewNodes_WithHairClothesAndBodyShape;Always_DisplayPlayerAppearanceOnItsDescription`,
    longDescription: "",
    image: 'https://i.ibb.co/rvy5zgd/fec82e01-b0ad-4c96-a79f-745f675b4d15.webp',
    type: 'Game Rule',
    parent: '',
    child: ['8545', "8phg"]
  },
  {
    id: '854euh',
    name: 'Tavern',
    shortDescription: "The tavern is filled with joy.",
    rules: 'JoyfulFacade;TavernIsTrapForPlayer;FakeWarmth;LivelyAtmosphereHidesDanger;DiverseCrowd;RusticDecor;RoaringFire;SubtleTension;IfPlayerOrderBeerStartAmbush',
    longDescription: `The tavern is a warm, lively place in the bustling town. As you enter, cheerful chatter and music welcome you. 
      The room is filled with a diverse crowd, from adventurers to townsfolk. Rustic decorations and a roaring fire add to the cozy ambiance. 
      Despite the joyful environment, there's a subtle tension, as if the joy hides something sinister.`,
    image: 'https://popmenucloud.com/cdn-cgi/image/width%3D1200%2Cheight%3D1200%2Cfit%3Dscale-down%2Cformat%3Dauto%2Cquality%3D60/tsycfvqg/1325dd76-60a9-431f-b53d-a95ad105af43.jpg',
    type: 'Location',
    parent: '0tg',
    child: []
  },
  {
    id: '8phg',
    name: 'Player',
    shortDescription: 'The character\'s detail.',
    rules: 'Stats:HP Healthy; Strength Low; Agility Low; Intelligence Low; Charisma Low;',
    longDescription: "You are a man, aged 25 with an average appearance, wearing used clothes.",
    image: 'https://i.ibb.co/WBYTzDZ/DALL-E-2024-06-13-17-46-08-A-character-sheet-icon-with-a-fantasy-theme-The-icon-should-depict-a-scro.webp',
    type: 'Game Rules',
    parent: '0tg',
    child: []
  },
];

function useNodeGraph() {
  const [nodes, setNodes] = useState<Node[]>(() => {
    const savedNodes = localStorage.getItem('nodeGraph');
    if (savedNodes) {
      const decompressedNodes = LZString.decompress(savedNodes);
      return decompressedNodes ? JSON.parse(decompressedNodes) : initNodes;
    }
    return initNodes;
  });

  useEffect(() => {
    const compressedNodes = LZString.compress(JSON.stringify(nodes));
    localStorage.setItem('nodeGraph', compressedNodes);
  }, [nodes]);

  const addNode = (node: Node): void => {
    setNodes(prevNodes => [...prevNodes, node]);
  };

  const updateNode = (updatedNode: Node): void => {
    setNodes(prevNodes => prevNodes.map(node => (node.id === updatedNode.id ? updatedNode : node)));
  };

  const deleteNode = (nodeId: string): void => {
    setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeId));
  };

  const updateGraph = async (nodeEdition: { merge?: Partial<Node>[], delete?: string[] }) => {
    let newNodes = [...nodes];
    let imageGenerationCount = 0;

    if (nodeEdition.merge) {
      // First, collect all nodes that need image generation
      const nodesToUpdate = nodeEdition.merge.filter(updatedNode => {
        const nodeIndex = newNodes.findIndex(n => n.id === updatedNode.id);
        // Only include nodes that either:
        // 1. Are new (nodeIndex === -1) and image API is available
        // 2. Have updateImage flag set to true
        return (nodeIndex === -1 && import.meta.env.VITE_IMG_API) || updatedNode.updateImage === true;
      });

      if (nodesToUpdate.length > 4) {
        console.error('Safeguard: Exceeded maximum image generation limit per batch (4)');
        return;
      }

      let results;
      if (import.meta.env.VITE_IMG_API === 'novelai') {
        // For NovelAI:
        // 1. Generate all prompts in parallel first
        const promptPromises = nodesToUpdate.map(updatedNode => generateImagePrompt(updatedNode, newNodes));
        const prompts = await Promise.all(promptPromises);
        
        // 2. Then generate images sequentially
        results = [];
        for (let i = 0; i < nodesToUpdate.length; i++) {
          const updatedNode = nodesToUpdate[i];
          const prompt = prompts[i];
          let retryCount = 0;
          const maxRetries = 3;
          let success = false;
          
          while (!success && retryCount < maxRetries) {
            try {
              // Use existing seed if available, otherwise generate a new one
              const imageSeed = updatedNode.imageSeed || Math.floor(Math.random() * 4294967295);
              const image = await generateImage(prompt, imageSeed);
              if (image) {
                results.push({
                  node: { ...updatedNode, imageSeed }, // Store the seed in the node
                  image
                });
                success = true;
              } else {
                throw new Error('Empty image returned');
              }
            } catch (error: unknown) {
              retryCount++;
              if (error instanceof Error && error.message === 'RATE_LIMITED') {
                // For rate limiting, use exponential backoff
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`Rate limited. Retrying in ${delay/1000}s (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
              } else if (retryCount === maxRetries) {
                console.error(`Failed to generate image for node ${updatedNode.id} after ${maxRetries} attempts:`, error);
                results.push({
                  node: updatedNode,
                  image: ''
                });
              } else {
                // For other errors, use a fixed delay
                console.log(`Retrying image generation for node ${updatedNode.id} in 2s (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }
          
          // Add a delay between successful generations
          if (success) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      } else {
        // For other providers, process everything in parallel
        const imageGenerationPromises = nodesToUpdate.map(async (updatedNode) => {
          const prompt = await generateImagePrompt(updatedNode, newNodes);
          // Use existing seed if available, otherwise generate a new one
          const imageSeed = updatedNode.imageSeed || Math.floor(Math.random() * 4294967295);
          const image = await generateImage(prompt, imageSeed);
          return {
            node: { ...updatedNode, imageSeed }, // Store the seed in the node
            image
          };
        });
        results = await Promise.all(imageGenerationPromises);
      }

      // Update nodes with their generated images
      for (const result of results) {
        const { node, image } = result;
        const nodeIndex = newNodes.findIndex(n => n.id === node.id);
        const { updateImage, ...filteredNode } = node;
        
        if (nodeIndex !== -1) {
          Object.assign(newNodes[nodeIndex], { ...filteredNode, image });
        } else {
          newNodes.push({ ...filteredNode, image } as Node);
        }
      }

      // Handle nodes that don't need image generation
      for (const updatedNode of nodeEdition.merge) {
        if (!nodesToUpdate.includes(updatedNode)) {
          const nodeIndex = newNodes.findIndex(n => n.id === updatedNode.id);
          const { updateImage, ...filteredNode } = updatedNode;
          
          if (nodeIndex !== -1) {
            Object.assign(newNodes[nodeIndex], filteredNode);
          } else {
            newNodes.push(filteredNode as Node);
          }
        }
      }
    }

    if (nodeEdition.delete) {
      newNodes = newNodes.filter(n => !nodeEdition?.delete?.includes(n.id));
    }

    setNodes(newNodes);
  };

  return { nodes, addNode, updateNode, deleteNode, updateGraph, setNodes };
}

export default useNodeGraph;
