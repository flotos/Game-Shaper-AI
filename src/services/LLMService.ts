import { Node } from '../models/Node';
import prompts from '../../prompts.json';
import { Message } from '../context/ChatContext';

export const generateImagePrompt = async(node: Partial<Node>, allNodes: Node[]) => {
  // Check for nodes with type "image_generation"
  const imageGenerationNodes = allNodes.filter(n => n.type === "image_generation");
  
  let contentPrompt = "";

  // If there are image generation nodes, use their content
  if (imageGenerationNodes.length > 0) {

    
    contentPrompt += `
      --> Your task
      The following instructions are to generate ONE image. It is very important to ensure only one image is generated.
      Your reply should be the prompt directly, with no comment, no reasoning.
      The "real" titles of these instructions are separated by the "-->" flag.


      --> Image generation instructions Guidelines

    `
    
    contentPrompt += imageGenerationNodes.map(n => {
      let prompt = "";
      if (n.shortDescription) prompt += n.shortDescription + "\n";
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
    shortDescription: ${node.shortDescription}
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
      shortDescription: ${nodet.shortDescription}
      rules: ${nodet.rules}
      `;
    }, "")}
    
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
    shortDescription: ${node.shortDescription}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}

    Here are the other nodes in the scene to give some context:
    ${allNodes.reduce((acc, nodet) => {
      return acc + `
      ---
      name: ${nodet.name}
      shortDescription: ${nodet.shortDescription}
      rules: ${nodet.rules}
      `;
    }, "")}

    // ${prompts.llm_prompt_guidelines}

    The caption should be a concise text at most 2 sentences describing what we can see on the image. Don't write anything else.
    It should describe what can be seen now.
    Use the object's long and short description mostly, and just a bit the information from "rules" that was given for some context.
    `;
  }

  const messages: Message[] = [
    { role: 'system', content: contentPrompt },
  ];

  return getResponse(messages);
}

export const getRelevantNodes = async(userInput: string, chatHistory: Message[], nodes: Node[]) => {
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
    shortDescription: ${node.shortDescription}
    rules: ${node.rules}
    type: ${node.type}
    child: ${node.child}
    parent: ${node.parent}
    
    `;
  }, "");

  const prompt = `
    Given the following nodes from a graph, find the ones that are relevant to the user's action.
    You should consider the nodes descriptions, and their relationships using ID in "child" and "parent" values.

    Reply with an array of ID, with no other content. Don't write text except the array of strings.
    Reply directly with the JSON array, no text or backquote. DO NOT USE \`\`\`json for example
    Each ID entry in the array should be enclosed in quotes.

    # Example 1:
    ## Nodes
    ---
    id: "98ak"
    name: A playing card
    shortDescription: A 10 of heart
    rules: The card has heavy wear and can be distinguished
    type: Card
    child: []
    parent: 10eg
    ---
    id: "10eg"
    name: A deck of cards
    shortDescription: a deck containing cards, it is near perfect
    rules: Only one card (the 10 of heart) is not mint.
    type: Object
    child: ["98ak"]
    parent: 121

    ## User message history with the narrator
    assistant: You are in a dark room and can only the one card
    user: take and observe the card

    ## Your answer
    ["98ak"]

    # Your turn:
    ## Nodes
    ${nodesDescription}

    ## User message history with the narrator
    ${stringHistory}

    ##Your answer
  `

  const grammar = `root ::= array

  array ::= "[" ws string (ws "," ws string)* ws "]"

  string ::= "\\"" [^"\\\\]+ "\\"" ws

  ws ::= [ \t\n]* # Optional whitespace
  `;


  const messages: Message[] = [
    { role: 'system', content: prompt },
  ];

  const response = await getResponse(messages, "gpt-3.5-turbo", grammar)
  return JSON.parse(response);
}



export const generateUserInputResponse = async(userInput: string, chatHistory: Message[], nodes: Node[], detailledNodeIds: String[]) => {
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
        shortDescription: ${node.shortDescription}
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
  
  const prompt = `
  # TASK:
  You are the Game Engine of a Node-base game, which display a chat and images for each node on the right panel.
  Update the game graph and generate appropriate dialogue and actions based on user interaction. Consider node relationships, hidden descriptions, and possible actions for a coherent game state update.
  You will make the world progress by itself at every round, in addition to any action the player make in the world. Each user action should have a significant impact.

  ## IMPORTANT: Your response must be a single, flat JSON object. Do not nest JSON within the content field.
  ## The response should be directly parseable as JSON without any additional processing.

  ## Node Properties:
  - id: Unique id string
  - name: title
  - longDescription: (Mandatory) Detailed description, write everything that is visible or that the player should know.
  - shortDescription: (Mandatory) Very short summary of the longDescription, in natural language
  - rules: (Mandatory) Internal info for AI that player shouldn't see. Store rich, reusable information in a structured format:
    * Use semicolons to separate different aspects
    * Include character traits, motivations, and relationships
    * Store environmental details and atmosphere
    * Note potential interactions and consequences
    * Keep track of past events and their impact
    * Store hidden mechanics and triggers
    * Include potential future developments
    * Note emotional states and psychological aspects
    * Store physical characteristics and capabilities
    * Include cultural and social context
  - type: Category/type (e.g., 'item', 'location', 'character', 'event', ...). The special type "Game Rule" should be used for rules that should be enforced by the Game Engine.
  - parent: ID of the parent node (has to match an existing or newly created node)
  - child: Array of child node IDs (has to match an existing or newly created node)
  - updateImage: If the element described by the node receives a visual/appearance change set to "true". Use this flag only if there are major changes as this trigger a 20-second generation process per image.
  
  ## Node Guidelines:
  - Purpose-Driven: Clear role within the game
  - Consistency: Fit logically within the game's universe
  - Interactivity: Enhance engagement through interactions and consequences
  - Scalability: Allow for future modifications
  - Innovativeness: Creative design to enrich player experience
  - Image update: Don't update the image when a character changes expression or pose, but only if their body or clothes change for example. Unless a node states otherwise
  - Never update images for game design or system nodes (like Game Rules, Game Systems, etc.) - these should maintain their original images
  - Rich Information Storage: Store detailed, reusable information in the rules field that can be referenced later
  - Dynamic Evolution: Allow nodes to evolve based on player interactions and story progression
  - Hidden Depth: Include subtle details and hidden mechanics that can be discovered
  - Emotional Resonance: Track emotional states and psychological aspects of characters
  - Environmental Context: Store rich environmental details and atmosphere
  
  ## Example Node with Rich Information:
  {
    "id": "56",
    "name": "Healing Potion",
    "shortDescription": "A small vial containing a red liquid that restores health.",
    "longDescription": "The vial has a strong smell, and its red liquid is similar to blood. Few people would drink this if it wasn't a medicine.",
    "rules": "Restores 50 points of health instantly when consumed;Made from rare mountain herbs;Has a metallic aftertaste;Can be used to poison if mixed with certain ingredients;Lasts for 3 days before losing potency;Created by the ancient alchemist guild;Has a faint glow in darkness;Can be used to detect magical traps;Stains skin red temporarily;Has a calming effect on magical creatures;Can be used as a bargaining chip with certain factions;Has a 10% chance to cause temporary hallucinations;Can be used to create magical ink;Has a unique resonance with certain magical artifacts",
    "type": "Item",
    "parent": "12",
    "updateImage": true,
    "child": []
  }

  
  ## Game Content:
  ### Current Nodes:
  ${nodesDescription}
  
  ### Chat History:
  ${stringHistory}
  
  ### User Input:
  ${userInput}
  
  Using the information provided, update the graph as needed and generate a JSON response with:
  {
    "reasoning": "Write here short sentences to decide what happens in reaction to the player's action. Another sentence to explain how you will update the node graph, always prefer to update before creating new nodes. Ensure to assign correctly the changes to the correct nodes. Analyse which node should update their image, because their description change has is visible",
    "chatText": "Narrator dialogue/description reflecting the current game state and actions taken in natural language that will display in the chat. Should be a detailed chapter (8 to 12 paragraphs) with rich descriptions of the environment, character emotions, and unfolding events. Include sensory details, character thoughts, and atmospheric elements. Don't ask questions to the player. Avoid repeating what was said before.",
    "actions": "(Array of strings) two interesting actions the player can then take",
    "nodeEdition": {
      "merge": "(Array of nodes object) List of nodes to be updated or created. If a new id is specified it will create new nodes. If a node has a new behaviour, update it by specifying its id",
      "delete": "(Array of node id) List nodes to be removed and justify their removal. Nodes that became irrelevant for a while should be deleted."
    }
  }

  Try to not to exceed 10 nodes in the graph, either by merging existing ones that share same concepts instead of creating new nodes, or deleting irelevant ones.

  Keep the logic properly scoped in each node. Prefer to store information in the node that is impacted by the change rather by the one triggering it.
  
  When creating new nodes, be creative and surprise the user with its content. You have to create an interesting game for the player.

  You VERY MUCH have to enforce the world rules and not comply with the user action if it doesn't fit with the Game Rule. Guide the user to interact
  with the game by following the Game Rule nodes directives.
  
  When updating nodes, enrich their rules field with additional information that could be relevant later. This includes:
  - Character development and relationships
  - Environmental changes and atmosphere
  - Hidden mechanics and triggers
  - Emotional states and psychological aspects
  - Cultural and social context
  - Potential future developments
  - Past events and their impact
  - Physical characteristics and capabilities
  
  Reply directly with the JSON. Ensure proper JSON syntax. Always reply with content in your json. Don't use any backquote. DONT USE \`\`\`json for example
  `;
  
  const messages: Message[] = [
    { role: 'system', content: prompt },
  ];

  const grammar = `root ::= (
    "{"
      "\\"reasoning\\":" ws "\\"" reasoning "\\"" ws "," ws 
      "\\"chatText\\":" ws "\\"" chatText "\\"" ws "," ws 
      "\\"actions\\":" ws actions ws "," ws 
      "\\"nodeEdition\\":" ws nodeEdition ws
    "}"
  )
    
  reasoning ::= ([^"\\\\.]+ "."? [^"\\\\.]*)* # Any character except double quote, backslash, and three consecutive dots

  nodeEdition ::= (
    "{"
      ws "\\"merge\\":" ws merge ws "," ws 
      "\\"delete\\":" ws delete ws "," ws
      "\\"appendEnd\\":" ws appendEnd ws
    "}" ws
  )
  
  merge ::= (
    "["
      ws (node (ws "," ws node)*)? ws 
    "]" ws
  )
  
  appendEnd ::= (
    "["
      ws (node (ws "," ws node)*)? ws 
    "]" ws
  )
  
  node ::= (
    "{"
      ws "\\"id\\":" ws textInQuotes ws "," ws
      "\\"name\\":" ws textInQuotes ws "," ws 
      "\\"rules\\":" ws textInQuotes ws "," ws
      "\\"longDescription\\":" ws textInQuotes ws "," ws
      "\\"shortDescription\\":" ws textInQuotes ws "," ws
      ( "\\"child\\":" ws textInQuotes ws "," ws )?
      ( "\\"parent\\":" ws textInQuotes ws "," ws )?
      ( "\\"updateImage\\":" ws textInQuotes ws "," ws )?
       "\\"type\\":" ws textInQuotes ws
    "}" ws
  )
  
  delete ::= (
    "["
      ws (nodeId (ws "," ws nodeId)*)? ws 
    "]" ws
  )
  
  chatText ::= [^"\\\\]+ # Any character except double quote and backslash
  
  actions ::= (
    "["
      ws textInQuotes (ws "," ws textInQuotes)* ws 
    "]" ws
  )
  
  textInQuotes ::= "\\"" [^"\\\\]+ "\\"" ws
  ws ::= [ \t\n]* # Optional whitespace
  `;

  const response = await getResponse(messages, 'gpt-4o', grammar)
  return JSON.parse(response);
}

export const generateNodesFromPrompt = async (prompt: string, nodes: Node[]) => {
  
  const nodesDescription = nodes.reduce((acc, node) => {
    return acc + `
    id: ${node.id}
    name: ${node.name}
    shortDescription: ${node.shortDescription}
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
  5. For the "appendEnd" operation, you can specify nodes where the content will be appended to the end of existing fields. This is useful for adding new information without replacing the entire content.

  Each node should be described in a JSON format with the following properties:
  {
    "id": "unique-id",
    "name": "node name",
    "shortDescription": "short description",
    "longDescription": "long description",
    "rules": "rules, written in a concise, compressed way.",
    "type": "node type",
    "parent": "parent id",
    "child": ["child ids"]
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

  const grammar = `root ::= (
    "{"
      ws "\\"merge\\":" ws nodes ws "," ws
      "\\"delete\\":" ws delete ws
    "}" ws
  )
  
  node ::= (
    "{"
      ws "\\"id\\":" ws textInQuotes ws "," ws
      "\\"name\\":" ws textInQuotes ws "," ws 
      "\\"rules\\":" ws textInQuotes ws "," ws
      "\\"longDescription\\":" ws textInQuotes ws "," ws
      "\\"shortDescription\\":" ws textInQuotes ws "," ws
      "\\"child\\":" ws textInQuotes ws "," ws
      "\\"parent\\":" ws textInQuotes ws "," ws
       "\\"type\\":" ws textInQuotes ws
    "}" ws
  )

  nodes ::= (
    "["
      ws node (ws "," ws node)* ws 
    "]" ws
  )

  delete ::= (
    "["
      ws (textInQuotes (ws "," ws textInQuotes)*)? ws 
    "]" ws
  )
    
  textInQuotes ::= "\\"" [^"\\\\]+ "\\"" ws
  ws ::= [ \t\n]* # Optional whitespace
  `;

  const response = await getResponse(messages, 'gpt-4o', grammar);
  return JSON.parse(response);
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

const getResponse = async (messages: Message[], model = 'gpt-4o', grammar: String | undefined = undefined) => {
  const apiType = import.meta.env.VITE_LLM_API;
  const includeReasoning = import.meta.env.VITE_LLM_INCLUDE_REASONING !== 'false';

  // Ensure there's at least one user message for OpenRouter
  if (apiType === 'openrouter') {
    const hasUserMessage = messages.some(msg => msg.role === 'user');
    if (!hasUserMessage) {
      messages.push({ role: 'user', content: 'Please process the system instructions.' });
    }
  }

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
        messages: messages
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
        provider: openrouterProvider,
        messages: messages,
        temperature: import.meta.env.VITE_OPENROUTER_TEMPERATURE ? parseFloat(import.meta.env.VITE_OPENROUTER_TEMPERATURE) : 0.7,
        max_tokens: import.meta.env.VITE_OPENROUTER_MAX_TOKENS ? parseInt(import.meta.env.VITE_OPENROUTER_MAX_TOKENS) : 4096,
        reasoning: {
          effort: "low",
          exclude: false
        }
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
      grammar
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
    throw new Error(`Error: ${response.statusText}`);
  }

  const data = await response.json();

  let llmResult;
  if (apiType === 'openai') {
    llmResult = data.choices[0].message.content.replace("```json\n", "").replace("```\n", "").replace("\n```", "").replace("```", "");
  } else if (apiType === 'openrouter') {
    const content = data.choices[0].message.content;
    // Check if the content is already a JSON string
    try {
      const parsedContent = JSON.parse(content);
      // If reasoning is disabled and the content has a reasoning field, remove it
      if (!includeReasoning && parsedContent.reasoning !== undefined) {
        delete parsedContent.reasoning;
        llmResult = JSON.stringify(parsedContent);
      } else {
        llmResult = content;
      }
    } catch (e) {
      // If not valid JSON, clean it like OpenAI response
      llmResult = content.replace("```json\n", "").replace("```\n", "").replace("\n```", "").replace("```", "");
    }
  } else if (apiType === 'koboldcpp') {
    llmResult = data.results[0].text.replace("```\n", "").replace("\n```", "").replace("```", "");
  }

  return llmResult;
}
