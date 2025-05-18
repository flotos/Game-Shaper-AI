import * as yaml from 'js-yaml';
import { Message } from '../context/ChatContext';
import { moxusService } from './MoxusService'; // MoxusService will use setMoxusFeedbackImpl with getMoxusFeedback from this file
import { Node } from '../models/Node'; // Needed for types in helper functions if they remain here

// Load and parse prompts
export interface PromptsConfig {
  moxus_prompts: {
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

let rawPrompts: string;
const llmMode = import.meta.env.VITE_LLM_MODE?.toUpperCase();

if (llmMode === 'BASE' && false) {
  // not ready yet
  // @ts-ignore
  const module = await import('../prompts-base.yaml?raw');
  rawPrompts = module.default;
} else { // Default to INSTRUCT
  // @ts-ignore
  const module = await import('../prompts-instruct.yaml?raw');
  rawPrompts = module.default;
}

export const loadedPrompts = yaml.load(rawPrompts) as PromptsConfig;

// Utility function to format prompts
export function formatPrompt(promptTemplate: string, replacements: Record<string, string | undefined>): string {
  let formattedPrompt = promptTemplate;
  for (const key in replacements) {
    const value = replacements[key];
    const replacementValue = value === undefined ? '' : String(value);
    formattedPrompt = formattedPrompt.replace(new RegExp(`\\{${key}\\}`, 'g'), replacementValue);
  }
  return formattedPrompt;
}

// Helper function to get the last N interactions from chat history (generalized)
export const getLastNInteractions = (chatHistory: Message[], numInteractions: number): Message[] => {
  if (numInteractions <= 0) return [];

  let assistantCount = 0;
  let lastNInteractions: Message[] = [];

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.role === "assistant") {
      assistantCount++;
    }
    // Include the message that makes it the Nth assistant turn and all subsequent user messages
    if (assistantCount === numInteractions) {
      lastNInteractions = chatHistory.slice(i);
      break;
    }
  }
  
  // If fewer than N assistant messages, use all available history up to that point
  if (assistantCount < numInteractions && assistantCount > 0) {
     // Find the first assistant message if we didn't hit numInteractions
     let firstAssistantIndex = -1;
     for (let i = chatHistory.length -1; i >=0; i--) {
        if (chatHistory[i].role === "assistant") {
            firstAssistantIndex = i;
        }
     }
     if (firstAssistantIndex !== -1) {
        lastNInteractions = chatHistory.slice(firstAssistantIndex);
     } else {
        lastNInteractions = chatHistory; // Or empty if no assistant messages at all
     }

  } else if (assistantCount === 0) {
    lastNInteractions = chatHistory; // Or handle as needed - maybe just recent user messages
  }
  
  return lastNInteractions.filter(message => 
    message.role === "user" || 
    message.role === "assistant" || 
    message.role === "userMandatoryInstructions"
  );
};


// Specific version for 5 interactions, as used before
export const getLastFiveInteractions = (chatHistory: Message[]): Message[] => {
    return getLastNInteractions(chatHistory, 5);
};


export const getChatHistoryForMoxus = (chatHistory: Message[], numAssistantTurns: number): Message[] => {
  let assistantCount = 0;
  let startIndex = 0; 

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.role === "assistant") {
      assistantCount++;
      if (assistantCount === numAssistantTurns) {
        startIndex = i; 
        break;
      }
    }
  }
  
  const historySlice = chatHistory.slice(startIndex);
  
  return historySlice.filter(message => 
    message.role === "user" || 
    message.role === "assistant" || 
    message.role === "userMandatoryInstructions" ||
    message.role === "moxus"
  );
};

export const getResponse = async (
  messages: Message[], 
  model = 'gpt-4o', 
  grammar: String | undefined = undefined, 
  stream = false, 
  responseFormat?: { type: string }, 
  options?: { skipMoxusFeedback?: boolean },
  callType: string = 'unknown'
) => {
  const apiType = import.meta.env.VITE_LLM_API;
  const includeReasoning = import.meta.env.VITE_LLM_INCLUDE_REASONING !== 'false';
  const maxRetries = 3;
  const retryDelay = 1000;

  const callId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const originalPromptString = JSON.stringify(messages);

  moxusService.initiateLLMCallRecord(callId, callType, model, originalPromptString);

  if (!options?.skipMoxusFeedback && !stream) {
    const moxusFeedbackContent = formatPrompt(loadedPrompts.moxus_prompts.moxus_feedback_system_message, {
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
        const openrouterModel = import.meta.env.VITE_OPENROUTER_MODEL || 'anthropic/claude-3-opus-20240229';
        const openrouterProvider = import.meta.env.VITE_OPENROUTER_PROVIDER;

        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_OPENROUTER_KEY}`,
            'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
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
              order: openrouterProvider ? [openrouterProvider] : undefined,
              allow_fallbacks: true
            },
            temperature: 0.6,
            top_p: 1,
            top_k: 20,
            min_p: 0,
            enable_thinking: includeReasoning,
            include_reasoning: true,
            presence_penalty: 0.1,
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
          password: "nodegame",
          grammar,
          stream: stream
        };

        response = await fetch(import.meta.env.VITE_KOBOLDCPP_API_URL + '/api/v1/generate', {
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
        const errorBody = await response.text();
        const errorMessage = `API request failed with status ${response.status}: ${response.statusText}. Body: ${errorBody}`;
        console.error(`[LLMCore] getResponse attempt ${attempt}/${maxRetries} failed: ${errorMessage}`);
        moxusService.failLLMCallRecord(callId, `API Error after ${maxRetries} attempts: ${response.status} ${response.statusText}. Prompt: ${originalPromptString}. Body: ${errorBody}`);
        lastError = new Error(errorMessage);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          continue;
        }
        throw lastError;
      }

      if (stream) {
        // moxusService.finalizeLLMCallRecord(callId, "Stream initiated successfully"); // Removed to prevent premature feedback
        return { 
          streamResponse: response, 
          callId: callId 
        };
      } else {
        const data = await response.json();
        let extractedContent;

        if (apiType === 'openai') {
          if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid OpenAI response structure');
          }
          extractedContent = data.choices[0].message.content;
        } else if (apiType === 'openrouter') {
          if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid OpenRouter response structure');
          }
          const content = data.choices[0].message.content;
          if (responseFormat?.type === 'json_object') {
            const cleanContent = content.replace(/```json\n|\n```/g, '').trim();
            extractedContent = cleanContent;
          } else {
            // Only process for reasoning if not a json_object type, as per original logic structure
            try {
              const parsedContent = JSON.parse(content);
              if (!includeReasoning && parsedContent.reasoning !== undefined) {
                delete parsedContent.reasoning;
                extractedContent = JSON.stringify(parsedContent);
              } else {
                extractedContent = content;
              }
            } catch (e) {
              extractedContent = content;
            }
          }
        } else if (apiType === 'koboldcpp') {
          if (data && data.results && data.results.length > 0 && typeof data.results[0].text === 'string') {
            extractedContent = data.results[0].text;
          } else {
            throw new Error(`Invalid KoboldCPP response structure or empty content. Full response: ${JSON.stringify(data)}`);
          }
        }

        if (extractedContent === undefined) {
          const safeguardError = new Error(`LLM content extraction failed unexpectedly for ${apiType} after API-specific parsing. Raw Data: ${JSON.stringify(data)}`);
          console.error(`[LLMCore] getResponse safeguard attempt ${attempt}/${maxRetries}: ${safeguardError.message}`);
          lastError = safeguardError;
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
            continue;
          }
          moxusService.failLLMCallRecord(callId, `Safeguard triggered after ${maxRetries} attempts for ${apiType}. Prompt: ${originalPromptString}. Data: ${JSON.stringify(data)}`);
          throw lastError;
        }

        moxusService.finalizeLLMCallRecord(callId, extractedContent);
        return { 
          llmResult: extractedContent, 
          callId: callId 
        };
      }
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      moxusService.failLLMCallRecord(callId, errorMessage);

      if (error instanceof TypeError && error.message.includes('NetworkError')) {
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      throw error;
    }
  }
  throw lastError;
};

export const getMoxusFeedback = async (promptContent: string, originalCallType?: string): Promise<string> => {
  console.log(`[LLMCore] Moxus request received. Generating feedback for original call type: ${originalCallType || 'unknown_original_type'}`);
  const estimatedTokens = Math.ceil(promptContent.length / 4);
  console.log(`[LLMCore] Estimated tokens for Moxus request: ~${estimatedTokens}`);
  
  const MAX_SAFE_TOKENS = 100000; 
  let processedPrompt = promptContent;
  
  if (estimatedTokens > MAX_SAFE_TOKENS) {
    console.warn(`[LLMCore] Moxus prompt exceeds safe token limit (~${estimatedTokens} tokens). Truncating...`);
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
    console.log(`[LLMCore] Truncated Moxus prompt to ~${Math.ceil(processedPrompt.length / 4)} tokens`);
  }
  
  const messages: Message[] = [
    { role: 'system', content: processedPrompt },
    { role: 'user', content: loadedPrompts.moxus_prompts.moxus_get_feedback_user_message }
  ];

  // Determine the specific callType for this moxus feedback generation
  let moxusCallType: string;
  if (originalCallType === 'INTERNAL_FINAL_REPORT_GENERATION_STEP') {
    moxusCallType = 'finalreport'; // Log the LLM call that *generates the report content* as 'finalreport'
  } else if (originalCallType && originalCallType.startsWith('INTERNAL_MEMORY_UPDATE_FOR_')) {
    const baseType = originalCallType.substring('INTERNAL_MEMORY_UPDATE_FOR_'.length);
    moxusCallType = `moxus_update_${baseType.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}_memory`;
  } else if (originalCallType === 'finalreport' || originalCallType === 'moxus_finalreport') {
    // If originalCallType is finalreport or moxus_finalreport, log feedback generation as generic
    // This prevents 'moxus_feedback_on_finalreport' or 'moxus_feedback_on_moxus_finalreport' from being created.
    moxusCallType = 'moxus_feedback_generation';
  } else if (originalCallType) {
    // For all other cases where feedback is generated on a specific call type
    moxusCallType = `moxus_feedback_on_${originalCallType.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}`;
  } else {
    moxusCallType = 'moxus_feedback_generation'; // Default if no originalCallType
  }

  let feedbackCallId: string | null = null; 
  try {
    const responsePayload = await getResponse(messages, 'gpt-4o', undefined, false, undefined, { skipMoxusFeedback: true }, moxusCallType);
    feedbackCallId = responsePayload.callId; // callId should always be present in responsePayload
    
    // Ensure feedbackCallId is treated as string before passing
    if (feedbackCallId) { 
      moxusService.finalizeLLMCallRecord(feedbackCallId, responsePayload.llmResult as string);
      console.log(`[LLMCore] Moxus feedback generated for type: ${moxusCallType} (Call ID: ${feedbackCallId})`);
      return responsePayload.llmResult as string;
    } else {
      // This case should ideally not happen if getResponse always returns a callId
      console.error('[LLMCore] Failed to get callId from getResponse for Moxus feedback.');
      throw new Error('Failed to obtain callId for Moxus feedback logging.');
    }
  } catch (error) {
    if (feedbackCallId) { // This check is good
      moxusService.failLLMCallRecord(feedbackCallId, error instanceof Error ? error.message : String(error));
    }
    console.error('[LLMCore] Error getting Moxus feedback:', error);
    // Re-throw the original error or a new specific one
    if (error instanceof Error && error.message === 'Failed to obtain callId for Moxus feedback logging.') {
        throw error;
    }
    throw new Error(`Failed to get Moxus feedback from LLM. Original error: ${error instanceof Error ? error.message : String(error)}`);
  }
}; 