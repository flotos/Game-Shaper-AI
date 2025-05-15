import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import {
  getResponse, 
  formatPrompt, 
  loadedPrompts, 
  getLastFiveInteractions 
} from './llmCore';
import { moxusService } from '../services/MoxusService';

// Helper function to manage try/catch for JSON parsing and logging
async function processJsonResponse<T>(
  serviceName: string, 
  operationName: string, 
  responsePayload: { llmResult: string, callId: string },
  parseFn: (jsonString: string) => T
): Promise<T> {
  try {
    const parsedResult = parseFn(responsePayload.llmResult);
    // Successfully parsed, finalize the LLM call as completed
    moxusService.finalizeLLMCallRecord(responsePayload.callId, "JSON content successfully parsed"); // Don't log actual content
    console.log(`[${serviceName}] ${operationName} successful for callId: ${responsePayload.callId}`);
    return parsedResult;
  } catch (error) {
    const parseErrorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${serviceName}] ${operationName} failed JSON parsing for callId: ${responsePayload.callId}. Error: ${parseErrorMessage}. Raw response: ${responsePayload.llmResult}`);
    // Mark the LLM call as failed due to parsing error
    moxusService.failLLMCallRecord(responsePayload.callId, `JSON parsing error: ${parseErrorMessage}`);
    throw new Error(`Failed to parse JSON response for ${operationName}: ${parseErrorMessage}`);
  }
}

export const getRelevantNodes = async(userInput: string, chatHistory: Message[], nodes: Node[]): Promise<string[]> => {
  console.log('LLM Call (NodeInteractionService): Getting relevant nodes');
  const stringHistory = chatHistory.reduce((acc, message) => {
    if(message.role === "user" || message.role === "assistant" || message.role === "userMandatoryInstructions") {
      return acc + `${message.role}: ${message.content}\n`;
    }
    return acc;
  }, "");

  const nodesDescription = nodes.reduce((acc, node) => {
    return acc + `\n    ---\n    id: ${node.id}\n    name: ${node.name}\n    rules: ${node.rules}\n    type: ${node.type}\n    `;
  }, "");

  const prompt = formatPrompt(loadedPrompts.node_operations.get_relevant_nodes, {
    nodes_description: nodesDescription,
    string_history: stringHistory
  });

  const messages: Message[] = [{ role: 'system', content: prompt }];
  let responsePayload: { llmResult: string, callId: string };
  try {
    responsePayload = await getResponse(messages, "gpt-3.5-turbo", undefined, false, { type: 'json_object' }, undefined, 'node_relevance_check');
  } catch (error) {
    // getResponse already calls failLLMCallRecord if the fetch itself fails or returns an API error.
    // So, if an error is caught here, it implies the call was already marked as failed by getResponse.
    console.error('[NodeInteractionService] getRelevantNodes: getResponse failed.', error);
    throw error; // Re-throw the original error which should have failure details
  }
  return processJsonResponse('NodeInteractionService', 'getRelevantNodes', responsePayload, (jsonString) => JSON.parse(jsonString).relevantNodes);
};

export const generateChatText = async(userInput: string, chatHistory: Message[], nodes: Node[], _detailledNodeIds: String[]): Promise<{ streamResponse: Response, callId: string }> => {
  console.log('LLM Call (NodeInteractionService): Generating chat text');
  
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReportMessage = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");
  
  const maxIncludedNodes = parseInt(import.meta.env.VITE_MAX_INCLUDED_NODES || '15', 10);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation") return acc;
    // Simplified logic, assuming full details for now if under max, otherwise also full (TODO was mentioned in original)
    return acc + `\n        id: ${node.id}\n        name: ${node.name}\n        longDescription: ${node.longDescription}\n        rules: ${node.rules}\n        type: ${node.type}\n        `;
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

  const chatTextMessages: Message[] = [{ role: 'system', content: chatTextPrompt }];
  const result = await getResponse(chatTextMessages, 'gpt-4o', undefined, true, undefined, undefined, 'chat_text_generation');
  return result as { streamResponse: Response, callId: string };
};

export const generateActions = async(chatText: string | Message[], nodes: Node[], userInput: string): Promise<string[]> => {
  console.log('LLM Call (NodeInteractionService): Generating actions');
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation") return acc;
    return acc + `\n      id: ${node.id}\n      name: ${node.name}\n      longDescription: ${node.longDescription}\n      rules: ${node.rules}\n      type: ${node.type}\n      `;
  }, "");

  let formattedChatText = "";
  let lastMoxusReportContent: Message | undefined = undefined;
  
  if (Array.isArray(chatText)) {
    lastMoxusReportContent = [...chatText].reverse().find(message => message.role === "moxus");
    const lastFive = getLastFiveInteractions(chatText as Message[]); // Type assertion
    formattedChatText = lastFive.reduce((acc: string, message: Message) => acc + `${message.role}: ${message.content}\n`, "");
  } else {
    formattedChatText = chatText;
  }

  const lastMoxusReportSection = lastMoxusReportContent ? `
  ## Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  ${lastMoxusReportContent.content.replace('**Moxus Report:**', '').trim()}
  ` : '';

  const actionsPrompt = formatPrompt(loadedPrompts.node_operations.generate_actions, {
    nodes_description: nodesDescription,
    formatted_chat_text: formattedChatText,
    last_moxus_report_section: lastMoxusReportSection,
    user_input: userInput
  });

  const actionsMessages: Message[] = [{ role: 'system', content: actionsPrompt }];
  let responsePayload: { llmResult: string, callId: string };
  try {
    responsePayload = await getResponse(actionsMessages, 'gpt-4o', undefined, false, { type: 'json_object' }, undefined, 'action_generation');
  } catch (error) {
    console.error('[NodeInteractionService] generateActions: getResponse failed.', error);
    throw error;
  }
  return processJsonResponse('NodeInteractionService', 'generateActions', responsePayload, (jsonString) => JSON.parse(jsonString).actions);
};

export const generateNodeEdition = async(chatText: string | Message[], actions: string[], nodes: Node[], userInput: string, isUserInteraction: boolean = false): Promise<any> => {
  console.log('LLM Call (NodeInteractionService): Generating node edition');
  
  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.type === "system" && b.type !== "system") return -1;
    if (a.type !== "system" && b.type === "system") return 1;
    return 0;
  });

  const nodesDescription = sortedNodes.reduce((acc, node) => {
    if (node.type === "image_generation" || node.type === "system") return acc;
    return acc + `\n      id: ${node.id}\n      name: ${node.name}\n      longDescription: ${node.longDescription}\n      rules: ${node.rules}\n      type: ${node.type}\n      `;
  }, "");

  let formattedChatHistory = "";
  let lastMoxusReportContent: Message | undefined = undefined;
  
  if (Array.isArray(chatText)) {
    lastMoxusReportContent = [...chatText].reverse().find(message => message.role === "moxus");
    const lastFive = getLastFiveInteractions(chatText as Message[]); // Type assertion
    formattedChatHistory = lastFive.reduce((acc: string, message: Message) => acc + `${message.role}: ${message.content}\n`, "");
  } else {
    formattedChatHistory = chatText;
  }

  const lastMoxusReportSection = lastMoxusReportContent ? `
  ## Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  ${lastMoxusReportContent.content.replace('**Moxus Report:**', '').trim()}
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

  const messages: Message[] = [{ role: 'system', content: nodeEditionPrompt }];
  let responsePayload: { llmResult: string, callId: string };
  try {
    responsePayload = await getResponse(messages, "gpt-4o", undefined, false, { type: 'json_object' }, undefined, 'node_edition_generation');
  } catch (error) {
    console.error('[NodeInteractionService] generateNodeEdition: getResponse failed.', error);
    throw error;
  }
  return processJsonResponse('NodeInteractionService', 'generateNodeEdition', responsePayload, JSON.parse);
};

export const generateNodesFromPrompt = async (userPrompt: string, nodes: Node[], moxusMemoryInput?: { general?: string; chatText?: string; nodeEdition?: string; }, moxusPersonality?: string): Promise<any> => {
  console.log('LLM Call (NodeInteractionService): Generating nodes from prompt');
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "system") return acc;
    return acc + `\n    id: ${node.id}\n    name: ${node.name}\n    longDescription: ${node.longDescription}\n    rules: ${node.rules}\n    type: ${node.type}\n    `;
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

  const promptMessageContent = formatPrompt(loadedPrompts.node_operations.generate_nodes_from_prompt, {
    user_prompt: userPrompt,
    moxus_context_string: moxusContextString,
    nodes_description: nodesDescription
  });

  const messages: Message[] = [{ role: 'system', content: promptMessageContent }];
  let responsePayload: { llmResult: string, callId: string };
  try {
    responsePayload = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' }, undefined, 'node_creation_from_prompt');
  } catch (error) {
    console.error('[NodeInteractionService] generateNodesFromPrompt: getResponse failed.', error);
    throw error;
  }
  return processJsonResponse('NodeInteractionService', 'generateNodesFromPrompt', responsePayload, JSON.parse);
};

export const sortNodesByRelevance = async (nodes: Node[], chatHistory: Message[]): Promise<string[]> => {
  console.log('LLM Call (NodeInteractionService): Sorting nodes by relevance');
  
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReportMessage = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");

  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation") return acc;
    return acc + `\n      id: ${node.id}\n      name: ${node.name}\n      longDescription: ${node.longDescription}\n      rules: ${node.rules}\n      type: ${node.type}\n      `;
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

  const messages: Message[] = [{ role: 'system', content: prompt }];
  let responsePayload: { llmResult: string, callId: string };
  try {
    responsePayload = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' }, undefined, 'node_sort_by_relevance');
  } catch (error) {
    console.error('[NodeInteractionService] sortNodesByRelevance: getResponse failed.', error);
    throw error;
  }
  return processJsonResponse('NodeInteractionService', 'sortNodesByRelevance', responsePayload, (jsonString) => JSON.parse(jsonString).sortedIds);
};

export const generateUserInputResponse = async(userInput: string, chatHistory: Message[], nodes: Node[], detailledNodeIds: String[]) => {
  console.log('LLM Call (NodeInteractionService): Generating full user input response');
  
  const chatTextResult = await generateChatText(userInput, chatHistory, nodes, detailledNodeIds);
  const chatTextStreamResponse = chatTextResult.streamResponse;
  const chatTextCallId = chatTextResult.callId;

  let accumulatedChatText = "";
  if (chatTextStreamResponse && chatTextStreamResponse.body) {
    const reader = chatTextStreamResponse.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulatedChatText += decoder.decode(value, { stream: true });
    }
  } else {
    accumulatedChatText = chatTextStreamResponse as any; 
  }
  
  const [actions, nodeEdition] = await Promise.all([
    generateActions(accumulatedChatText, nodes, userInput),
    generateNodeEdition(accumulatedChatText, [], nodes, userInput, true) 
  ]);
  
  return {
    chatText: accumulatedChatText,
    actions,
    nodeEdition,
    chatTextCallId
  };
} 