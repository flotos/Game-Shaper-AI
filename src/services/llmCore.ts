import * as yaml from 'js-yaml';
import rawPrompts from '../prompts.yaml?raw';
import { Message } from '../context/ChatContext';
import { moxusService } from './MoxusService'; // MoxusService will use setMoxusFeedbackImpl with getMoxusFeedback from this file
import { Node } from '../models/Node'; // Needed for types in helper functions if they remain here

// Load and parse prompts
export interface PromptsConfig {
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

export const getResponse = async (messages: Message[], model = 'gpt-4o', grammar: String | undefined = undefined, stream = false, responseFormat?: { type: string }, options?: { skipMoxusFeedback?: boolean }) => {
  const apiType = import.meta.env.VITE_LLM_API;
  const includeReasoning = import.meta.env.VITE_LLM_INCLUDE_REASONING !== 'false';
  const maxRetries = 3;
  const retryDelay = 1000;

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
          password: "nodegame",
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
      let llmResult;

      if (apiType === 'openai') {
        if (!data.choices?.[0]?.message?.content) {
          throw new Error('Invalid OpenAI response structure');
        }
        llmResult = data.choices[0].message.content;
      } else if (apiType === 'openrouter') {
        if (!data.choices?.[0]?.message?.content) {
          throw new Error('Invalid OpenRouter response structure');
        }
        const content = data.choices[0].message.content;
        if (responseFormat?.type === 'json_object') {
          const cleanContent = content.replace(/```json\n|\n```/g, '').trim();
          return cleanContent; // Return directly as it's expected to be a JSON string
        }
        try {
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
          throw new Error('Invalid KoboldCPP response structure');
        }
        llmResult = data.results[0].text;
      }

      if (llmResult === undefined || llmResult === null) {
        throw new Error('No valid response received from LLM API');
      }

      if (!stream && !options?.skipMoxusFeedback) {
        moxusService.recordLLMCall(callId, originalPrompt, llmResult);
      }
      return llmResult;
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} failed:`, error);
      if (error instanceof TypeError && error.message.includes('NetworkError')) {
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      throw error;
    }
  }
  throw lastError; // Should be unreachable if loop always throws or returns
};

export const getMoxusFeedback = async (promptContent: string): Promise<string> => {
  console.log('[LLMCore] Moxus request received.');
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
    { role: 'user', content: loadedPrompts.common.moxus_get_feedback_user_message }
  ];

  try {
    const response = await getResponse(messages, 'gpt-4o', undefined, false, undefined, { skipMoxusFeedback: true });
    console.log('[LLMCore] Moxus feedback generated.');
    return response;
  } catch (error) {
    console.error('[LLMCore] Error getting Moxus feedback:', error);
    throw new Error('Failed to get Moxus feedback from LLM.');
  }
}; 