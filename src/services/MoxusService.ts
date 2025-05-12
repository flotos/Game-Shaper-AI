import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import yaml from 'js-yaml';

// Avoid circular dependency by forward declaring the function type
type GetMoxusFeedbackFn = (promptContent: string) => Promise<string>;
let getMoxusFeedbackImpl: GetMoxusFeedbackFn | null = null;

// This function will be called to set the actual implementation after LLMService is initialized
export const setMoxusFeedbackImpl = (impl: GetMoxusFeedbackFn) => {
  getMoxusFeedbackImpl = impl;
};

// Define Task Types
type MoxusTaskType = 
  | 'assistantFeedback' 
  | 'nodeEditFeedback' 
  | 'storyFeedback' 
  | 'nodeUpdateFeedback' 
  | 'finalReport'
  | 'llmCallFeedback';

// Define Task Structure
interface MoxusTask {
  id: number;
  type: MoxusTaskType;
  data: any; // Specific data depends on the task type
  timestamp: Date;
}

// LLM Call Memory structure
interface LLMCallMemory {
  calls: {
    [id: string]: {
      prompt: string;
      response: string;
      timestamp: Date;
      feedback?: string;
    }
  }
  generalFeedback: string;
}

// Simple In-Memory Store for Moxus Feedback
let moxusMemory: string = '';
let llmCallsMemory: LLMCallMemory = { calls: {}, generalFeedback: '' };
let isProcessing = false;
let taskQueue: MoxusTask[] = [];
let nextTaskId = 1;
let getNodesCallback: () => Node[] = () => []; // Callback to get current nodes
let addMessageCallback: (message: Message) => void = () => {}; // Callback to add chat message

const MOXUS_MEMORY_KEY = 'moxusMemory';
const MOXUS_LLM_CALLS_MEMORY_KEY = 'moxusLLMCallsMemory';

// --- Memory Management ---
const loadMemory = () => {
  try {
    const savedMemory = localStorage.getItem(MOXUS_MEMORY_KEY);
    const savedLLMCallsMemory = localStorage.getItem(MOXUS_LLM_CALLS_MEMORY_KEY);
    
    if (savedMemory) {
      moxusMemory = savedMemory;
      console.log('[MoxusService] Loaded memory from localStorage.');
    }
    
    if (savedLLMCallsMemory) {
      llmCallsMemory = JSON.parse(savedLLMCallsMemory);
      console.log('[MoxusService] Loaded LLM calls memory from localStorage.');
    }
  } catch (error) {
    console.error('[MoxusService] Error loading memory from localStorage:', error);
  }
};

const saveMemory = () => {
  try {
    localStorage.setItem(MOXUS_MEMORY_KEY, moxusMemory);
    localStorage.setItem(MOXUS_LLM_CALLS_MEMORY_KEY, JSON.stringify(llmCallsMemory));
  } catch (error) {
    console.error('[MoxusService] Error saving memory to localStorage:', error);
  }
};

// --- LLM Call Memory Management ---
export const recordLLMCall = (id: string, prompt: string, response: string) => {
  llmCallsMemory.calls[id] = {
    prompt,
    response,
    timestamp: new Date()
  };
  saveMemory();
  console.log(`[MoxusService] Recorded LLM call: ${id}`);
};

export const getLLMCallFeedback = (id: string): string | undefined => {
  return llmCallsMemory.calls[id]?.feedback;
};

// --- Initialization ---
const initialize = (getNodes: () => Node[], addMessage: (message: Message) => void) => {
  console.log('[MoxusService] Initializing...');
  getNodesCallback = getNodes;
  addMessageCallback = addMessage;
  loadMemory();
  // Trigger processing if tasks were added before init (e.g., during load)
  triggerProcessing();
};

// Function to add a task to the queue
const addTask = (type: MoxusTaskType, data: any) => {
  const newTask: MoxusTask = {
    id: nextTaskId++,
    type,
    data,
    timestamp: new Date(),
  };
  taskQueue.push(newTask);
  console.log(`[MoxusService] Task added: ${type} (ID: ${newTask.id}). Queue size: ${taskQueue.length}`);
  triggerProcessing(); // Attempt to process immediately
};

// Function to trigger queue processing if not already running
const triggerProcessing = () => {
  if (!isProcessing) {
    processQueue();
  }
};

// Asynchronous function to process the queue
const processQueue = async () => {
  if (taskQueue.length === 0) {
    console.log('[MoxusService] Queue empty. Processor idle.');
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const task = taskQueue.shift(); 

  if (!task) {
    isProcessing = false;
    return; 
  }

  console.log(`[MoxusService] Processing task: ${task.type} (ID: ${task.id}). Remaining: ${taskQueue.length}`);

  try {
    // Get assistant node content using the callback
    const assistantNodesContent = getAssistantNodesContent();

    // Construct the specific prompt - IMPROVE THIS LATER
    let promptContent = `Your name is Moxus, a helpful AI assistant acting as a reviewer for the LLM system within a game engine.\n    Your goal is to provide constructive feedback on LLM calls, responses, and the evolving game state.\n    Analyze the following task data based on the task type and your current memory.\n    \n    Assistant Personality (Defined by 'assistant' nodes):\n    ---\n    ${assistantNodesContent}\n    ---\n    \n    Current Memory (Your previous feedback):\n    ---\n    ${moxusMemory || '(Memory is empty)'}\n    ---\n    \n    Current Task:\n    Type: ${task.type}\n    Timestamp: ${task.timestamp.toISOString()}\n    Data:\n    \`\`\`json\n    ${JSON.stringify(task.data, null, 2)}\n    \`\`\`\n    \n    Instructions:\n    `;

    if (task.type === 'finalReport') {
      promptContent += `Review your entire memory log. Synthesize the key feedback points into a concise report for the user about the story generation, node updates, and overall coherence. Present this as a single block of text.`;
    } else if (task.type === 'assistantFeedback') {
      promptContent += `The user interacted with the main assistant. Review the user's prompt (data.query) and the resulting node changes (data.result). Provide feedback on the quality and relevance of the changes. Append your feedback to the memory.`;
    } else if (task.type === 'nodeEditFeedback') {
      promptContent += `The user manually edited a node. Review the node state before (data.before) and after (data.after) the edit. Provide feedback on the changes made, considering consistency and game rules. Append your feedback to the memory.`;
    } else if (task.type === 'storyFeedback') {
      promptContent += `A node sorting operation (triggered by chat interaction) just completed. Review the entire chat history (data.chatHistory). Provide feedback on the generated story, plot progression, character interactions, and consistency. Append your feedback to the memory.`;
    } else if (task.type === 'nodeUpdateFeedback') {
      promptContent += `A node sorting operation (triggered by chat interaction) just completed. Review the final node state (data.nodes) and the chat history (data.chatHistory). Provide feedback on how well the nodes reflect the story events and the overall coherence of the game world structure. Append your feedback to the memory.`;
    } else if (task.type === 'llmCallFeedback') {
      promptContent += `Review the LLM call prompt (data.prompt) and response (data.response). Provide feedback on the quality, relevance and coherence of the response. Focus on how the LLM could improve its responses in future iterations. This feedback will be provided to the LLM on its next call to help it improve.`;
    } else {
      promptContent += `Analyze the provided data based on the task type (${task.type}) and provide general feedback. Append your feedback to the memory.`;
    }

    console.log(`[MoxusService] Sending prompt for task ${task.id} to LLM...`);
    if (!getMoxusFeedbackImpl) {
      throw new Error('getMoxusFeedback implementation not set. Make sure to call setMoxusFeedbackImpl first.');
    }
    const feedback = await getMoxusFeedbackImpl(promptContent); // Use the implementation

    console.log(`[MoxusService] Received feedback for task ${task.id}`);

    if (task.type === 'finalReport') {
      // Send feedback to chat interface using the callback
      console.log(`[MoxusService] Sending Final Report to chat.`);
      addMessageCallback({ 
        role: 'system', // Or a custom 'moxus' role if desired
        content: `**Moxus Report:**\n\n${feedback}` 
      });
      // Optional: Clear memory after report? Let's keep it for now.
      // moxusMemory = ''; 
    } else if (task.type === 'llmCallFeedback') {
      // Store feedback for this specific LLM call
      if (task.data && task.data.id) {
        if (llmCallsMemory.calls[task.data.id]) {
          llmCallsMemory.calls[task.data.id].feedback = feedback;
          saveMemory();
          console.log(`[MoxusService] Stored feedback for LLM call: ${task.data.id}`);
        } else {
          console.error(`[MoxusService] Cannot find LLM call with ID: ${task.data.id}`);
        }
      } else {
        // Add to general feedback if no specific ID
        llmCallsMemory.generalFeedback += `\n\n${feedback}`;
        saveMemory();
      }
    } else {
      // Append feedback to memory
      moxusMemory += `\n\n-- Feedback from Task ${task.id} (${task.type}) at ${new Date().toISOString()} --\n${feedback}`;
      saveMemory(); // Save memory after appending
      console.log(`[MoxusService] Appended feedback to memory for task ${task.id}. Memory length: ${moxusMemory.length}`);
    }

  } catch (error) {
    console.error(`[MoxusService] Error processing task ${task.id} (${task.type}):`, error);
  } finally {
    // Process the next task recursively after a short delay
    setTimeout(() => {
        isProcessing = false; // Allow next trigger
        triggerProcessing(); // Check if more tasks arrived while processing
    }, 500); 
  }
};

// Function to get assistant node content (Placeholder - needs access to nodes)
// This needs to be implemented properly, potentially requiring access to the Node graph state.
const getAssistantNodesContent = (): string => {
    const currentNodes = getNodesCallback(); // Use the callback
    const assistantNodes = currentNodes.filter(node => node.type === 'assistant');
    if (assistantNodes.length === 0) {
        return "(No 'assistant' type nodes found)";
    }
    return assistantNodes
        .map(node => `Name: ${node.name}\nDescription: ${node.longDescription}\nRules: ${node.rules}`)
        .join('\n\n---\n\n');
}

// Generate YAML representation of llmCallsMemory for inclusion in prompts
export const getLLMCallsMemoryYAML = (): string => {
  try {
    return yaml.dump(llmCallsMemory);
  } catch (error) {
    console.error('[MoxusService] Error generating YAML:', error);
    return "Error generating memory YAML";
  }
};

// Export the service functions
export const moxusService = {
  initialize,
  addTask,
  recordLLMCall,
  getLLMCallFeedback,
  getLLMCallsMemoryYAML,
  // For testing purposes
  debugLogMemory: () => {
    console.log('LLM Calls Memory:', llmCallsMemory);
    console.log('YAML representation:', getLLMCallsMemoryYAML());
  }
};

// Initial trigger in case tasks were added before the service was fully initialized (e.g., during load)
// triggerProcessing(); // Might be better to trigger explicitly after app initialization 