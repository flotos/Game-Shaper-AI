import { Node } from '../models/Node';
import prompts from '../../prompts.json';
import { Message } from '../context/ChatContext';
import { moxusService, setMoxusFeedbackImpl } from './MoxusService';

interface ExtractedElement {
  type: string;
  name: string;
  content: string;
}

interface ExtractedData {
  chunks: ExtractedElement[][];
}

// Twine import prompts
export const TWINE_DATA_EXTRACTION_PROMPT = `
/think

# Instructions
You are a Game Engine. Your task is to analyze and extract structured data from a Twine story.
  
# Rules
1. Extract key story elements, characters, locations, and events
2. Preserve important narrative structures and branching paths
3. Remove any technical or formatting elements not relevant to the story
4. Structure the data in a way that can be used to generate game nodes

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
      "content": "detailed description or content"
    }
  ]
}`;

export const TWINE_NODE_GENERATION_PROMPT_NEW_GAME = `
/think

# Instructions
You are a Game Engine. Your task is to create a completely new game based on the extracted story data.

# Rules
1. Create a new game world based on the extracted story elements
2. Use the existing node structure only as a template for formatting
3. Generate a complete new set of nodes that form a coherent game world
4. Set updateImage to true for nodes that represent physical entities
5. When using the extracted story data:
  - All the listed events are possible outcomes in the game. These are NOT memories or past events.
  - All the locations are possible encounters, but consider these have not yet been visited by the player.

# User's specific instructions (very important to follow)
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
  "new": [
    {
      "id": "unique-id",
      "name": "node name",
      "longDescription": "detailed description",
      "rules": "rules and internal info",
      "type": "node type",
      "updateImage": true/false
    }
  ],
  "delete": ["nodeID1ToDelete", "nodeID2ToDelete", ...]
}`;

export const TWINE_NODE_GENERATION_PROMPT_MERGE = `
/think

# Instructions
You are a Game Engine. Your task is to merge the extracted story data into the existing game world.

# Rules
1. Your PRIMARY task is to UPDATE EXISTING NODES rather than create new ones
2. For each element in the extracted data:
   - First identify which existing node it relates to
   - Update that node to incorporate the new content
   - Only create a new node if there is NO existing node that could reasonably incorporate the concept
3. When updating nodes:
   - Preserve all existing content
   - Add new content that expands and enhances the existing concepts
   - Ensure new content integrates seamlessly with existing content
   - Set updateImage to true if the visual appearance has changed significantly
4. For new story elements that truly cannot fit in existing nodes:
   - Create new nodes with unique IDs
   - Ensure they connect properly with existing nodes
   - Set updateImage to true for physical entities
5. Maintain consistency between old and new elements
6. When using the extracted story data:
   - All the listed events are possible outcomes in the game. These are NOT memories or past events.
   - All the locations are possible encounters, but consider these have not yet been visited by the player.
7. In the newly generated nodes or updated ones, NEVER mention "added", "updated" "expanded", "new" or any similar synonyms. You should return the new node as it should be, with no mention of changes as your output will directly replace the previous content.

# User's specific instructions (very important to follow)
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
  "new": [
    {
      "id": "unique-id",
      "name": "node name",
      "longDescription": "detailed description",
      "rules": "rules and internal info",
      "type": "node type",
      "updateImage": true/false
    }
  ],
  "update": [
    {
      "id": "existing-node-id",
      "longDescription": "updated description that merges existing and new content",
      "rules": "updated rules",
      "updateImage": true/false
    }
  ],
  "delete": ["nodeID1ToDelete", "nodeID2ToDelete", ...]
}
  
During your reasoning process, verify after every node created that you preserved ALL the original feature and did not discard any content.`;

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

  // Skip Moxus feedback for image prompt generation
  return getResponse(messages, 'gpt-4o', undefined, false, undefined, { skipMoxusFeedback: true });
}

export const getRelevantNodes = async(userInput: string, chatHistory: Message[], nodes: Node[]) => {
  console.log('LLM Call: Getting relevant nodes');
  const stringHistory = chatHistory.reduce((acc, message) => {
    if(message.role == "user" || message.role == "assistant" || message.role == "userNote") {
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
    `;
  }, "");

  const prompt = `
    Given the following nodes from a graph, find the ones that are relevant to the user's action.
    You should consider the nodes descriptions and their content.

    Return a JSON object with a single field "relevantNodes" containing an array of node IDs.
    Each ID entry in the array should be enclosed in quotes.

    # Example 1:
    ## Nodes
    ---
    id: "98ak"
    name: A playing card
    rules: The card has heavy wear and can be distinguished
    type: Card
    ---
    id: "10eg"
    name: A deck of cards
    rules: Only one card (the 10 of heart) is not mint.
    type: Object

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

// Helper function to get the last 5 interactions from chat history
const getLastFiveInteractions = (chatHistory: Message[]): Message[] => {
  // Find the 5th most recent assistant message
  let assistantCount = 0;
  let lastFiveInteractions: Message[] = [];
  
  // Iterate through chat history in reverse to find the 5th assistant message
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.role === "assistant") {
      assistantCount++;
      if (assistantCount === 5) {
        // Found the 5th assistant message, include all messages from this point
        lastFiveInteractions = chatHistory.slice(i);
        break;
      }
    }
  }
  
  // If we didn't find 5 assistant messages, use all available history
  if (assistantCount < 5) {
    lastFiveInteractions = chatHistory;
  }
  
  // Filter to only include user, assistant, and userNote messages
  return lastFiveInteractions.filter(message => 
    message.role === "user" || 
    message.role === "assistant" || 
    message.role === "userNote"
  );
};

export const generateChatText = async(userInput: string, chatHistory: Message[], nodes: Node[], detailledNodeIds: String[]) => {
  console.log('LLM Call: Generating chat text');
  
  // Get last 5 interactions and find the last Moxus report
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReport = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  // Format chat history without Moxus reports
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");
  
  const maxIncludedNodes = parseInt(import.meta.env.VITE_MAX_INCLUDED_NODES || '15', 10);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    // Skip image_generation nodes
    if (node.type === "image_generation") {
      return acc;
    }

    // If there are less than maxIncludedNodes nodes, include full content
    if (nodes.length < maxIncludedNodes) {
      return acc + `
        id: ${node.id}
        name: ${node.name}
        longDescription: ${node.longDescription}
        rules: ${node.rules}
        type: ${node.type}
        `;
    } else {
      // Original behavior for maxIncludedNodes or more nodes
      return acc + `
        id: ${node.id}
        name: ${node.name}
        longDescription: ${node.longDescription}
        rules: ${node.rules}${node.id in detailledNodeIds || node.type == "Game Rule" ? `\n${node.longDescription}\n` : ""}
        type: ${node.type}
        `;
    }
  }, "");

  const chatTextPrompt = `
  /think
  # TASK:
  You are the Game Engine of a Node-base game, which display a chat and images for each node on the right panel.
  Generate appropriate dialogue based on user interaction. Consider node relationships, hidden descriptions, and possible actions for a coherent game state update.
  You will make the world progress by itself at every round, in addition to any action the player make in the world. Each user action should have a significant impact.

  Do not mention any node updates/change/deletion, as another LLM call will handle this.

  ## Game Content:
  ### Current Nodes, sorted by relevance:
  ${nodesDescription}
  
  ### Recent Chat History (Last 5 Interactions):
  ${stringHistory}
  
  ${lastMoxusReport ? `
  ### Latest Moxus Analysis:
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides guidance to maintain consistency and quality in the game world.
  
  ${lastMoxusReport.content.replace('**Moxus Report:**', '').trim()}
  ` : ''}
  
  ### User Input:
  ${userInput}
  
  Generate a detailed chapter (3 to 4 paragraphs) making the story progress, with efficient but short descriptions.
  Don't ask questions to the player.
  Produce new content, make the plot progress, and avoid repeating what was said before.
  `;

  const chatTextMessages: Message[] = [
    { role: 'system', content: chatTextPrompt },
  ];

  // Create a special ID for chat text generation
  const chatTextCallId = `chatText-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  // Get the response with streaming
  const chatTextResponse = await getResponse(chatTextMessages, 'gpt-4o', undefined, true);
  
  // For streaming responses, we'll manually record the call after the stream completes
  // This happens in the ChatInterface component by tracking the accumulated content
  
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
      `;
  }, "");

  // Format the chat narrative (could be string or Message[] array)
  let formattedChatText = chatText;
  let lastMoxusReport = null;
  
  if (Array.isArray(chatText) && chatText.length > 0 && 
      typeof chatText[0] === 'object' && 'role' in chatText[0]) {
    // Find the last Moxus report
    lastMoxusReport = [...chatText].reverse().find(message => message.role === "moxus");
    
    // Get last 5 interactions and format them
    const lastFiveInteractions = getLastFiveInteractions(chatText as Message[]);
    formattedChatText = lastFiveInteractions.reduce((acc: string, message: Message) => {
      return acc + `${message.role}: ${message.content}\n`;
    }, "");
  }

  const actionsPrompt = `
  # TASK:
  Based on the following game state and narrative, generate two interesting actions the player can take next.
  The actions should be natural continuations of the story and make sense in the current context.

  ## Current Game State:
  ${nodesDescription}

  ## Recent Narrative (Last 5 Interactions):
  ${formattedChatText}
  
  ${lastMoxusReport ? `
  ## Latest Moxus Analysis:
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides guidance to maintain consistency and quality in the game world.
  
  ${lastMoxusReport.content.replace('**Moxus Report:**', '').trim()}
  ` : ''}

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
  
  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.type === "system" && b.type !== "system") return -1;
    if (a.type !== "system" && b.type === "system") return 1;
    return 0;
  });

  const nodesDescription = sortedNodes.reduce((acc, node) => {
    if (node.type === "image_generation" || node.type === "system") {
      return acc;
    }
    return acc + `
      id: ${node.id}
      name: ${node.name}
      longDescription: ${node.longDescription}
      rules: ${node.rules}
      type: ${node.type}
      `;
  }, "");

  // Check if chatText is a chat history array or a string
  let formattedChatHistory = "";
  let lastMoxusReport = null;
  
  if (Array.isArray(chatText) && chatText.length > 0 && 
      typeof chatText[0] === 'object' && 'role' in chatText[0]) {
    // Find the last Moxus report
    lastMoxusReport = [...chatText].reverse().find(message => message.role === "moxus");
    
    // Get last 5 interactions and format them
    const lastFiveInteractions = getLastFiveInteractions(chatText as Message[]);
    formattedChatHistory = lastFiveInteractions.reduce((acc: string, message: Message) => {
      return acc + `${message.role}: ${message.content}\n`;
    }, "");
  } else {
    // If it's already a string, use it directly
    formattedChatHistory = chatText as string;
  }

  const nodeEditionPrompt = `
  ${isUserInteraction ? '/no_think' : '/think'}
  # TASK:
  Based on the following game state, narrative, and possible actions, update the game graph.
  Consider node content and possible actions for a coherent game state update.

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
  - updateImage: (Optional) Set to true if the node represents a physical object, character, or location that should have a visual representation. This is particularly important for:
    * New nodes that represent physical entities (characters, items, locations)
    * Existing nodes whose visual appearance has changed significantly
    * Nodes that need their first image generated
    * Nodes that need an image update due to significant changes in their description or rules
    DO NOT set updateImage to true for abstract concepts, game rules, or system nodes that don't need visual representation.

  ## Current Game State, sorted by relevance:
  ${nodesDescription}

  ## Recent Chat History (Last 5 Interactions):
  ${formattedChatHistory}
  
  ${lastMoxusReport ? `
  ## Latest Moxus Analysis:
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides guidance to maintain consistency and quality in the game world.
  
  ${lastMoxusReport.content.replace('**Moxus Report:**', '').trim()}
  ` : ''}

  ## Possible Actions:
  ${actions.join('\n')}

  ## User Input:
  ${userInput}

  Return a JSON object with the following structure:
  {
    "merge": [
      {
        "id": "node-id (specify a new one if you want to create a new node)",
        "name": "updated name",
        "longDescription": "updated description",
        "rules": "updated rules",
        "type": "updated type",
        "updateImage": true/false
      }
    ],
    "delete": ["nodeID1ToDelete", "nodeID2ToDelete", ...]
  }

  Update up to 3 nodes maximum, and you can create up to one new node.
  `;

  const messages: Message[] = [
    { role: 'system', content: nodeEditionPrompt },
  ];

  const response = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' });
  return JSON.parse(response);
};

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
    if (node.type === "system") {
      return acc;
    }
    return acc + `
    id: ${node.id}
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}
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

  const response = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' });
  return JSON.parse(response);
};

export const extractDataFromTwine = async (
  content: string,
  dataExtractionInstructions?: string,
  extractionCount: number = 1,
  onProgress?: (completed: number) => void
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

  const processChunk = async (chunk: string, index: number, retryCount: number = 0): Promise<ExtractedElement[]> => {
    const extractionPrompt = TWINE_DATA_EXTRACTION_PROMPT
      .replace('[Additional Instructions will be inserted here]', dataExtractionInstructions || '')
      .replace('[Content will be inserted here]', chunk);

    const extractionMessages: Message[] = [
      { role: 'system', content: extractionPrompt },
    ];

    try {
      const result = await getResponse(extractionMessages, 'gpt-4o', undefined, false, { type: 'json_object' });
      const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
      
      if (!parsedResult.elements || !Array.isArray(parsedResult.elements)) {
        throw new Error('Invalid response structure: missing or invalid elements array');
      }

      if (onProgress) {
        onProgress(index + 1);
      }

      return parsedResult.elements;
    } catch (error) {
      console.error(`Error processing chunk ${index + 1}:`, error);
      
      // Retry once if we haven't already
      if (retryCount === 0) {
        console.log(`Retrying chunk ${index + 1}...`);
        return processChunk(chunk, index, retryCount + 1);
      }
      
      // If retry failed or we've already retried, return empty array and log the error
      console.error(`Failed to process chunk ${index + 1} after retry:`, error);
      return [];
    }
  };

  // Process all chunks in parallel
  const extractionResults = await Promise.all(
    chunks.map((chunk, index) => processChunk(chunk, index))
  );

  // Count failed chunks
  const failedChunks = extractionResults.filter(result => result.length === 0).length;
  
  // Combine all extracted data while maintaining chunk structure
  const combinedExtractedData = {
    chunks: extractionResults,
    failedChunks: failedChunks
  };

  // If any chunks failed, log a warning
  if (failedChunks > 0) {
    console.warn(`${failedChunks} out of ${extractionCount} chunks failed to process. The extraction will continue with the successful chunks.`);
  }

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
    if (node.type === "system") {
      return acc;
    }
    return acc + `
    id: ${node.id}
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}
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
    if (!parsedResponse.new || !Array.isArray(parsedResponse.new)) {
      throw new Error('Invalid response structure: missing or invalid new array');
    }
    
    // Handle different modes
    if (mode === 'new_game') {
      // For new game, all existing nodes will be deleted
      parsedResponse.delete = nodes.map(node => node.id);
    } else if (mode === 'merge_story') {
      // For merge mode, ensure both new and update arrays exist
      if (!parsedResponse.update || !Array.isArray(parsedResponse.update)) {
        throw new Error('Invalid response structure: missing or invalid update array in merge mode');
      }
      
      // Ensure delete array exists
      if (!parsedResponse.delete) {
        parsedResponse.delete = [];
      }
      
      // Handle updates - if an update node doesn't exist, move it to new
      if (parsedResponse.update) {
        const existingNodeIds = new Set(nodes.map(node => node.id));
        const validUpdates = [];
        const newNodes = [...parsedResponse.new];
        
        for (const update of parsedResponse.update) {
          if (existingNodeIds.has(update.id)) {
            validUpdates.push(update);
          } else {
            // If the node doesn't exist, move it to new nodes
            const existingNode = nodes.find(n => n.id === update.id);
            if (existingNode) {
              newNodes.push({
                ...existingNode,
                ...update
              });
            }
          }
        }
        
        parsedResponse.update = validUpdates;
        parsedResponse.new = newNodes;
      }
    }
    
    // Ensure each node in new has all required fields
    parsedResponse.new.forEach((node: any) => {
      // Set default values before validation
      node.updateImage = node.updateImage ?? false;
      if (!node.rules) {
        node.rules = '';
      }
      
      const missingFields = [];
      if (!node.id) missingFields.push('id');
      if (!node.name) missingFields.push('name');
      if (!node.longDescription) missingFields.push('longDescription');
      if (!node.type) missingFields.push('type');
      
      if (missingFields.length > 0) {
        console.error('Problematic node data:', JSON.stringify(node, null, 2));
        throw new Error(`Invalid node structure: missing required fields in node ${node.id || 'unknown'}: ${missingFields.join(', ')}`);
      }
    });
    
    // Ensure each node in update has required fields
    if (parsedResponse.update) {
      parsedResponse.update.forEach((node: any) => {
        // Set default values before validation
        node.updateImage = node.updateImage ?? false;
        
        if (!node.id) {
          throw new Error('Invalid update node: missing id field');
        }
        if (!node.longDescription && !node.rules && node.updateImage === undefined) {
          throw new Error(`Invalid update node ${node.id}: must have at least one of longDescription, rules, or updateImage`);
        }
      });
    }
    
    return parsedResponse;
  } catch (error) {
    console.error('Error parsing Twine import response:', error);
    console.error('Response content:', response);
    throw new Error('Failed to parse Twine import response as JSON. Please ensure the response is properly formatted.');
  }
};

export const regenerateSingleNode = async (
  nodeId: string,
  existingNode: Partial<Node>,
  extractedData: ExtractedData,
  nodes: Node[],
  mode: 'new_game' | 'merge_story',
  nodeGenerationInstructions?: string,
  recentlyGeneratedNode?: Partial<Node>
) => {
  console.log('LLM Call: Regenerating single node:', nodeId);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "system") {
      return acc;
    }
    return acc + `
    -
    id: ${node.id}
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}
    `;
  }, "");

  const focusedPrompt = `
/think

# Instructions
You are a Game Engine. An AI generated nodes for a game. However, the user deemed the node didn't follow the guidelines he expected.
Your task is to generate a new node, following more closely the guildelines provided by the user.
In the newly generated nodes or updated ones, NEVER mention "added", "updated" "expanded", "new" or any similar synonyms. You should return the new node as it should be, with no mention of changes as your output will directly replace the previous content.


# User's specific instructions (very important to follow)
${nodeGenerationInstructions || ''}

# Original Node (from the game)
---
id: ${existingNode.id}
name: ${existingNode.name}
longDescription: ${existingNode.longDescription}
rules: ${existingNode.rules}
type: ${existingNode.type}
---

# Recently Generated Node (that needs improvement)
---
${recentlyGeneratedNode ? `
id: ${recentlyGeneratedNode.id}
name: ${recentlyGeneratedNode.name}
longDescription: ${recentlyGeneratedNode.longDescription}
rules: ${recentlyGeneratedNode.rules}
type: ${recentlyGeneratedNode.type}
` : 'No recently generated node provided'}
---

# Extracted Story Data
---
${JSON.stringify(extractedData, null, 2)}
---

# Existing Nodes (for context)
---
${nodesDescription}
---

# Return format

Return a JSON object with the following structure:
{
  "new": [
    {
      "id": "${nodeId}",
      "name": "node name",
      "longDescription": "detailed description",
      "rules": "rules and internal info",
      "type": "node type",
      "updateImage": true/false
    }
  ],
  "update": [
    {
      "id": "${nodeId}",
      "longDescription": "updated description",
      "rules": "updated rules",
      "updateImage": true/false
    }
  ]
}`;

  const messages: Message[] = [
    { role: 'system', content: focusedPrompt },
  ];

  const response = await getResponse(messages, 'gpt-4o', undefined, false, { type: 'json_object' });
  
  try {
    const parsedResponse = typeof response === 'string' ? JSON.parse(response) : response;
    
    // Validate the response structure
    if (!parsedResponse.new || !Array.isArray(parsedResponse.new) || !parsedResponse.update || !Array.isArray(parsedResponse.update)) {
      throw new Error('Invalid response structure: missing or invalid arrays');
    }
    
    // Find the updated node in either new or update arrays
    const updatedNode = parsedResponse.new.find((n: Partial<Node>) => n.id === nodeId) || 
                       parsedResponse.update.find((n: { id: string; longDescription?: string; rules?: string; updateImage?: boolean }) => n.id === nodeId);
    
    if (!updatedNode) {
      throw new Error('Node not found in response');
    }
    
    // Ensure the node has all required fields
    updatedNode.updateImage = updatedNode.updateImage ?? false;
    if (!updatedNode.rules) {
      updatedNode.rules = '';
    }
    
    return updatedNode;
  } catch (error) {
    console.error('Error parsing node regeneration response:', error);
    console.error('Response content:', response);
    throw new Error('Failed to parse node regeneration response as JSON');
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

const getResponse = async (messages: Message[], model = 'gpt-4o', grammar: String | undefined = undefined, stream = false, responseFormat?: { type: string }, options?: { skipMoxusFeedback?: boolean }) => {
  const apiType = import.meta.env.VITE_LLM_API;
  const includeReasoning = import.meta.env.VITE_LLM_INCLUDE_REASONING !== 'false';
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second

  // Generate a unique ID for this LLM call
  const callId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  // Add Moxus feedback if available and not skipped
  if (!options?.skipMoxusFeedback && !stream) {
    const feedbackMessage: Message = {
      role: 'system',
      content: `
        # Moxus AI Assistant Feedback
        Moxus is an AI assistant that helps identify problems with previous responses.
        The following is brief critical feedback on previous similar requests, with special attention to user notes and feedback:

        ---start of feedback---
        ${moxusService.getLLMCallsMemoryYAML()}
        ---end of feedback---

        Use this critical feedback to avoid making the same mistakes in your response.
        Pay special attention to any user notes in the feedback, as they often contain important suggestions and corrections.
        `
    };
    
    // Insert Moxus feedback as the second message (after the first system message if it exists)
    if (messages.length > 0 && messages[0].role === 'system') {
      messages.splice(1, 0, feedbackMessage);
    } else {
      messages.unshift(feedbackMessage);
    }
  }

  // Ensure there's at least one user message for OpenRouter
  if (apiType === 'openrouter') {
    const hasUserMessage = messages.some(msg => msg.role === 'user');
    if (!hasUserMessage) {
      messages.push({ role: 'user', content: 'Please process the system instructions.' });
    }
  }

  const originalPrompt = JSON.stringify(messages);

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
        // console.log('Using OpenRouter model:', openrouterModel, 'from provider:', openrouterProvider);

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
            temperature: 0.1,
            top_p: 0.8,
            top_k: 20,
            min_p: 0,
            enable_thinking: includeReasoning,
            include_reasoning: true,
            presence_penalty: 0,
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

      // Record this call for Moxus if not streaming and not skipping feedback
      if (!stream && !options?.skipMoxusFeedback) {
        moxusService.recordLLMCall(callId, originalPrompt, llmResult);
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

export const sortNodesByRelevance = async (nodes: Node[], chatHistory: Message[]) => {
  console.log('LLM Call: Sorting nodes by relevance');
  
  // Get last 5 interactions and find the last Moxus report
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReport = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  // Format chat history without Moxus reports
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");

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
      `;
  }, "");

  const prompt = `
  # TASK:
  You are a Game Engine. Your task is to sort the nodes by their relevance to the current chat history.
  Consider both the content of the nodes and the context of the conversation.

  ## Recent Chat History (Last 5 Interactions):
  ${stringHistory}
  
  ${lastMoxusReport ? `
  ## Latest Moxus Analysis:
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides guidance to maintain consistency and quality in the game world.
  
  ${lastMoxusReport.content.replace('**Moxus Report:**', '').trim()}
  ` : ''}

  ## Nodes to Sort:
  ${nodesDescription}

  Return a JSON object with a single field "sortedIds" containing an array of node IDs in order of relevance (most relevant first).
  Each ID entry in the array should be enclosed in quotes.

  Example response:
  {
    "sortedIds": ["node1", "node2", "node3"]
  }

  Your focus is to order the nodes to sort them, from the most related to the chatHistory, to the least. This will be used to have the Story Generation AI focus on the first.
  For example, the main character and active characters should be first, then the location, then ongoing game systems, ...
  `;

  const messages: Message[] = [
    { role: 'system', content: prompt },
  ];

  const response = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' });
  const parsed = JSON.parse(response);
  return parsed.sortedIds;
};

// Modified function for Moxus calls to avoid feedback loop
export const getMoxusFeedback = async (promptContent: string): Promise<string> => {
  console.log('[LLMService] Moxus request received.');
  
  // Basic token estimation - roughly 4 characters per token for English text
  const estimatedTokens = Math.ceil(promptContent.length / 4);
  console.log(`[LLMService] Estimated tokens for Moxus request: ~${estimatedTokens}`);
  
  // Safety check - if estimated tokens are too high, truncate the prompt
  const MAX_SAFE_TOKENS = 100000; // Set a safe limit below Claude's 163,840 limit
  let processedPrompt = promptContent;
  
  if (estimatedTokens > MAX_SAFE_TOKENS) {
    console.warn(`[LLMService] Moxus prompt exceeds safe token limit (~${estimatedTokens} tokens). Truncating...`);
    
    // Find a clean breaking point by looking for section headers
    const sections = promptContent.split(/^#\s+/m);
    let truncatedPrompt = sections[0]; // Always keep the first section
    
    // Add sections until we approach the limit
    let currentLength = truncatedPrompt.length;
    let i = 1;
    
    while (i < sections.length && (currentLength + sections[i].length) / 4 < MAX_SAFE_TOKENS) {
      truncatedPrompt += `# ${sections[i]}`; // Re-add the header marker
      currentLength += sections[i].length + 2; // +2 for "# "
      i++;
    }
    
    // If we couldn't find enough section breaks, do a hard truncation as last resort
    if (truncatedPrompt.length / 4 > MAX_SAFE_TOKENS || truncatedPrompt === sections[0]) {
      truncatedPrompt = promptContent.substring(0, MAX_SAFE_TOKENS * 4);
      truncatedPrompt += "\n\n[CONTENT TRUNCATED DUE TO LENGTH CONSTRAINTS]\n\n";
    }
    
    processedPrompt = truncatedPrompt;
    console.log(`[LLMService] Truncated Moxus prompt to ~${Math.ceil(processedPrompt.length / 4)} tokens`);
  }
  
  const messages: Message[] = [
    { role: 'system', content: processedPrompt },
    // Add a user message to ensure a response even with truncated context
    { role: 'user', content: 'Please provide your feedback based on the available information, with special attention to any user notes in the chat history. User notes often contain important feedback and suggestions that should be prioritized in your analysis.' }
  ];

  try {
    // Using the existing getResponse function but skipping Moxus feedback to avoid loops
    const response = await getResponse(messages, 'gpt-4o', undefined, false, undefined, { skipMoxusFeedback: true });
    console.log('[LLMService] Moxus feedback generated.');
    return response;
  } catch (error) {
    console.error('[LLMService] Error getting Moxus feedback:', error);
    throw new Error('Failed to get Moxus feedback from LLM.');
  }
};

// Set the implementation in MoxusService to avoid circular dependencies
setMoxusFeedbackImpl(getMoxusFeedback);
