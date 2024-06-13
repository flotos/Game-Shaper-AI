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
    type: 'Game Rules',
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

  const updateGraph = async (nodeEdition: { merge?: Partial<Node>[], delete?: Node[] }) => {
    let newNodes = [...nodes];
    let imageGenerationCount = 0;  // Initialize counter for image generations

    if (nodeEdition.merge) {
      for (const updatedNode of nodeEdition.merge) {
        const nodeIndex = newNodes.findIndex(n => n.id === updatedNode.id);

        if (updatedNode.updateImage || nodeIndex === -1) {
          if (imageGenerationCount >= 4) {
            console.error('Safeguard: Exceeded maximum image generation limit per batch (4)');
            break;  // Stop further image generation if limit is reached
          }

          const prompt = await generateImagePrompt(updatedNode, newNodes);
          updatedNode.image = await generateImage(prompt);
          imageGenerationCount++;  // Increment counter after generating an image
        }

        const { updateImage, ...filteredNode } = updatedNode;

        if (nodeIndex !== -1) {
          Object.assign(newNodes[nodeIndex], filteredNode);
        } else {
          newNodes.push(filteredNode as Node);
        }
      }
    }

    // Handle delete operations
    if (nodeEdition.delete) {
      console.log("should delete a node", { nodeEditionDelete: nodeEdition.delete, newNodes });
      newNodes = newNodes.filter(n => !nodeEdition.delete.includes(n.id));
      console.log("Updated", { newNodes });
    }


    // Finally, update the state with the new nodes array
    setNodes(newNodes);
  };

  return { nodes, addNode, updateNode, deleteNode, updateGraph };
}

export default useNodeGraph;
