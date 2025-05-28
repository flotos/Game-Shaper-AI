import { Message } from '../context/ChatContext';
import { moxusService } from './MoxusService'; // MoxusService will use setMoxusFeedbackImpl with getMoxusFeedback from this file
import { Node } from '../models/Node'; // Needed for types in helper functions if they remain here
import { safeJsonParse } from '../utils/jsonUtils';

// Load and parse prompts
export interface PromptsConfig {
  moxus_prompts: {
    moxus_feedback_on_chat_text_generation: string;
    moxus_feedback_on_node_edition_json: string;
    moxus_feedback_on_manual_node_edit: string;
    moxus_feedback_on_assistant_feedback: string;
    general_memory_update: string;
    memory_section_update: string;
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
    refocus_story: string;
  };
  utils: {
    diffPrompt: string;
    moxus_feedback_system_message: string;
    wrappers: {
      [key: string]: string;
    };
  };
}

const llmMode = import.meta.env.VITE_LLM_MODE?.toUpperCase();

let loadedPrompts: PromptsConfig;

if (llmMode === 'BASE' && false) {
  loadedPrompts = (await import('../prompts-base.yaml')).default as PromptsConfig;
} else {
  loadedPrompts = (await import('../prompts-instruct.yaml')).default as PromptsConfig;
}

export { loadedPrompts };

// Utility function to format prompts
export function formatPrompt(promptTemplate: string, replacements: Record<string, string | undefined>): string {
  let formattedPrompt = promptTemplate;
  
  // First, process utils.wrappers.* placeholders - inject wrapper structure
  const wrapperRegex = /\{utils\.wrappers\.([^}]+)\}/g;
  let match;
  
  while ((match = wrapperRegex.exec(formattedPrompt)) !== null) {
    const wrapperName = match[1];
    const fullPlaceholder = match[0];
    
    // Get wrapper definition from loaded prompts
    const contentName = loadedPrompts?.utils?.wrappers?.[wrapperName];
    
    if (contentName) {
      // In the new format, wrapperName is the contentPlaceholder and contentName is the display name
      const contentPlaceholder = wrapperName;
      
      // Create the wrapper structure with the placeholder still intact
      const wrappedContent = `## ${contentName}:\n---- Start of ${contentName.toLowerCase()}\n{${contentPlaceholder}}\n---- End of ${contentName.toLowerCase()}`;
      
      // Replace the wrapper placeholder with the formatted structure (still containing content placeholder)
      formattedPrompt = formattedPrompt.replace(fullPlaceholder, wrappedContent);
    } else {
      // If wrapper not found, leave placeholder as-is or replace with empty string
      console.warn(`[formatPrompt] Wrapper not found: ${wrapperName}`);
      formattedPrompt = formattedPrompt.replace(fullPlaceholder, `[Wrapper not found: ${wrapperName}]`);
    }
  }
  
  // Second, process other utils.* placeholders (like utils.diffPrompt)
  const utilsRegex = /\{utils\.([^}]+)\}/g;
  while ((match = utilsRegex.exec(formattedPrompt)) !== null) {
    const utilsProperty = match[1];
    const fullPlaceholder = match[0];
    
    // Skip wrappers as they're already processed above
    if (utilsProperty.startsWith('wrappers.')) {
      continue;
    }
    
    // Get the utils property value
    const utilsValue = (loadedPrompts?.utils as any)?.[utilsProperty];
    
    if (utilsValue !== undefined) {
      formattedPrompt = formattedPrompt.replace(fullPlaceholder, utilsValue);
    } else {
      console.warn(`[formatPrompt] Utils property not found: ${utilsProperty}`);
      formattedPrompt = formattedPrompt.replace(fullPlaceholder, `[Utils property not found: ${utilsProperty}]`);
    }
  }
  
  // Then, process regular placeholders (including the content placeholders from wrappers)
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
    const moxusFeedbackContent = formatPrompt(loadedPrompts.utils.moxus_feedback_system_message, {
      moxus_llm_calls_memory_yaml: moxusService.getLLMCallsMemoryJSON()
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

  // Ensure the last message is from the user for APIs that use the messages array directly
  // This applies to openai, openrouter, and deepseek. KoboldCPP transforms the array to a string prompt.
  if (apiType === 'openai' || apiType === 'openrouter' || apiType === 'deepseek') {
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex !== -1) {
      // If a user message exists and it's not already the last one
      if (lastUserMessageIndex < messages.length - 1) {
        const userMessage = messages.splice(lastUserMessageIndex, 1)[0];
        messages.push(userMessage);
      }
    } else {
      // No user message found, add a generic one.
      messages.push({ role: 'user', content: 'Please process the instructions and generate a response.' });
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
      } else if (apiType === 'deepseek') {
        const deepseekModel = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat';
        
        const deepSeekPayload: any = {
          model: deepseekModel,
          messages: messages,
          stream: stream,
          temperature: 0.2,
          frequency_penalty: 0,
        };

        if (responseFormat) {
          if (!(deepseekModel === 'deepseek-reasoner' && responseFormat.type === 'json_object')) {
            deepSeekPayload.response_format = responseFormat;
          }
        }

        response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_DEEPSEEK_KEY}`
          },
          body: JSON.stringify(deepSeekPayload)
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
              const parsedContent = safeJsonParse(content);
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
        } else if (apiType === 'deepseek') {
          if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid DeepSeek response structure');
          }
          extractedContent = data.choices[0].message.content;
          // Check if the original request intended a JSON object and the API is deepseek
          if (responseFormat?.type === 'json_object') {
            // Strip markdown ```json and ``` if present
            if (extractedContent.startsWith("```json\n")) {
              extractedContent = extractedContent.substring(7);
            }
            if (extractedContent.endsWith("\n```")) {
              extractedContent = extractedContent.substring(0, extractedContent.length - 4);
            } else if (extractedContent.endsWith("```")) { // Handle cases where there's no newline before the final backticks
              extractedContent = extractedContent.substring(0, extractedContent.length - 3);
            }
            extractedContent = extractedContent.trim(); // Clean up any leading/trailing whitespace just in case
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

export const getMoxusFeedback = async (promptContent: string, originalCallType: string = 'unknown'): Promise<string> => {
  try {
    const messages: Message[] = [
      { role: 'user', content: promptContent }
    ];

    // Only use json_object for call types that use diff logic and contain "json" in the prompt
    const callTypesRequiringJson = [
      'moxus_feedback_on_chat_text_generation',
      'moxus_feedback_on_node_edition_json', 
      'moxus_feedback_on_manual_node_edit',
      'moxus_feedback_on_assistant_feedback',
      'INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory' // Only when using general_memory_update prompt
    ];
    
    // Check if this call type requires JSON and if the prompt contains "json"
    const requiresJsonFormat = callTypesRequiringJson.includes(originalCallType) && 
                              promptContent.toLowerCase().includes('json');
    
    const responseFormat = requiresJsonFormat ? { type: 'json_object' } : undefined;

    const response = await getResponse(
      messages, 
      'gpt-4o-mini', 
      undefined, 
      false, 
      responseFormat,
      undefined, 
      originalCallType
    );
    
    if (typeof response === 'string') {
      return response;
    } else {
      return response.llmResult;
    }
  } catch (error) {
    console.error('Error getting Moxus feedback:', error);
    return 'Error getting Moxus feedback';
  }
}; 