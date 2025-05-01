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

  const updateGraph = async (nodeEdition: { 
    merge?: Partial<Node>[], 
    delete?: string[], 
    appendEnd?: Partial<Node>[],
    newNodes?: string[] 
  }, imagePrompts: { nodeId: string, prompt: string }[] = []) => {
    if (!nodeEdition) return;

    console.log('Starting graph update with node edition:', nodeEdition);
    console.log('Image prompts to process:', imagePrompts);
    const newNodes = [...nodes];
    let nodesToProcess: Partial<Node>[] = [];
    const imagePromptTimes: number[] = [];
    const processedNodeIds = new Set<string>();

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
        const index = newNodes.findIndex(node => node.id === updatedNode.id);
        if (index !== -1) {
          const existingNode = newNodes[index];
          newNodes[index] = { ...existingNode, ...updatedNode };
        } else {
          newNodes.push(updatedNode as Node);
        }
      });
    }

    // Process new nodes
    if (nodeEdition.newNodes) {
      console.log('Adding new nodes:', nodeEdition.newNodes);
      nodeEdition.newNodes.forEach(nodeId => {
        const node = newNodes.find(n => n.id === nodeId);
        if (node && !processedNodeIds.has(nodeId)) {
          nodesToProcess.push(node);
        }
      });
    }

    setNodes(newNodes);
    console.log('Updating nodes with new images:', nodesToProcess);

    // Queue image generation for new nodes (sequential)
    if (nodesToProcess.length > 0) {
      console.log('Starting sequential image generation for new nodes');
      for (let i = 0; i < nodesToProcess.length; i++) {
        const node = nodesToProcess[i];
        if (!node.id || processedNodeIds.has(node.id)) {
          console.log(`Skipping already processed node ${node.id}`);
          continue;
        }
        console.log(`Processing image for new node ${i + 1}/${nodesToProcess.length}: ${node.id}`);
        
        try {
          const startTime = Date.now();
          // Generate prompt
          const prompt = await generateImagePrompt(node, newNodes, []);
          console.log(`Generated prompt for node ${node.id}`);
          
          // Generate image
          const imageUrl = await generateImage(prompt);
          console.log(`Generated image for node ${node.id}`);
          
          // Update node
          const index = newNodes.findIndex(n => n.id === node.id);
          if (index !== -1) {
            const existingNode = newNodes[index];
            newNodes[index] = {
              ...existingNode,
              image: imageUrl,
              updateImage: true
            };
            processedNodeIds.add(node.id);
            // Update state and wait for it to complete
            await new Promise<void>(resolve => {
              setNodes([...newNodes]);
              // Use a small delay to ensure state update is complete
              setTimeout(resolve, 100);
            });
          }
          imagePromptTimes.push(Date.now() - startTime);
          // Add a delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error: any) {
          console.error('Error generating image for new node:', node.id, error);
          // If we hit a rate limit, wait longer before retrying
          if (error.message?.includes('429')) {
            console.log('Rate limit hit, waiting 10 seconds before continuing...');
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }
      }
    }
  };

  return { nodes, addNode, updateNode, deleteNode, updateGraph, setNodes };
}

export default useNodeGraph;
