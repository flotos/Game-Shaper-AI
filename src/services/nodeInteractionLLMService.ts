import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import {
  getResponse, 
  formatPrompt, 
  loadedPrompts, 
  getLastFiveInteractions 
} from './llmCore';
import { moxusService } from '../services/MoxusService';
import { LLMNodeEditionResponse } from '../models/nodeOperations';
import { safeJsonParse, parseNodeOperationJson } from '../utils/jsonUtils';

// Helper function to manage try/catch for JSON parsing and logging
async function processJsonResponse<T>(
  serviceName: string, 
  operationName: string, 
  responsePayload: { llmResult: string, callId: string },
  parseFn: (dataString: string) => T,
  isNodeEdition: boolean = false
): Promise<T> {
  try {
    const parsedResult = parseFn(responsePayload.llmResult);
    moxusService.finalizeLLMCallRecord(responsePayload.callId, "LLM output successfully parsed"); 
    console.log(`[${serviceName}] ${operationName} successful for callId: ${responsePayload.callId}`);
    return parsedResult;
  } catch (error) {
    const parseErrorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${serviceName}] ${operationName} failed parsing LLM output for callId: ${responsePayload.callId}. Error: ${parseErrorMessage}. Raw response: ${responsePayload.llmResult}`);
    moxusService.failLLMCallRecord(responsePayload.callId, `LLM output parsing error: ${parseErrorMessage}. Raw LLM Output: ${responsePayload.llmResult}`);
    
    let userFriendlyMessage = `Failed to parse LLM output for ${operationName}: ${parseErrorMessage}`;
    if (isNodeEdition) {
        userFriendlyMessage += ". The LLM may have returned an invalid JSON structure or incorrect field names for node updates. Please check the console for the raw LLM output and consider simplifying your request or asking the AI to be more careful with the JSON format.";
    }
    throw new Error(userFriendlyMessage);
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
    if (node.type === "image_generation" || node.type === "assistant") return acc;
    return acc + `\n    ---\n    id: ${node.id}\n    name: ${node.name}\n    type: ${node.type}\n    `;
  }, "");

  const prompt = formatPrompt(loadedPrompts.node_operations.get_relevant_nodes, {
    nodes_description: nodesDescription,
    string_history: stringHistory
  });

  const messages: Message[] = [{ role: 'system', content: prompt }];
  let responsePayload: { llmResult: string, callId: string };
  try {
    responsePayload = await getResponse(messages, "gpt-3.5-turbo", undefined, false, { type: 'json_object' }, undefined, 'node_relevance_check') as { llmResult: string, callId: string };
  } catch (error) {
    console.error('[NodeInteractionService] getRelevantNodes: getResponse failed.', error);
    throw error; 
  }
  return processJsonResponse('NodeInteractionService', 'getRelevantNodes', responsePayload, (jsonString) => safeJsonParse(jsonString).relevantNodes);
};

export const generateChatText = async(userInput: string, chatHistory: Message[], nodes: Node[], _detailledNodeIds: String[], responseLength: 'short' | '1 paragraph' | '3 paragraphs' | 'lengthy' | 'full page' = '3 paragraphs'): Promise<{ streamResponse: Response, callId: string }> => {
  console.log('LLM Call (NodeInteractionService): Generating chat text');
  
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReportMessage = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");
  
  const maxIncludedNodes = parseInt(import.meta.env.VITE_MAX_INCLUDED_NODES || '15', 10);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation" || node.type === "assistant") return acc;
    return acc + `\n        id: ${node.id}\n        name: ${node.name}\n        longDescription: ${node.longDescription}\n        type: ${node.type}\n        `;
  }, "");

  const lastMoxusReportSection = lastMoxusReportMessage ? `
  ### Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  ${lastMoxusReportMessage.content.replace('**Moxus Report:**', '').trim()}
  ` : '';

  // Get Moxus guidance for narrative generation
  const moxusGuidance = await moxusService.getChatTextGuidance(`User input: ${userInput}`);
  const moxusGuidanceSection = moxusGuidance ? `
  ### Moxus Creative Guidance (APPLY THESE INSIGHTS):
  The following guidance comes from Moxus's evolved understanding of effective storytelling:
  
  ${moxusGuidance}
  ` : '';

  // Get response length instruction from prompts
  const responseLengthInstruction = loadedPrompts.utils?.responseLength?.[responseLength] || loadedPrompts.utils?.responseLength?.['3 paragraphs'] || 'Generate a chapter (3 paragraphs) making the story progress over one action.';

  const chatTextPrompt = formatPrompt(loadedPrompts.node_operations.generate_chat_text, {
    nodes_description: nodesDescription,
    string_history: stringHistory,
    last_moxus_report_section: lastMoxusReportSection + moxusGuidanceSection,
    user_input: userInput,
    response_length_instruction: responseLengthInstruction
  });

  const chatTextMessages: Message[] = [{ role: 'system', content: chatTextPrompt }];
  const result = await getResponse(chatTextMessages, undefined, undefined, true, undefined, undefined, 'chat_text_generation');
  return result as { streamResponse: Response, callId: string };
};

export const generateActions = async(chatText: string | Message[], nodes: Node[], userInput: string): Promise<string[]> => {
  console.log('LLM Call (NodeInteractionService): Generating actions');
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation" || node.type === "assistant") return acc;
    return acc + `\n      id: ${node.id}\n      name: ${node.name}\n      longDescription: ${node.longDescription}\n      type: ${node.type}\n      `;
  }, "");

  let formattedChatText = "";
  let lastMoxusReportContent: Message | undefined = undefined;
  
  if (Array.isArray(chatText)) {
    lastMoxusReportContent = [...chatText].reverse().find(message => message.role === "moxus");
    const lastFive = getLastFiveInteractions(chatText as Message[]); 
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
    responsePayload = await getResponse(actionsMessages, undefined, undefined, false, { type: 'json_object' }, undefined, 'action_generation') as { llmResult: string, callId: string };
  } catch (error) {
    console.error('[NodeInteractionService] generateActions: getResponse failed.', error);
    throw error;
  }
  return processJsonResponse('NodeInteractionService', 'generateActions', responsePayload, (jsonString) => safeJsonParse(jsonString).actions);
};

export const generateNodeEdition = async(chatText: string | Message[], actions: string[], nodes: Node[], userInput: string, isUserInteraction: boolean = false): Promise<LLMNodeEditionResponse> => {
  console.log('LLM Call (NodeInteractionService): Generating node edition (JSON structure)');
  
  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.type === "system" && b.type !== "system") return -1;
    if (a.type !== "system" && b.type === "system") return 1;
    return 0;
  });

  const nodesDescription = sortedNodes.reduce((acc, node) => {
    if (node.type === "image_generation" || node.type === "system" || node.type === "Game Rule" || node.type === "Game Rules" || node.type === "assistant") return acc; 
    return acc + `\n      id: ${node.id}\n      name: ${node.name}\n      longDescription: ${node.longDescription}\n      type: ${node.type}\n      `;
  }, "");

  let formattedChatHistory = "";
  let lastMoxusReportContent: Message | undefined = undefined;
  
  if (Array.isArray(chatText)) {
    lastMoxusReportContent = [...chatText].reverse().find(message => message.role === "moxus");
    const lastFive = getLastFiveInteractions(chatText as Message[]); 
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
  
  // Get Moxus guidance for world-building
  const moxusGuidance = await moxusService.getNodeEditionGuidance(`User input: ${userInput}`);
  const moxusGuidanceSection = moxusGuidance ? `
  ## Moxus World-Building Guidance (APPLY THESE INSIGHTS):
  The following guidance comes from Moxus's evolved understanding of effective world-building:
  
  ${moxusGuidance}
  ` : '';
  
  // const thinkMode = isUserInteraction ? '/no_think' : '/think';
  const thinkMode = '';

  const nodeEditionPrompt = formatPrompt(loadedPrompts.node_operations.generate_node_edition, {
    think_mode: thinkMode,
    nodes_description: nodesDescription,
    formatted_chat_history: formattedChatHistory,
    last_moxus_report_section: lastMoxusReportSection + moxusGuidanceSection,
    actions_list: actions.join('\n'),
    user_input: userInput
  });

  const messages: Message[] = [{ role: 'system', content: nodeEditionPrompt }];
  let responsePayload: { llmResult: string, callId: string };
  try {
    responsePayload = await getResponse(messages, undefined, undefined, false, { type: 'json_object' }, undefined, 'node_edition_json') as { llmResult: string, callId: string };
  } catch (error) {
    console.error('[NodeInteractionService] generateNodeEdition (JSON): getResponse failed.', error);
    throw error;
  }
  
  return processJsonResponse(
    'NodeInteractionService', 
    'generateNodeEdition (JSON)', 
    responsePayload, 
    (jsonString) => {
      // More comprehensive JSON cleaning
      let cleanedJsonString = jsonString.trim();
      
      // Remove various markdown patterns
      cleanedJsonString = cleanedJsonString
        .replace(/^```json\s*\n?/i, '')
        .replace(/^```\s*json\s*\n?/i, '')
        .replace(/^```\s*\n?/, '')
        .replace(/\n?```\s*$/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      
      const parsedFromJson = safeJsonParse(cleanedJsonString);

      if (parsedFromJson && typeof parsedFromJson === 'object') {
        const response: LLMNodeEditionResponse = {
            callId: responsePayload.callId,
            n_nodes: parsedFromJson.n_nodes || undefined,
            u_nodes: parsedFromJson.u_nodes || undefined,
            d_nodes: parsedFromJson.d_nodes || undefined,
        };
        if (response.n_nodes !== undefined && !Array.isArray(response.n_nodes)) throw new Error("Invalid 'n_nodes' field: not an array.");
        if (response.u_nodes !== undefined && typeof response.u_nodes !== 'object') throw new Error("Invalid 'u_nodes' field: not an object.");
        if (response.d_nodes !== undefined && !Array.isArray(response.d_nodes)) throw new Error("Invalid 'd_nodes' field: not an array.");
        return response;
      } else {
        throw new Error('Parsed JSON is not a valid object for node edition.');
      }
    },
    true
  );
};

export const generateNodesFromPrompt = async (userPrompt: string, nodes: Node[], moxusMemoryInput?: { general?: string; chatText?: string; nodeEdition?: string; }, moxusPersonality?: string): Promise<any> => {
  console.log('LLM Call (NodeInteractionService): Generating nodes from prompt');
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "system" || node.type === "image_generation" || node.type === "assistant") return acc;
    return acc + `\n    id: ${node.id}\n    name: ${node.name}\n    longDescription: ${node.longDescription}\n    type: ${node.type}\n    `;
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
    responsePayload = await getResponse(
      messages,
      undefined,
      undefined,
      false,
      { type: 'json_object' },
      undefined,
      'generate_nodes_from_prompt'
    ) as { llmResult: string, callId: string };
  } catch (error) {
    console.error('[NodeInteractionService] generateNodesFromPrompt: getResponse failed.', error);
    throw error;
  }
  
  return processJsonResponse(
    'NodeInteractionService', 
    'generateNodesFromPrompt', 
    responsePayload, 
    (jsonString) => {
      // More comprehensive JSON cleaning
      let cleanedJsonString = jsonString.trim();
      
      // Remove various markdown patterns
      cleanedJsonString = cleanedJsonString
        .replace(/^```json\s*\n?/i, '')
        .replace(/^```\s*json\s*\n?/i, '')
        .replace(/^```\s*\n?/, '')
        .replace(/\n?```\s*$/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      
      const parsedFromJson = safeJsonParse(cleanedJsonString);

      const result: any = {};
      
      if (parsedFromJson.n_nodes && Array.isArray(parsedFromJson.n_nodes)) {
        result.newNodes = parsedFromJson.n_nodes;
      }
      
      if (parsedFromJson.u_nodes && typeof parsedFromJson.u_nodes === 'object') {
        const mergeNodes: Partial<Node>[] = [];
        
        for (const [nodeId, updates] of Object.entries(parsedFromJson.u_nodes || {})) {
          const existingNode = nodes.find(n => n.id === nodeId);
          if (!existingNode) continue;
          
          const updatedNode: Partial<Node> = { id: nodeId };
          
          if (typeof updates === 'object' && updates !== null) {
            for (const [field, operation] of Object.entries(updates)) {
              if (field === 'img_upd') {
                updatedNode.updateImage = operation as boolean;
                continue;
              }
              
              if (typeof operation === 'object' && operation !== null) {
                if ('rpl' in operation) {
                  (updatedNode as any)[field] = operation.rpl;
                }
              }
            }
            
            if (!updatedNode.name && existingNode) updatedNode.name = existingNode.name;
            if (!updatedNode.longDescription && existingNode) updatedNode.longDescription = existingNode.longDescription;
            if (!updatedNode.type && existingNode) updatedNode.type = existingNode.type;
            
            mergeNodes.push(updatedNode);
          }
        }
        
        if (mergeNodes.length > 0) {
          result.merge = mergeNodes;
        }
      }
      
      if (parsedFromJson.d_nodes && Array.isArray(parsedFromJson.d_nodes)) {
        result.delete = parsedFromJson.d_nodes;
      }
      
      return result;
    }
  );
};

export const sortNodesByRelevance = async (nodes: Node[], chatHistory: Message[]): Promise<string[]> => {
  console.log('LLM Call (NodeInteractionService): Sorting nodes by relevance');
  
  const lastFiveInteractions = getLastFiveInteractions(chatHistory);
  const lastMoxusReportMessage = [...chatHistory].reverse().find(message => message.role === "moxus");
  
  const stringHistory = lastFiveInteractions.reduce((acc, message) => {
    return acc + `${message.role}: ${message.content}\n`;
  }, "");

  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation" || node.type === "assistant") return acc;
    return acc + `\n      id: ${node.id}\n      name: ${node.name}\n      longDescription: ${node.longDescription}\n      type: ${node.type}\n      `;
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
    responsePayload = await getResponse(messages, undefined, undefined, false, { type: 'json_object' }, undefined, 'node_sort_by_relevance') as { llmResult: string, callId: string };
  } catch (error) {
    console.error('[NodeInteractionService] sortNodesByRelevance: getResponse failed.', error);
    throw error;
  }
  return processJsonResponse('NodeInteractionService', 'sortNodesByRelevance', responsePayload, (jsonString) => safeJsonParse(jsonString).sortedIds);
};

export const refocusStory = async (chatHistory: Message[], nodes: Node[]): Promise<{llmResult: string, callId: string}> => {
  console.log('LLM Call (NodeInteractionService): Refocusing story');
  const pastChatHistory = chatHistory.reduce((acc, message) => {
    if (message.role === "user" || message.role === "assistant") {
      return acc + `${message.role}: ${message.content}\n`;
    }
    return acc;
  }, "");

  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "image_generation" || node.type === "assistant") return acc;
    return acc + `\n    ---\n    id: ${node.id}\n    name: ${node.name}\n    longDescription: ${node.longDescription}\n    type: ${node.type}\n    `;
  }, "");

  const prompt = formatPrompt(loadedPrompts.node_operations.refocus_story, {
    past_chat_history: pastChatHistory,
    nodes_description: nodesDescription
  });

  const messages: Message[] = [{ role: 'system', content: prompt }];
  const responsePayload = await getResponse(messages, undefined, undefined, false, undefined, undefined, 'refocus_story_generation') as { llmResult: string, callId: string };
  
  moxusService.finalizeLLMCallRecord(responsePayload.callId, "Refocus story text generated successfully.");
  console.log(`[NodeInteractionService] refocusStory successful for callId: ${responsePayload.callId}`);
  return responsePayload; 
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