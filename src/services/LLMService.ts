import { Node } from '../models/Node';
import * as yaml from 'js-yaml';
import rawPrompts from '../prompts.yaml?raw'; // Import YAML as raw text
import { Message } from '../context/ChatContext';
import { moxusService, setMoxusFeedbackImpl } from './MoxusService';

// Load and parse prompts
interface PromptsConfig {
  common: {
    moxus_feedback_system_message: string;
    moxus_get_feedback_user_message: string;
  };
  twine_import: {
    data_extraction: string;
    node_generation_new_game: string;
    node_generation_merge: string;
    regenerate_single_node: string;
  };
  image_generation: {
    base_prompt_with_instructions_node: string;
    base_prompt_default: string;
    type_specific_additions: { [key: string]: string };
  };
  node_operations: {
    get_relevant_nodes: string;
    generate_chat_text: string;
    generate_actions: string;
    generate_node_edition: string;
    generate_nodes_from_prompt: string;
    sort_nodes_by_relevance: string;
  };
}

const loadedPrompts = yaml.load(rawPrompts) as PromptsConfig;

// Utility function to format prompts
function formatPrompt(promptTemplate: string, replacements: Record<string, string | undefined>): string {
  let formattedPrompt = promptTemplate;
  for (const key in replacements) {
    const value = replacements[key];
    // Ensure value is a string, treat undefined as empty string for replacement
    const replacementValue = value === undefined ? '' : String(value);
    formattedPrompt = formattedPrompt.replace(new RegExp(`\\{[${key}]\\}`, 'g'), replacementValue);
  }
  return formattedPrompt;
}

interface ExtractedElement {
  type: string;
  name: string;
  content: string;
}

interface ExtractedData {
  chunks: ExtractedElement[][];
}

function getTypeSpecificPromptAddition(nodeType: string | undefined): string {
  const typeKey = nodeType || 'default';
  return loadedPrompts.image_generation.type_specific_additions[typeKey] || loadedPrompts.image_generation.type_specific_additions['default'] || '';
}

export const generateImagePrompt = async(node: Partial<Node>, allNodes: Node[], chatHistory: Message[] = []) => {
  console.log('LLM Call: Generating image prompt for node:', node.id);
  const imageGenerationNodes = allNodes.filter(n => n.type === "image_generation");
  
  let contentPrompt = "";
  const typeSpecificAddition = getTypeSpecificPromptAddition(node.type);
  const allNodesContext = allNodes.reduce((acc, nodet) => {
    return acc + `
    ---
    name: ${nodet.name}
    rules: ${nodet.rules}
    `;
  }, "");
  const chatHistoryContext = chatHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n');

  if (imageGenerationNodes.length > 0) {
    const imageGenerationNodesContent = imageGenerationNodes.map(n => {
      let prompt = "";
      if (n.longDescription) prompt += n.longDescription + "\n";
      if (n.rules) prompt += n.rules + "\n";
      return prompt;
    }).join("\n");

    contentPrompt = formatPrompt(loadedPrompts.image_generation.base_prompt_with_instructions_node, {
      image_generation_nodes_content: imageGenerationNodesContent,
      node_name: node.name,
      node_long_description: node.longDescription,
      node_rules: node.rules,
      node_type: node.type,
      type_specific_prompt_addition: typeSpecificAddition,
      all_nodes_context: allNodesContext,
      chat_history_context: chatHistoryContext
    });
  } else {
    contentPrompt = formatPrompt(loadedPrompts.image_generation.base_prompt_default, {
      node_name: node.name,
      node_long_description: node.longDescription,
      node_rules: node.rules,
      node_type: node.type,
      type_specific_prompt_addition: typeSpecificAddition, // Ensure this is included here too
      all_nodes_context: allNodesContext,
      chat_history_context: chatHistoryContext
    });
  }

  const messages: Message[] = [
    { role: 'system', content: contentPrompt },
  ];

  return getResponse(messages, 'gpt-4o', undefined, false, undefined, { skipMoxusFeedback: true });
}

export const getRelevantNodes = async(userInput: string, chatHistory: Message[], nodes: Node[]) => {
  console.log('LLM Call: Getting relevant nodes');
  const stringHistory = chatHistory.reduce((acc, message) => {
    if(message.role == "user" || message.role == "assistant" || message.role == "userMandatoryInstructions") {
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

  const prompt = formatPrompt(loadedPrompts.node_operations.get_relevant_nodes, {
    nodes_description: nodesDescription,
    string_history: stringHistory
  });

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
  
  // Filter to only include user, assistant, and userMandatoryInstructions messages
  return lastFiveInteractions.filter(message => 
    message.role === "user" || 
    message.role === "assistant" || 
    message.role === "userMandatoryInstructions"
  );
};

export const getChatHistoryForMoxus = (chatHistory: Message[], numAssistantTurns: number): Message[] => {
  let assistantCount = 0;
  let startIndex = 0; // Default to start of history if not enough assistant turns

  // Iterate through chat history in reverse to find the Nth assistant message
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.role === "assistant") {
      assistantCount++;
      if (assistantCount === numAssistantTurns) {
        startIndex = i; // Found the Nth assistant message, slice from here
        break;
      }
    }
  }
  
  // If we didn't find N assistant messages, startIndex remains 0, so it takes all history.
  const historySlice = chatHistory.slice(startIndex);
  
  // Filter to only include user, assistant, userMandatoryInstructions, and moxus messages
  return historySlice.filter(message => 
    message.role === "user" || 
    message.role === "assistant" || 
    message.role === "userMandatoryInstructions" ||
    message.role === "moxus"
  );
};

export const generateChatText = async(userInput: string, chatHistory: Message[], nodes: Node[], detailledNodeIds: String[]) => {
  console.log('LLM Call: Generating chat text');
  
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReportMessage = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");
  
  const maxIncludedNodes = parseInt(import.meta.env.VITE_MAX_INCLUDED_NODES || '15', 10);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation") return acc;
    if (nodes.length < maxIncludedNodes) {
      return acc + `
        id: ${node.id}
        name: ${node.name}
        longDescription: ${node.longDescription}
        rules: ${node.rules}
        type: ${node.type}
        `;
    } else {
      return acc + `
        id: ${node.id}
        name: ${node.name}
        longDescription: ${node.longDescription}
        rules: ${node.rules}
        type: ${node.type}
        `;
    }
  }, "");

  const lastMoxusReportSection = lastMoxusReportMessage ? `
  ### Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  ${lastMoxusReportMessage.content.replace('**Moxus Report:**', '').trim()}
  ` : '';

  const chatTextPrompt = formatPrompt(loadedPrompts.node_operations.generate_chat_text, {
    nodes_description: nodesDescription,
    string_history: stringHistory,
    last_moxus_report_section: lastMoxusReportSection,
    user_input: userInput
  });

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
    if (node.type === "image_generation") return acc;
    return acc + `
      id: ${node.id}
      name: ${node.name}
      longDescription: ${node.longDescription}
      rules: ${node.rules}
      type: ${node.type}
      `;
  }, "");

  let formattedChatText = "";
  let lastMoxusReportContent = null;
  
  if (Array.isArray(chatText) && chatText.length > 0 && typeof chatText[0] === 'object' && 'role' in chatText[0]) {
    const chatHistoryMessages = chatText as Message[];
    lastMoxusReportContent = [...chatHistoryMessages].reverse().find(message => message.role === "moxus");
    const lastFiveInteractions = getLastFiveInteractions(chatHistoryMessages);
    formattedChatText = lastFiveInteractions.reduce((acc: string, message: Message) => {
      return acc + `${message.role}: ${message.content}\n`;
    }, "");
  } else {
    formattedChatText = chatText as string;
    // Cannot get Moxus report if chatText is just a string, assume it's not present or handled upstream
  }

  const lastMoxusReportSection = lastMoxusReportContent ? `
  ## Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  ${(lastMoxusReportContent as Message).content.replace('**Moxus Report:**', '').trim()}
  ` : '';

  const actionsPrompt = formatPrompt(loadedPrompts.node_operations.generate_actions, {
    nodes_description: nodesDescription,
    formatted_chat_text: formattedChatText,
    last_moxus_report_section: lastMoxusReportSection,
    user_input: userInput
  });

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
    if (node.type === "image_generation" || node.type === "system") return acc;
    return acc + `
      id: ${node.id}
      name: ${node.name}
      longDescription: ${node.longDescription}
      rules: ${node.rules}
      type: ${node.type}
      `;
  }, "");

  let formattedChatHistory = "";
  let lastMoxusReportContent = null;
  
  if (Array.isArray(chatText) && chatText.length > 0 && typeof chatText[0] === 'object' && 'role' in chatText[0]) {
    const chatHistoryMessages = chatText as Message[];
    lastMoxusReportContent = [...chatHistoryMessages].reverse().find(message => message.role === "moxus");
    const lastFiveInteractions = getLastFiveInteractions(chatHistoryMessages);
    formattedChatHistory = lastFiveInteractions.reduce((acc: string, message: Message) => {
      return acc + `${message.role}: ${message.content}\n`;
    }, "");
  } else {
    formattedChatHistory = chatText as string;
  }

  const lastMoxusReportSection = lastMoxusReportContent ? `
  ## Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  ${(lastMoxusReportContent as Message).content.replace('**Moxus Report:**', '').trim()}
  ` : '';
  
  const thinkMode = isUserInteraction ? '/no_think' : '/think';

  const nodeEditionPrompt = formatPrompt(loadedPrompts.node_operations.generate_node_edition, {
    think_mode: thinkMode,
    nodes_description: nodesDescription,
    formatted_chat_history: formattedChatHistory,
    last_moxus_report_section: lastMoxusReportSection,
    actions_list: actions.join('\n'),
    user_input: userInput
  });

  const messages: Message[] = [
    { role: 'system', content: nodeEditionPrompt },
  ];

  const response = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' });
  return JSON.parse(response);
};

export const generateNodesFromPrompt = async (prompt: string, nodes: Node[], moxusMemoryInput?: { general?: string; chatText?: string; nodeEdition?: string; }, moxusPersonality?: string) => {
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "system") return acc;
    return acc + `
    id: ${node.id}
    name: ${node.name}
    longDescription: ${node.longDescription}
    rules: ${node.rules}
    type: ${node.type}
    `;
  }, "");

  let moxusContextString = "";
  if (moxusPersonality || moxusMemoryInput) {
    moxusContextString = "\n\n# MOXUS CONTEXT";
    if (moxusPersonality) moxusContextString += `\n\n## Moxus Personality:\n${moxusPersonality}`;
    if (moxusMemoryInput) {
      if (moxusMemoryInput.general) moxusContextString += `\n\n## Moxus General Memory:\n${moxusMemoryInput.general}`;
      if (moxusMemoryInput.chatText) moxusContextString += `\n\n## Moxus Chat Text Analysis:\n${moxusMemoryInput.chatText}`;
      if (moxusMemoryInput.nodeEdition) moxusContextString += `\n\n## Moxus Node Editions Analysis:\n${moxusMemoryInput.nodeEdition}`;
    }
  }

  const promptMessage = formatPrompt(loadedPrompts.node_operations.generate_nodes_from_prompt, {
    user_prompt: prompt,
    moxus_context_string: moxusContextString,
    nodes_description: nodesDescription
  });

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
  
  const totalLength = content.length;
  const chunkSize = Math.ceil(totalLength / extractionCount);
  const chunks: string[] = [];
  
  for (let i = 0; i < extractionCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalLength);
    chunks.push(content.slice(start, end));
  }

  const processChunk = async (chunk: string, index: number, retryCount: number = 0): Promise<ExtractedElement[]> => {
    const extractionPrompt = formatPrompt(loadedPrompts.twine_import.data_extraction, {
      additional_instructions: dataExtractionInstructions || '',
      twine_content: chunk
    });

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

  const promptTemplateKey = mode === 'new_game' ? 
    loadedPrompts.twine_import.node_generation_new_game : 
    loadedPrompts.twine_import.node_generation_merge;

  const generationPrompt = formatPrompt(promptTemplateKey, {
    additional_instructions: nodeGenerationInstructions || '',
    extracted_data: JSON.stringify(extractedData, null, 2),
    nodes_description: nodesDescription
  });

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

  const recentlyGeneratedNodeDetails = recentlyGeneratedNode ? 
    `id: ${recentlyGeneratedNode.id}\nname: ${recentlyGeneratedNode.name}\nlongDescription: ${recentlyGeneratedNode.longDescription}\nrules: ${recentlyGeneratedNode.rules}\ntype: ${recentlyGeneratedNode.type}`
    : 'No recently generated node provided';

  const focusedPrompt = formatPrompt(loadedPrompts.twine_import.regenerate_single_node, {
    node_generation_instructions: nodeGenerationInstructions || '',
    existing_node_id: existingNode.id || '',
    existing_node_name: existingNode.name || '',
    existing_node_long_description: existingNode.longDescription || '',
    existing_node_rules: existingNode.rules || '',
    existing_node_type: existingNode.type || '',
    recently_generated_node_details: recentlyGeneratedNodeDetails,
    extracted_data: JSON.stringify(extractedData, null, 2),
    nodes_description: nodesDescription,
    node_id_to_regenerate: nodeId
  });

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

  const callId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  if (!options?.skipMoxusFeedback && !stream) {
    const moxusFeedbackContent = formatPrompt(loadedPrompts.common.moxus_feedback_system_message, {
      moxus_llm_calls_memory_yaml: moxusService.getLLMCallsMemoryYAML()
    });
    const feedbackMessage: Message = {
      role: 'system',
      content: moxusFeedbackContent
    };
    
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
  
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReportMessage = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");

  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation") return acc;
    return acc + `
      id: ${node.id}
      name: ${node.name}
      longDescription: ${node.longDescription}
      rules: ${node.rules}
      type: ${node.type}
      `;
  }, "");

  const lastMoxusReportSection = lastMoxusReportMessage ? `
  ## Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  ${lastMoxusReportMessage.content.replace('**Moxus Report:**', '').trim()}
  ` : '';

  const prompt = formatPrompt(loadedPrompts.node_operations.sort_nodes_by_relevance, {
    string_history: stringHistory,
    last_moxus_report_section: lastMoxusReportSection,
    nodes_description: nodesDescription
  });

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
  
  const estimatedTokens = Math.ceil(promptContent.length / 4);
  console.log(`[LLMService] Estimated tokens for Moxus request: ~${estimatedTokens}`);
  
  const MAX_SAFE_TOKENS = 100000; 
  let processedPrompt = promptContent;
  
  if (estimatedTokens > MAX_SAFE_TOKENS) {
    console.warn(`[LLMService] Moxus prompt exceeds safe token limit (~${estimatedTokens} tokens). Truncating...`);
    const sections = promptContent.split(/^#\s+/m);
    let truncatedPrompt = sections[0];
    let currentLength = truncatedPrompt.length;
    let i = 1;
    while (i < sections.length && (currentLength + sections[i].length) / 4 < MAX_SAFE_TOKENS) {
      truncatedPrompt += `# ${sections[i]}`;
      currentLength += sections[i].length + 2;
      i++;
    }
    if (truncatedPrompt.length / 4 > MAX_SAFE_TOKENS || truncatedPrompt === sections[0]) {
      truncatedPrompt = promptContent.substring(0, MAX_SAFE_TOKENS * 4);
      truncatedPrompt += "\n\n[CONTENT TRUNCATED DUE TO LENGTH CONSTRAINTS]\n\n";
    }
    processedPrompt = truncatedPrompt;
    console.log(`[LLMService] Truncated Moxus prompt to ~${Math.ceil(processedPrompt.length / 4)} tokens`);
  }
  
  const messages: Message[] = [
    { role: 'system', content: processedPrompt }, // This is the main content from the caller
    { role: 'user', content: loadedPrompts.common.moxus_get_feedback_user_message } // Use the prompt from YAML
  ];

  try {
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
