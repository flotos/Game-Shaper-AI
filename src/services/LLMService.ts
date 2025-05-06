import { Node } from '../models/Node';
import prompts from '../../prompts.json';
import { Message } from '../context/ChatContext';

interface ExtractedElement {
  type: string;
  name: string;
  content: string;
  relationships?: Array<{
    target: string;
    type: string;
  }>;
}

interface ExtractedData {
  chunks: ExtractedElement[][];
}

// Twine import prompts
export const TWINE_DATA_EXTRACTION_PROMPT = `

# Instructions
You are a Game Engine. Your task is to analyze and extract structured data from a Twine story.
  
# Rules
1. Extract key story elements, characters, locations, and events
2. Identify relationships and connections between elements
3. Preserve important narrative structures and branching paths
4. Remove any technical or formatting elements not relevant to the story
5. Structure the data in a way that can be used to generate game nodes
6. Give two example paragraphs written in the style of the story

[Additional Instructions will be inserted here]

# Twine content
---start of twine content---
[Content will be inserted here]
---end of twine content---

# Return format

Return a JSON object with the following structure:
{
  "elements": [
    {
      "type": "character|location|event|item|concept|paragraph",
      "name": "element name",
      "content": "detailed description or content",
      "relationships": [
        {
          "target": "related element name",
          "type": "relationship type"
        }
      ]
    }
  ]
}`;

export const TWINE_NODE_GENERATION_PROMPT_NEW_GAME = `

# Instructions
You are a Game Engine. Your task is to create a completely new game based on the extracted story data.

# Rules
1. Create a new game world based on the extracted story elements
2. Use the existing node structure only as a template for formatting
3. Generate a complete new set of nodes that form a coherent game world
4. Ensure proper relationships between nodes using parent/child fields
5. Set updateImage to true for nodes that represent physical entities
6. When using the extracted story data:
  - All the listed events are possible outcomes in the game. These are NOT memories or past events.
  - All the locations are possible encounters, but consider these have not yet been visited by the player.

[Additional Instructions will be inserted here]

# Extracted Story Data
---
[Extracted data will be inserted here]
---

# Existing Nodes (for structure reference only)
---
[Nodes description will be inserted here]
---

# Return format

Return a JSON object with the following structure:
{
  "merge": [
    {
      "id": "unique-id",
      "name": "node name",
      "longDescription": "detailed description",
      "rules": "rules and internal info",
      "type": "node type",
      "parent": "parent id",
      "child": ["child ids"],
      "updateImage": true/false
    }
  ]
}`;

export const TWINE_NODE_GENERATION_PROMPT_MERGE = `

# Instructions
You are a Game Engine. Your task is to merge the extracted story data into the existing game world.

# Rules
1. Analyze how the extracted story elements fit with existing nodes
2. For each existing node:
   - Keep it if it's still relevant
   - Update it if it needs changes to fit the new story
   - Mark it for deletion if it's no longer relevant
3. For new story elements:
   - Create new nodes with unique IDs
   - Ensure they connect properly with existing nodes
   - Set updateImage to true for physical entities
4. Maintain consistency between old and new elements
5. When using the extracted story data:
  - All the listed events are possible outcomes in the game. These are NOT memories or past events.
  - All the locations are possible encounters, but consider these have not yet been visited by the player.
6. In the newly generated nodes, NEVER mention "added" or "updated". You should return the new node as it should be.

[Additional Instructions will be inserted here]

# Extracted Story Data
---
[Extracted data will be inserted here]
---

# Existing Nodes to Merge With
---
[Nodes description will be inserted here]
---

# Return format

Return a JSON object with the following structure:
{
  "merge": [
    {
      "id": "unique-id",
      "name": "node name",
      "longDescription": "detailed description",
      "rules": "rules and internal info",
      "type": "node type",
      "parent": "parent id",
      "child": ["child ids"],
      "updateImage": true/false
    }
  ],
  "delete": ["nodeID1ToDelete", "nodeID2ToDelete", ...]
}`;

export const generateImagePrompt = async(node: Partial<Node>, allNodes: Node[], chatHistory: Message[] = []) => {
  console.log('LLM Call: Generating image prompt for node:', node.id);
  // Check for nodes with type "image_generation"
  const imageGenerationNodes = allNodes.filter(n => n.type === "image_generation");
  
  let contentPrompt = "";

  // If there are image generation nodes, use their content
  if (imageGenerationNodes.length > 0) {
    contentPrompt += `
    /no_think
    --> Your task
    The following instructions are to generate ONE image. It is very important to ensure only one image is generated.
    Your reply should be the prompt directly, with no comment, no reasoning.
    The "real" titles of these instructions are separated by the "-->" flag.

    --> Image generation instructions Guidelines
    `
    
    contentPrompt += imageGenerationNodes.map(n => {
      let prompt = "";
      if (n.longDescription) prompt += n.longDescription + "\n";
      if (n.rules) prompt += n.rules + "\n";
      return prompt;
    }).join("\n");

    // Add the nodes details from allNodes
    contentPrompt += `
    --> The Game object to generate the image for

    You will generate the caption of image for a game object.
    The image is for the following object :
    --
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}
    --

    --> Additional Context

    Here are the other game nodes in the scene to give some context. Only use these information to help get a grasp of the scene and keep coherence:
    ${allNodes.reduce((acc, nodet) => {
      return acc + `
      ---
      name: ${nodet.name}
      rules: ${nodet.rules}
      `;
    }, "")}
    
    --> Recent Chat History
    ${chatHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n')}
    
    --> Final word
    Now, generate the image prompt, with no comment, no reasoning.
    `;
  } else {
    // Default prompt when no image generation nodes exist
    contentPrompt = `
    You will generate the caption of image for a game object.
    The image is for the following object :
    --
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}

    Here are the other nodes in the scene to give some context:
    ${allNodes.reduce((acc, nodet) => {
      return acc + `
      ---
      name: ${nodet.name}
      rules: ${nodet.rules}
      `;
    }, "")}

    Recent Chat History:
    ${chatHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n')}

    The caption should be a concise text at most 2 sentences describing what we can see on the image. Don't write anything else.
    It should describe what can be seen now.
    Use the object's long description mostly, and just a bit the information from "rules" that was given for some context.
    `;
  }

  const messages: Message[] = [
    { role: 'system', content: contentPrompt },
  ];

  return getResponse(messages);
}

export const getRelevantNodes = async(userInput: string, chatHistory: Message[], nodes: Node[]) => {
  console.log('LLM Call: Getting relevant nodes');
  const stringHistory = chatHistory.reduce((acc, message) => {
    if(message.role == "user" || message.role == "assistant") {
      return acc + `${message.role}: ${message.content}\n`;
    }
    return acc;
  }, "");

  const nodesDescription = nodes.reduce((acc, node) => {
    return acc + `
    ---
    id: ${node.id}
    name: ${node.name}
    rules: ${node.rules}
    type: ${node.type}
    child: ${node.child}
    parent: ${node.parent}
    
    `;
  }, "");

  const prompt = `
    Given the following nodes from a graph, find the ones that are relevant to the user's action.
    You should consider the nodes descriptions, and their relationships using ID in "child" and "parent" values.

    Return a JSON object with a single field "relevantNodes" containing an array of node IDs.
    Each ID entry in the array should be enclosed in quotes.

    # Example 1:
    ## Nodes
    ---
    id: "98ak"
    name: A playing card
    rules: The card has heavy wear and can be distinguished
    type: Card
    child: []
    parent: 10eg
    ---
    id: "10eg"
    name: A deck of cards
    rules: Only one card (the 10 of heart) is not mint.
    type: Object
    child: ["98ak"]
    parent: 121

    ## User message history with the narrator
    assistant: You are in a dark room and can only the one card
    user: take and observe the card

    ## Your answer
    {
      "relevantNodes": ["98ak"]
    }

    # Your turn:
    ## Nodes
    ${nodesDescription}

    ## User message history with the narrator
    ${stringHistory}

    ##Your answer
  `;

  const messages: Message[] = [
    { role: 'system', content: prompt },
  ];

  const response = await getResponse(messages, "gpt-3.5-turbo", undefined, false, { type: 'json_object' });
  const parsed = JSON.parse(response);
  return parsed.relevantNodes;
}

export const generateChatText = async(userInput: string, chatHistory: Message[], nodes: Node[], detailledNodeIds: String[]) => {
  console.log('LLM Call: Generating chat text');
  const stringHistory = chatHistory.reduce((acc, message) => {
    if (message.role === "user" || message.role === "assistant") {
      return acc + `${message.role}: ${message.content}\n`;
    }
    return acc;
  }, "");
  
  const nodesDescription = nodes.reduce((acc, node) => {
    // Skip image_generation nodes
    if (node.type === "image_generation") {
      return acc;
    }

    // If there are less than 15 nodes, include full content
    if (nodes.length < 15) {
      return acc + `
        id: ${node.id}
        name: ${node.name}
        longDescription: ${node.longDescription}
        rules: ${node.rules}
        type: ${node.type}
        child: ${node.child}
        parent: ${node.parent}
        `;
    } else {
      // Original behavior for 15 or more nodes
      return acc + `
        id: ${node.id}
        name: ${node.name}
        longDescription: ${node.longDescription}
        rules: ${node.rules}${node.id in detailledNodeIds || node.type == "Game Rule" ? `\n${node.longDescription}\n` : ""}
        type: ${node.type}
        child: ${node.child}
        parent: ${node.parent}
        `;
    }
  }, "");

  const chatTextPrompt = `
  # TASK:
  You are the Game Engine of a Node-base game, which display a chat and images for each node on the right panel.
  Generate appropriate dialogue based on user interaction. Consider node relationships, hidden descriptions, and possible actions for a coherent game state update.
  You will make the world progress by itself at every round, in addition to any action the player make in the world. Each user action should have a significant impact.

  Do not mention any node updates/change/deletion, as another LLM call will handle this.

  ## Game Content:
  ### Current Nodes:
  ${nodesDescription}
  
  ### Chat History:
  ${stringHistory}
  
  ### User Input:
  ${userInput}
  
  Generate a detailed chapter (3 to 4 paragraphs) making the story progress, with efficient but short descriptions.
  Don't ask questions to the player.
  Produce new content, make the plot progress, and avoid repeating what was said before.
  `;

  const chatTextMessages: Message[] = [
    { role: 'system', content: chatTextPrompt },
  ];

  const chatTextResponse = await getResponse(chatTextMessages, 'gpt-4o', undefined, true);
  return chatTextResponse;
}

export const generateActions = async(chatText: string, nodes: Node[], userInput: string) => {
  console.log('LLM Call: Generating actions');
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation") {
      return acc;
    }
    return acc + `
      id: ${node.id}
      name: ${node.name}
      longDescription: ${node.longDescription}
      rules: ${node.rules}
      type: ${node.type}
      child: ${node.child}
      parent: ${node.parent}
      `;
  }, "");

  const actionsPrompt = `
  # TASK:
  Based on the following game state and narrative, generate two interesting actions the player can take next.
  The actions should be natural continuations of the story and make sense in the current context.

  ## Current Game State:
  ${nodesDescription}

  ## Current Narrative:
  ${chatText}

  ## User's Last Input:
  ${userInput}

  Return a JSON object with a single field "actions" containing an array of exactly two strings, each describing one possible action.
  Example: { "actions": ["examine the mysterious door", "ask the merchant about the strange artifact"] }
  `;

  const actionsMessages: Message[] = [
    { role: 'system', content: actionsPrompt },
  ];

  const actionsResponse = await getResponse(actionsMessages, 'gpt-4o', undefined, false, { type: 'json_object' });
  const parsed = JSON.parse(actionsResponse);
  return parsed.actions;
}

export const generateNodeEdition = async(chatText: string, actions: string[], nodes: Node[], userInput: string, isUserInteraction: boolean = false) => {
  console.log('LLM Call: Generating node edition');
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation") {
      return acc;
    }
    return acc + `
      id: ${node.id}
      name: ${node.name}
      longDescription: ${node.longDescription}
      rules: ${node.rules}
      type: ${node.type}
      child: ${node.child}
      parent: ${node.parent}
      `;
  }, "");

  const nodeEditionPrompt = `
  ${isUserInteraction ? '/no_think' : '/think'}
  # TASK:
  Based on the following game state, narrative, and possible actions, update the game graph.
  Consider node relationships, hidden descriptions, and possible actions for a coherent game state update.

  ## Node Properties:
  - id: Unique id string
  - name: title
  - longDescription: (Mandatory) Detailed description, write everything that is visible or that the player should know.
  - rules: (Mandatory) Internal info for AI that player shouldn't see. Store rich, reusable information in a structured format:
    * Use semicolons to separate different aspects
    * Character and World: traits, motivations, relationships, physical characteristics, cultural context
    * Environment and Atmosphere: details, mood, potential interactions and consequences
    * Story Elements: plot hooks, foreshadowing, unresolved mysteries, thematic elements
    * Game Mechanics: hidden triggers, past events impact, future developments
    * Story Generation: hints for future narrative development, character arcs, world-building opportunities
  - type: Category/type (e.g., 'item', 'location', 'character', 'event', ...). The special type "Game Rule" should be used for rules that should be enforced by the Game Engine.
  - parent: ID of the parent node (has to match an existing or newly created node)
  - child: Array of child node IDs (has to match an existing or newly created node)
  - updateImage: (Optional) Set to true if the node represents a physical object, character, or location that should have a visual representation. This is particularly important for:
    * New nodes that represent physical entities (characters, items, locations)
    * Existing nodes whose visual appearance has changed significantly
    * Nodes that need their first image generated
    * Nodes that need an image update due to significant changes in their description or rules
    DO NOT set updateImage to true for abstract concepts, game rules, or system nodes that don't need visual representation.

  ## Current Game State:
  ${nodesDescription}

  ## Current Narrative:
  ${chatText}

  ## Possible Actions:
  ${JSON.stringify(actions)}

  ## User's Last Input:
  ${userInput}

  Return a JSON object with:
  {
    "merge": "(Array of nodes object) List of nodes to be updated or created. If a new id is specified it will create new nodes. If a node has a new behaviour, update it by specifying its id. Each node MUST include: id, name, longDescription, rules, type, parent, and child fields. Include updateImage: true for nodes that need a new image.",
    "delete": "(Array of node id) List nodes to be removed and justify their removal. Nodes that became irrelevant for a while should be deleted.",
    "newNodes": "(Array of node ids) List of newly created node IDs that should have their images generated. This should include all nodes in 'merge' that have new IDs not present in the current game state."
  }

  IMPORTANT: Your response must be a valid JSON object and nothing else. Do not include any markdown formatting, code blocks, or additional text before or after the JSON object.
  The response should start with { and end with } with no additional characters.
  Each node in the "merge" array MUST include ALL required fields: id, name, longDescription, rules, type, parent, and child.
  The type field is mandatory and should be one of: 'item', 'location', 'character', 'event', 'Game Rule', etc.

  Try to not to exceed 10 nodes in the graph, either by merging existing ones that share same concepts instead of creating new nodes, or deleting irelevant ones.
  Keep the logic properly scoped in each node. Prefer to store information in the node that is impacted by the change rather by the one triggering it.
  When creating new nodes, be creative and surprise the user with its content. You have to create an interesting game for the player.
  You VERY MUCH have to enforce the world rules and not comply with the user action if it doesn't fit with the Game Rule.
  `;

  const nodeEditionMessages: Message[] = [
    { role: 'system', content: nodeEditionPrompt },
  ];

  const nodeEditionResponse = await getResponse(nodeEditionMessages, 'gpt-4o', undefined, false, { type: 'json_object' });
  try {
    const parsedResponse = JSON.parse(nodeEditionResponse);
    
    // Ensure newNodes field exists and is an array
    if (!parsedResponse.newNodes) {
      parsedResponse.newNodes = [];
    }

    // Preserve type for image_generation nodes
    if (parsedResponse.merge) {
      parsedResponse.merge = parsedResponse.merge.map((node: any) => {
        const existingNode = nodes.find(n => n.id === node.id);
        if (existingNode && existingNode.type === "image_generation") {
          return { ...node, type: "image_generation" };
        }
        return node;
      });
    }
    
    return parsedResponse;
  } catch (error) {
    console.error('Error parsing node edition response:', error);
    console.error('Response content:', nodeEditionResponse);
    throw new Error('Failed to parse node edition response as JSON. Please ensure the response is properly formatted.');
  }
}

export const generateUserInputResponse = async(userInput: string, chatHistory: Message[], nodes: Node[], detailledNodeIds: String[]) => {
  // First generate chat text
  const chatText = await generateChatText(userInput, chatHistory, nodes, detailledNodeIds);
  
  // Run processes in parallel
  const [actions, nodeEdition] = await Promise.all([
    generateActions(chatText, nodes, userInput),
    generateNodeEdition(chatText, [], nodes, userInput, true)
  ]);
  
  // Return the results
  return {
    chatText,
    actions,
    nodeEdition,
    // Image generation will be handled separately for new nodes only
  };
}

export const generateNodesFromPrompt = async (prompt: string, nodes: Node[]) => {
  
  const nodesDescription = nodes.reduce((acc, node) => {
    return acc + `
    id: ${node.id}
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}
    child: ${node.child}
    parent: ${node.parent}
    `;
  }, "");

  const promptMessage = `
  You are a Game Engine. The user asked to update how the game work or to change some aspect of the world.
  Your task is to update the game nodes based on the following prompt, for a Game Engine:
  ---
  ${prompt}
  ---

  Here are the existing nodes:
  ---
  ${nodesDescription}

  IMPORTANT: When updating nodes, you must follow these critical rules:
  1. NEVER reference or assume knowledge of the previous state of a node. Each node update is a complete replacement.
  2. You must explicitly include ALL content you want to preserve in the updated node. Any content not included will be lost.
  3. Each node update should be self-contained and complete, with no dependencies on previous states.
  4. If you want to keep any information from the previous state, you must explicitly copy it into the new node.
  5. The updateImage field MUST be included for each node and set to true if there are significant visual changes that should trigger a new image generation (but game systems or lore nodes shouldn't have an image).
  6. If there are instructions about "merging multiple nodes together", choose one of the existing node to update, and delete the others.
  7. A node is worthy to exist only if it contains at least a full paragraph, otherwise another node should cover its content. For example for room containing lot of object, the objects should be stored in the "room" node if they aren't too detailled each. Or use a "hand of cards" node for a deck related node-graph instead of each card separately.
  8. Maintain one or few nodes for the global game systems, trying not to disseminate game rules into too many nodes. If multiple node, each should focus on a concept, but at least one node should summarize all the game systems and serve as a high-level reference.
  9. Do not update the image_generation type nodes unless explicitely mentionned.
  10. All node should represent a game system, a lore entry, character, or an object. These should NOT be used to describe events or time-limited things. If a specific event need to be remembered, store it in a "memory" game system node.

  Each node should be described in a JSON format with the following properties:
  {
    "id": "unique-id",
    "name": "node name",
    "longDescription": "Lengthy description, detailling the node completely. For game Systems, be exhaustive. For content or characters, generate at least a full paragraph.",
    "rules": "rules, written in a concise, compressed way.",
    "type": "node type",
    "parent": "parent id",
    "child": ["child ids"],
    "updateImage": true/false  // Set to true if the node's visual appearance has changed significantly, false otherwise
  }

  The generated nodes should NOT count as a game round and make the content progress. You have to create either Game systems or content in the world.
  Ensure proper JSON syntax and do not include any other text except the JSON array.
  Return an object in this format:
  {
    "merge": [{node1Content...}, {node2Content...}],
    "delete": ["nodeID1ToDelete","nodeID2ToDelete", ...]
  }
  `;

  const messages: Message[] = [
    { role: 'system', content: promptMessage },
  ];

  const response = await getResponse(messages, 'gpt-4o');
  return JSON.parse(response);
};

export const extractDataFromTwine = async (
  content: string,
  dataExtractionInstructions?: string,
  extractionCount: number = 1
) => {
  console.log('LLM Call: Extracting data from Twine content');
  
  // Split content into chunks and perform parallel data extraction
  const totalLength = content.length;
  const chunkSize = Math.ceil(totalLength / extractionCount);
  const chunks: string[] = [];
  
  for (let i = 0; i < extractionCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalLength);
    chunks.push(content.slice(start, end));
  }

  const extractionPromises = chunks.map((chunk, index) => {
    const extractionPrompt = TWINE_DATA_EXTRACTION_PROMPT
      .replace('[Additional Instructions will be inserted here]', dataExtractionInstructions || '')
      .replace('[Content will be inserted here]', chunk);

    const extractionMessages: Message[] = [
      { role: 'system', content: extractionPrompt },
    ];

    return getResponse(extractionMessages, 'gpt-4o', undefined, false, { type: 'json_object' });
  });

  // Wait for all extractions to complete
  const extractionResults = await Promise.all(extractionPromises);
  
  // Combine all extracted data while maintaining chunk structure
  const combinedExtractedData = {
    chunks: extractionResults.map(result => {
      const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
      return parsedResult.elements || [];
    })
  };

  return combinedExtractedData;
};

export const generateNodesFromExtractedData = async (
  extractedData: ExtractedData,
  nodes: Node[],
  mode: 'new_game' | 'merge_story',
  nodeGenerationInstructions?: string
) => {
  console.log('LLM Call: Generating nodes from extracted data in mode:', mode);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    return acc + `
    id: ${node.id}
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}
    child: ${node.child}
    parent: ${node.parent}
    `;
  }, "");

  const generationPromptTemplate = mode === 'new_game' ? 
    TWINE_NODE_GENERATION_PROMPT_NEW_GAME : 
    TWINE_NODE_GENERATION_PROMPT_MERGE;

  const generationPrompt = generationPromptTemplate
    .replace('[Additional Instructions will be inserted here]', nodeGenerationInstructions || '')
    .replace('[Extracted data will be inserted here]', JSON.stringify(extractedData, null, 2))
    .replace('[Nodes description will be inserted here]', nodesDescription);

  const generationMessages: Message[] = [
    { role: 'system', content: generationPrompt },
  ];

  const response = await getResponse(generationMessages, 'gpt-4o', undefined, false, { type: 'json_object' });
  
  try {
    // Check if response is already a parsed object
    const parsedResponse = typeof response === 'string' ? JSON.parse(response) : response;
    
    // Ensure the response has the correct structure
    if (!parsedResponse.merge || !Array.isArray(parsedResponse.merge)) {
      throw new Error('Invalid response structure: missing or invalid merge array');
    }
    
    // Handle different modes
    if (mode === 'new_game') {
      // For new game, all existing nodes will be deleted
      parsedResponse.delete = nodes.map(node => node.id);
      // All nodes in merge are new nodes
      parsedResponse.newNodes = parsedResponse.merge.map((node: any) => node.id);
    } else if (mode === 'merge_story') {
      // For merge mode, ensure delete array exists
      if (!parsedResponse.delete) {
        parsedResponse.delete = [];
      }
      // Calculate newNodes by comparing with existing nodes
      const existingNodeIds = new Set(nodes.map(node => node.id));
      parsedResponse.newNodes = parsedResponse.merge
        .filter((node: any) => !existingNodeIds.has(node.id))
        .map((node: any) => node.id);
    }
    
    // Ensure each node in merge has all required fields
    parsedResponse.merge.forEach((node: any) => {
      const missingFields = [];
      if (!node.id) missingFields.push('id');
      if (!node.name) missingFields.push('name');
      if (!node.longDescription) missingFields.push('longDescription');
      if (!node.type) missingFields.push('type');
      if (node.parent === undefined) missingFields.push('parent');
      if (!Array.isArray(node.child)) missingFields.push('child (must be an array)');
      
      // Add default empty string for missing rules
      if (!node.rules) {
        node.rules = '';
      }
      
      if (missingFields.length > 0) {
        console.error('Problematic node data:', JSON.stringify(node, null, 2));
        throw new Error(`Invalid node structure: missing required fields in node ${node.id || 'unknown'}: ${missingFields.join(', ')}`);
      }
    });
    
    return parsedResponse;
  } catch (error) {
    console.error('Error parsing Twine import response:', error);
    console.error('Response content:', response);
    throw new Error('Failed to parse Twine import response as JSON. Please ensure the response is properly formatted.');
  }
};

// Keep the original function for backward compatibility, but make it use the new split functions
export const generateNodesFromTwine = async (
  content: string,
  nodes: Node[],
  mode: 'new_game' | 'merge_story',
  dataExtractionInstructions?: string,
  nodeGenerationInstructions?: string,
  extractionCount: number = 1
) => {
  const extractedData = await extractDataFromTwine(content, dataExtractionInstructions, extractionCount);
  return generateNodesFromExtractedData(extractedData, nodes, mode, nodeGenerationInstructions);
};

/**
 * Available OpenRouter Text Models:
 * - anthropic/claude-3-opus-20240229
 * - anthropic/claude-3-sonnet-20240229
 * - anthropic/claude-3-haiku-20240307
 * - anthropic/claude-2.1
 * - anthropic/claude-2.0
 * - google/gemini-pro
 * - google/gemini-1.0-pro
 * - meta-llama/llama-2-70b-chat
 * - meta-llama/llama-2-13b-chat
 * - mistral/mistral-medium
 * - mistral/mistral-small
 * - mistral/mixtral-8x7b
 * - nousresearch/nous-hermes-2-mixtral-8x7b-dpo
 * - perplexity/pplx-70b-online
 * - perplexity/pplx-7b-online
 * For pricing and capabilities, see: https://openrouter.ai/docs#models
 */

const getResponse = async (messages: Message[], model = 'gpt-4o', grammar: String | undefined = undefined, stream = false, responseFormat?: { type: string }) => {
  const apiType = import.meta.env.VITE_LLM_API;
  const includeReasoning = import.meta.env.VITE_LLM_INCLUDE_REASONING !== 'false';
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second

  // Ensure there's at least one user message for OpenRouter
  if (apiType === 'openrouter') {
    const hasUserMessage = messages.some(msg => msg.role === 'user');
    if (!hasUserMessage) {
      messages.push({ role: 'user', content: 'Please process the system instructions.' });
    }
  }

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let response;
      if (apiType === 'openai') {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_OAI_KEY}`
          },
          body: JSON.stringify({
            model: model,
            messages: messages,
            stream: stream,
            response_format: responseFormat
          })
        });
      } else if (apiType === 'openrouter') {
        // Get the configured model or use a default
        const openrouterModel = import.meta.env.VITE_OPENROUTER_MODEL || 'anthropic/claude-3-opus-20240229';
        const openrouterProvider = import.meta.env.VITE_OPENROUTER_PROVIDER;
        console.log('Using OpenRouter model:', openrouterModel, 'from provider:', openrouterProvider);

        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_OPENROUTER_KEY}`,
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Game Shaper AI'
          },
          body: JSON.stringify({
            model: openrouterModel,
            messages: messages.map(msg => ({
              role: msg.role,
              content: [{
                type: "text",
                text: msg.content
              }]
            })),
            provider: {
              order: [openrouterProvider],
              allow_fallbacks: true
            },
            temperature: 1,
            top_p: 0.8,
            top_k: 20,
            min_p: 0,
            enable_thinking: includeReasoning,
            include_reasoning: true,
            presence_penalty: 1,
            reasoning: {
              effort: "low"
            },
            stream: stream,
            response_format: responseFormat
          })
        });
      } else if (apiType === 'koboldcpp') {
        const prompt = messages.map(message => `${message.role}: ${message.content}`).join('\n');
        const requestBody = {
          max_context_length: 4096,
          max_length: 768,
          prompt: prompt,
          quiet: false,
          rep_pen: 1.0,
          rep_pen_range: 256,
          rep_pen_slope: 1.0,
          temperature: 0.2,
          tfs: 1,
          top_a: 0,
          top_k: 80,
          top_p: 0.9,
          typical: 1,
          password:"nodegame",
          grammar,
          stream: stream
        };

        response = await fetch(`${import.meta.env.VITE_LLM_HOST}/api/v1/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `nodegame`
          },
          body: JSON.stringify(requestBody)
        });
      } else {
        throw new Error('Unknown API type');
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error Response:', errorText);
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      if (stream) {
        return response;
      }

      const data = await response.json();
      console.log('API Response:', data); // Debug log

      let llmResult;
      if (apiType === 'openai') {
        if (!data.choices?.[0]?.message?.content) {
          console.error('Invalid OpenAI response structure:', data);
          throw new Error('Invalid OpenAI response structure');
        }
        llmResult = data.choices[0].message.content;
      } else if (apiType === 'openrouter') {
        if (!data.choices?.[0]?.message?.content) {
          console.error('Invalid OpenRouter response structure:', data);
          throw new Error('Invalid OpenRouter response structure');
        }
        const content = data.choices[0].message.content;
        try {
          // If response_format is json_object, the content is already a JSON string
          if (responseFormat?.type === 'json_object') {
            // Remove any markdown code block formatting if present
            const cleanContent = content.replace(/```json\n|\n```/g, '').trim();
            return cleanContent;
          }
          const parsedContent = JSON.parse(content);
          if (!includeReasoning && parsedContent.reasoning !== undefined) {
            delete parsedContent.reasoning;
            llmResult = JSON.stringify(parsedContent);
          } else {
            llmResult = content;
          }
        } catch (e) {
          llmResult = content;
        }
      } else if (apiType === 'koboldcpp') {
        if (!data.results?.[0]?.text) {
          console.error('Invalid KoboldCPP response structure:', data);
          throw new Error('Invalid KoboldCPP response structure');
        }
        llmResult = data.results[0].text;
      }

      if (!llmResult) {
        console.error('No valid response from LLM API:', data);
        throw new Error('No valid response received from LLM API');
      }

      return llmResult;
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} failed:`, error);
      
      // Don't retry if it's not a network error
      if (error instanceof TypeError && error.message.includes('NetworkError')) {
        if (attempt < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      // For other errors or if we've exhausted retries, throw the error
      throw error;
    }
  }

  // If we've exhausted all retries, throw the last error
  throw lastError;
}
