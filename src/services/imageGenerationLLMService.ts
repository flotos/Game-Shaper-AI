import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import { getResponse, formatPrompt, loadedPrompts } from './llmCore';
import { moxusService } from '../services/MoxusService';

// This function was originally in LLMService.ts
function getTypeSpecificPromptAddition(nodeType: string | undefined): string {
  const typeKey = nodeType || 'default';
  // Ensure loadedPrompts and its nested properties are accessed safely
  const additions = loadedPrompts?.image_generation?.type_specific_additions;
  if (additions) {
    return additions[typeKey] || additions['default'] || '';
  }
  return ''; // Fallback if prompts aren't loaded or structured as expected
}

export const generateImagePrompt = async(node: Partial<Node>, allNodes: Node[], chatHistory: Message[] = []): Promise<string> => {
  console.log('LLM Call (ImageGenerationService): Generating image prompt for node:', node.id);
  const imageGenerationNodes = allNodes.filter(n => n.type === "image_generation");
  
  let contentPrompt = "";
  const typeSpecificAddition = getTypeSpecificPromptAddition(node.type);
  const allNodesContext = allNodes.reduce((acc, nodet) => {
    return acc + `
    ---
    name: ${nodet.name}
    longDescription: ${nodet.longDescription}
    `;
  }, "");
  const chatHistoryContext = chatHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n');

  if (imageGenerationNodes.length > 0) {
    const imageGenerationNodesContent = imageGenerationNodes.map(n => {
      let prompt = "";
      if (n.longDescription) prompt += n.longDescription + "\n";
      return prompt;
    }).join("\n");

    contentPrompt = formatPrompt(loadedPrompts.image_generation.base_prompt_with_instructions_node, {
      image_generation_nodes_content: imageGenerationNodesContent,
      node_name: node.name,
      node_long_description: node.longDescription,
      node_type: node.type,
      type_specific_prompt_addition: typeSpecificAddition,
      all_nodes_context: allNodesContext,
      chat_history_context: chatHistoryContext
    });
  } else {
    contentPrompt = formatPrompt(loadedPrompts.image_generation.base_prompt_default, {
      node_name: node.name,
      node_long_description: node.longDescription,
      node_type: node.type,
      type_specific_prompt_addition: typeSpecificAddition,
      all_nodes_context: allNodesContext,
      chat_history_context: chatHistoryContext
    });
  }

  const messages: Message[] = [
    { role: 'system', content: contentPrompt },
  ];

  const callType = 'image_prompt_generation';
  let responsePayload: { llmResult?: any; callId: string; streamResponse?: Response } | null = null;

  try {
    // Pass the specific callType to getResponse
    responsePayload = await getResponse(messages, 'gpt-4o', undefined, false, undefined, { skipMoxusFeedback: true }, callType);
    
    if (!responsePayload || typeof responsePayload.llmResult !== 'string') {
      const errMsg = 'generateImagePrompt did not receive a valid llmResult string.';
      if(responsePayload && responsePayload.callId) {
        moxusService.failLLMCallRecord(responsePayload.callId, errMsg);
      }
      throw new Error(errMsg);
    }
    
    // Finalize as successful since we expect a string and no further parsing is done here.
    moxusService.finalizeLLMCallRecord(responsePayload.callId, responsePayload.llmResult);
    return responsePayload.llmResult;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ImageGenerationService] Error in ${callType} (callId: ${responsePayload?.callId}):`, errorMessage);
    // If responsePayload and callId exist, and it hasn't been failed by getResponse itself,
    // ensure it's marked as failed here. getResponse should handle its own fetch/API errors.
    // This catch is more for issues after getResponse returns or if it throws unexpectedly before returning a payload.
    if (responsePayload && responsePayload.callId && 
        !moxusService.getLLMLogEntries().find(log => log.id === responsePayload!.callId && log.status === 'failed')) {
      moxusService.failLLMCallRecord(responsePayload.callId, `Error in ${callType}: ${errorMessage}`);
    }
    // Fallback or rethrow as appropriate for the service's contract
    // For now, returning an empty string similar to other image service error paths.
    return ''; 
  }
}; 