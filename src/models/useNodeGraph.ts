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
        return updatedNode.updateImage || (nodeIndex === -1 && import.meta.env.VITE_IMG_API);
      });

      if (nodesToUpdate.length > 4) {
        console.error('Safeguard: Exceeded maximum image generation limit per batch (4)');
        return;
      }

      // Generate all images in parallel
      const imageGenerationPromises = nodesToUpdate.map(async (updatedNode) => {
        const promptPromise = generateImagePrompt(updatedNode, newNodes);
        const imagePromise = promptPromise.then(prompt => generateImage(prompt));
        return {
          node: updatedNode,
          image: await imagePromise
        };
      });

      let results;
      if (import.meta.env.VITE_IMG_API === 'novelai') {
        // For NovelAI, process images sequentially
        results = [];
        for (const promise of imageGenerationPromises) {
          results.push(await promise);
        }
      } else {
        // For other providers, process images in parallel
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
