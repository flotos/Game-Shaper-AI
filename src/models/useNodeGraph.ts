import { useState, useEffect } from 'react';
import { Node } from './Node';
import { generateImage } from '../services/ImageService';
import { generateImagePrompt } from '../services/LLMService';
import LZString from 'lz-string';

const initNodes: Node[] = [
  {
    id: '0tg',
    name: 'Adventure game',
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

  const updateGraph = async (nodeEdition: { merge?: Partial<Node>[], delete?: string[], appendEnd?: Partial<Node>[] }) => {
    if (!nodeEdition) return;

    const newNodes = [...nodes];
    const nodesToProcess: Partial<Node>[] = [];
    const imagePromptTimes: number[] = [];

    // Process deletions first
    if (nodeEdition.delete) {
      nodeEdition.delete.forEach(id => {
        const index = newNodes.findIndex(node => node.id === id);
        if (index !== -1) {
          newNodes.splice(index, 1);
        }
      });
    }

    // Process updates and new nodes
    if (nodeEdition.merge) {
      nodeEdition.merge.forEach(updatedNode => {
        const index = newNodes.findIndex(node => node.id === updatedNode.id);
        if (index !== -1) {
          newNodes[index] = { ...newNodes[index], ...updatedNode };
          if (updatedNode.updateImage) {
            nodesToProcess.push(newNodes[index]);
          }
        } else {
          newNodes.push(updatedNode as Node);
          if (updatedNode.updateImage) {
            nodesToProcess.push(updatedNode);
          }
        }
      });
    }

    // Process append operations
    if (nodeEdition.appendEnd) {
      nodeEdition.appendEnd.forEach(nodeToAppend => {
        const index = newNodes.findIndex(node => node.id === nodeToAppend.id);
        if (index !== -1) {
          const existingNode = newNodes[index];
          newNodes[index] = {
            ...existingNode,
            longDescription: existingNode.longDescription + (nodeToAppend.longDescription || ''),
            rules: existingNode.rules + (nodeToAppend.rules || ''),
            name: existingNode.name + (nodeToAppend.name || ''),
            type: existingNode.type + (nodeToAppend.type || ''),
            child: [...existingNode.child, ...(nodeToAppend.child || [])],
            parent: nodeToAppend.parent || existingNode.parent
          };
          if (nodeToAppend.updateImage) {
            nodesToProcess.push(newNodes[index]);
          }
        }
      });
    }

    let results: { node: Partial<Node>, image: string }[] = [];

    if (nodesToProcess.length > 0) {
      if (import.meta.env.VITE_IMG_API === 'novelai') {
        // For NovelAI:
        // 1. Generate all prompts in parallel first
        const promptPromises = nodesToProcess.map(async (updatedNode) => {
          const promptStartTime = Date.now();
          const prompt = await generateImagePrompt(updatedNode, newNodes);
          const promptEndTime = Date.now();
          imagePromptTimes.push(promptEndTime - promptStartTime);
          return prompt;
        });
        const prompts = await Promise.all(promptPromises);
        
        // 2. Then generate images sequentially
        results = [];
        for (let i = 0; i < nodesToProcess.length; i++) {
          const updatedNode = nodesToProcess[i];
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
            } catch (error) {
              retryCount++;
              if (retryCount === maxRetries) {
                console.error('Failed to generate image after', maxRetries, 'attempts:', error);
                throw error;
              }
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
          }
        }
      } else {
        // For other APIs, process sequentially
        for (const updatedNode of nodesToProcess) {
          const promptStartTime = Date.now();
          const prompt = await generateImagePrompt(updatedNode, newNodes);
          const promptEndTime = Date.now();
          imagePromptTimes.push(promptEndTime - promptStartTime);
          
          let retryCount = 0;
          const maxRetries = 3;
          let success = false;
          
          while (!success && retryCount < maxRetries) {
            try {
              const imageSeed = updatedNode.imageSeed || Math.floor(Math.random() * 4294967295);
              const image = await generateImage(prompt, imageSeed);
              if (image) {
                results.push({
                  node: { ...updatedNode, imageSeed },
                  image
                });
                success = true;
              } else {
                throw new Error('Empty image returned');
              }
            } catch (error) {
              retryCount++;
              if (retryCount === maxRetries) {
                console.error('Failed to generate image after', maxRetries, 'attempts:', error);
                throw error;
              }
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
          }
        }
      }
    }

    // Update nodes with new images
    results.forEach(({ node, image }) => {
      const index = newNodes.findIndex(n => n.id === node.id);
      if (index !== -1) {
        newNodes[index] = { ...newNodes[index], image };
      }
    });

    setNodes(newNodes);
    return imagePromptTimes;
  };

  return { nodes, addNode, updateNode, deleteNode, updateGraph, setNodes };
}

export default useNodeGraph;
