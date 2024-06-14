import { Node } from '../models/Node';
import prompts from '../../prompts.json';
import { Message } from '../context/ChatContext';

export const generateImagePrompt = async(node: Partial<Node>, allNodes: Node[]) => {

  const nodesDescription = allNodes.reduce((acc, nodet) => {
    return acc + `
    ---
    name: ${nodet.name}
    shortDescription: ${nodet.shortDescription}
    rules: ${nodet.rules}
    `;
  }, "");

  const prompt = `
    You will generate the caption of image for a game object.
    The image is for the following object :
    --
    name: ${node.name}
    shortDescription: ${node.shortDescription}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}

    Here are the other nodes in the scene to give some context:
    ${nodesDescription}



    ${prompts.llm_prompt_guidelines}

    The caption should be a concise text at most 2 sentences describing what we can see on the image. Don't write anything else.
    It should describe what can be seen now.
    Use the object's long and short description mostly, and just a bit the information from "rules" that was given for some context.
  `

  const messages: Message[] = [
    { role: 'system', content: prompt },
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
    return acc + `
    id: ${node.id}
    name: ${node.name}
    shortDescription: ${node.shortDescription}
    rules: ${node.rules}${node.id in detailledNodeIds || node.type == "Game Rule" ? `\n${node.longDescription}\n` : ""}
    type: ${node.type}
    child: ${node.child}
    parent: ${node.parent}
    `;
  }, "");
  
  const prompt = `
  ### USER:
  You are the Game Engine of a Node-base game, which display a chat and images for each node on the right panel.
  Update the game graph and generate appropriate dialogue and actions based on user interaction. Consider node relationships, hidden descriptions, and possible actions for a coherent game state update.
  You will make the world progress by itself at every round, in addition to any action the player make in the world. Each user action should have a significant impact.

  ## Node Properties:
  - id: Unique id string
  - name: title
  - longDescription: (Mandatory) Detailed description, write everything that is visible or that the player should know.
  - shortDescription: (Mandatory) Very short summary of the longDescription, in natural language
  - rules: (Mandatory) Internal info for AI that player shouldn't see. Describe interesting behavior of this node so you will know later on how to use it. This should be written as compressed text that you can understand later on, to use less tokens. You can use semicolon separated words/entities.
  - type: Category/type (e.g., 'item', 'location', 'character', 'event', ...). The special type "Game Rule" should be used for rules that should be enforced by the Game Engine.
  - parent: ID of the parent node (has to match an existing or newly created node)
  - child: Array of child node IDs (has to match an existing or newly created node)
  - updateImage: If the element described by the node receives a visual/appearance change set to "true"
  
  ## Node Guidelines:
  - Purpose-Driven: Clear role within the game
  - Consistency: Fit logically within the game's universe
  - Interactivity: Enhance engagement through interactions and consequences
  - Scalability: Allow for future modifications
  - Innovativeness: Creative design to enrich player experience
  
  ## Example Node:
  {
    "id": "56",
    "name": "Healing Potion",
    "shortDescription": "A small vial containing a red liquid that restores health.",
    "longDescription": "The vial has a strong smell, and its red liquid is similar to blood. Few people would drink this if it wasn't a medicine.",
    "rules": "Restores 50 points of health instantly when consumed.",
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
    "chatText": "Narrator dialogue/description reflecting the current game state and actions taken in natural language that will display in the chat. One or two paragraphs. Don't ask question to the player. Avoir repeating what was said before.",
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
      "\\"delete\\":" ws delete ws 
    "}" ws
  )
  
  merge ::= (
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

const getResponse = async (messages: Message[], model = 'gpt-4o', grammar: String | undefined = undefined) => {
  const apiType = import.meta.env.VITE_LLM_API;

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
  } else if (apiType === 'koboldcpp') {
    llmResult = data.results[0].text.replace("```\n", "").replace("\n```", "").replace("```", "");
  }

  return llmResult;
}
