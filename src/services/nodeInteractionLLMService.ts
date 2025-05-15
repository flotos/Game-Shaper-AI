import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import {
  getResponse, 
  formatPrompt, 
  loadedPrompts, 
  getLastFiveInteractions 
} from './llmCore';

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
  const response = await getResponse(messages, "gpt-3.5-turbo", undefined, false, { type: 'json_object' });
  const parsed = JSON.parse(response);
  return parsed.relevantNodes;
};

export const generateChatText = async(userInput: string, chatHistory: Message[], nodes: Node[], _detailledNodeIds: String[]): Promise<any> => { // _detailledNodeIds seems unused
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
  return getResponse(chatTextMessages, 'gpt-4o', undefined, true); // Stream response
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
  const actionsResponse = await getResponse(actionsMessages, 'gpt-4o', undefined, false, { type: 'json_object' });
  const parsed = JSON.parse(actionsResponse);
  return parsed.actions;
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
  const response = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' });
  return JSON.parse(response);
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
  const response = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' });
  return JSON.parse(response);
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
  const response = await getResponse(messages, "gpt-4", undefined, false, { type: 'json_object' });
  const parsed = JSON.parse(response);
  return parsed.sortedIds;
};

// This function was originally part of LLMService, combining generateChatText, generateActions, and generateNodeEdition.
// It can either live here or be recomposed by the UI/application layer if preferred.
// For now, keeping it here to maintain a similar public API surface for this part.
export const generateUserInputResponse = async(userInput: string, chatHistory: Message[], nodes: Node[], detailledNodeIds: String[]) => {
  console.log('LLM Call (NodeInteractionService): Generating full user input response');
  // First generate chat text
  const chatTextStream = await generateChatText(userInput, chatHistory, nodes, detailledNodeIds);
  
  // Note: If generateChatText returns a stream, we need to resolve it to a string 
  // before passing to generateActions and generateNodeEdition if they expect full text.
  // Assuming for now the caller of generateUserInputResponse handles stream consumption and then calls for actions/edits separately,
  // OR that generateActions/NodeEdition are adapted for potentially partial/streamed chatText if that's the flow.
  // The original LLMService awaited generateChatText which implies it was resolved before passing.
  // If chatTextStream is a Response object from fetch (for streaming), we need to process it.
  
  let accumulatedChatText = "";
  if (chatTextStream && chatTextStream.body) { // Check if it's a fetch Response stream
    const reader = chatTextStream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulatedChatText += decoder.decode(value, { stream: true });
    }
  } else {
    // If it wasn't a stream or couldn't be read as one, assume it's already the text (though this path needs review based on getResponse stream handling)
    accumulatedChatText = chatTextStream; 
  }
  
  // Run processes in parallel AFTER chat text is fully accumulated
  const [actions, nodeEdition] = await Promise.all([
    generateActions(accumulatedChatText, nodes, userInput), // Pass accumulated string
    generateNodeEdition(accumulatedChatText, [], nodes, userInput, true) // Pass accumulated string, empty actions for this specific call context
  ]);
  
  return {
    chatText: accumulatedChatText, // Return the resolved chat text string
    actions,
    nodeEdition,
  };
} 