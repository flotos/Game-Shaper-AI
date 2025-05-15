import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import yaml from 'js-yaml';
import { getChatHistoryForMoxus } from './llmCore';

// Avoid circular dependency by forward declaring the function type
type GetMoxusFeedbackFn = (promptContent: string, originalCallType?: string) => Promise<string>;
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
  | 'llmCallFeedback'
  | 'chatTextFeedback'
  | 'updateGeneralMemory';

// Define Task Structure
interface MoxusTask {
  id: number;
  type: MoxusTaskType;
  data: any; // Specific data depends on the task type
  timestamp: Date;
}

// LLM Call interface structure (Restored full version)
export interface LLMCall {
  id: string; 
  prompt: string; 
  response?: string; 
  timestamp: Date; 
  feedback?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  callType: string; 
  modelUsed: string; 
  error?: string; 
  duration?: number; 
}

// LLM Calls memory structure
interface LLMCallsMemoryMap {
  [id: string]: LLMCall;
}

// Moxus Memory structure
interface MoxusMemoryStructure {
  GeneralMemory: string;
  featureSpecificMemory: {
    nodeEdition: string;
    chatText: string;
    assistantFeedback: string;
    nodeEdit: string;
    llmCalls: LLMCallsMemoryMap;
  }
}

// Default memory content templates
const DEFAULT_MEMORY = {
  GENERAL: '# Moxus Game Analysis\n\n*This document contains general observations and analysis about the game world, story progression, and gameplay. You should also dedicate a section to develop your own personality and style. Become a sentient being.*',
  NODE_EDITION: '# Node Editions Analysis\n\n*This document analyzes changes to game nodes over time and their impact on the game world.*',
  CHAT_TEXT: '# Chat Text Analysis\n\n*This document analyzes narrative quality and coherence in the generated story text.*',
  ASSISTANT_FEEDBACK: '# Assistant Interactions Analysis\n\n*This document analyzes assistant responses and their effectiveness.*',
  NODE_EDIT: '# Manual Node Edits Analysis\n\n*This document analyzes manual edits made to nodes by the user.*'
};

// Initialize with default structure
const createDefaultMemoryStructure = (): MoxusMemoryStructure => ({
  GeneralMemory: DEFAULT_MEMORY.GENERAL,
  featureSpecificMemory: {
    nodeEdition: DEFAULT_MEMORY.NODE_EDITION,
    chatText: DEFAULT_MEMORY.CHAT_TEXT,
    assistantFeedback: DEFAULT_MEMORY.ASSISTANT_FEEDBACK,
    nodeEdit: DEFAULT_MEMORY.NODE_EDIT,
    llmCalls: {}
  }
});

// Storage key
const MOXUS_STRUCTURED_MEMORY_KEY = 'moxusStructuredMemory';

// Initialize memory structure
let moxusStructuredMemory = createDefaultMemoryStructure();
// let isProcessing = false; // REMOVED: Replaced with more granular active task tracking
let taskQueue: MoxusTask[] = [];
let nextTaskId = 1;
let getNodesCallback: () => Node[] = () => []; // Callback to get current nodes
let addMessageCallback: (message: Message) => void = () => {}; // Callback to add chat message

// State for active feedback tasks
let activeStoryFeedback: Promise<void> | null = null;
let activeNodeUpdateFeedback: Promise<void> | null = null;
let processingTimeoutId: ReturnType<typeof setTimeout> | null = null;

// --- Listener Pattern for UI Updates (Restored) ---
type LLMLogListener = (logEntries: LLMCall[]) => void;
const llmLogListeners: LLMLogListener[] = [];

const subscribeToLLMLogUpdates = (listener: LLMLogListener) => {
  llmLogListeners.push(listener);
  return () => {
    const index = llmLogListeners.indexOf(listener);
    if (index > -1) {
      llmLogListeners.splice(index, 1);
    }
  };
};

const emitLLMLogUpdate = () => {
  const entries = getLLMLogEntries();
  llmLogListeners.forEach(listener => listener(entries));
};
// --- End Listener Pattern ---

// Function to sanitize nodes for Moxus feedback - removes any base64 image data
const sanitizeNodesForMoxus = (nodes: Node[]): any[] => {
  if (!nodes || !Array.isArray(nodes)) return [];
  
  return nodes.map(node => {
    // Create a new object with all properties except 'image'
    const { image, ...sanitizedNode } = node;
    
    // Return the sanitized node without the image property
    return sanitizedNode;
  });
};

// NEW Helper function to get and format chat history for Moxus prompts
const getFormattedChatHistoryStringForMoxus = (chatHistory: Message[], numTurns: number): string => {
  if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) {
    return "(No chat history available)";
  }
  const relevantHistory = getChatHistoryForMoxus(chatHistory, numTurns); // Uses the imported function
  if (relevantHistory.length === 0) {
    return "(No relevant chat history for the last " + numTurns + " turns)";
  }
  return relevantHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
};

// --- Memory Management ---
const loadMemory = () => {
  try {
    const savedStructuredMemory = localStorage.getItem(MOXUS_STRUCTURED_MEMORY_KEY);
    
    if (savedStructuredMemory) {
      const parsedMemory = JSON.parse(savedStructuredMemory);
      
      // Create the memory structure with defaults for any missing properties
      moxusStructuredMemory = {
        GeneralMemory: parsedMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL,
        featureSpecificMemory: {
          nodeEdition: parsedMemory.featureSpecificMemory?.nodeEdition || DEFAULT_MEMORY.NODE_EDITION,
          chatText: parsedMemory.featureSpecificMemory?.chatText || DEFAULT_MEMORY.CHAT_TEXT,
          assistantFeedback: parsedMemory.featureSpecificMemory?.assistantFeedback || DEFAULT_MEMORY.ASSISTANT_FEEDBACK,
          nodeEdit: parsedMemory.featureSpecificMemory?.nodeEdit || DEFAULT_MEMORY.NODE_EDIT,
          llmCalls: parsedMemory.featureSpecificMemory?.llmCalls || {}
        }
      };
      
      // (Restored) Ensure all loaded LLMCall objects have the 'id' field and other defaults
      if (moxusStructuredMemory.featureSpecificMemory.llmCalls) {
        const migratedCalls: LLMCallsMemoryMap = {};
        for (const key in moxusStructuredMemory.featureSpecificMemory.llmCalls) {
          if (Object.prototype.hasOwnProperty.call(moxusStructuredMemory.featureSpecificMemory.llmCalls, key)) {
            const call = moxusStructuredMemory.featureSpecificMemory.llmCalls[key] as any; // Cast to any for migration
            migratedCalls[key] = {
              id: key,  
              prompt: call.prompt || "[prompt unavailable]",
              response: call.response,
              timestamp: call.timestamp ? new Date(call.timestamp) : new Date(0), 
              feedback: call.feedback,
              status: call.status || 'completed', 
              startTime: call.startTime ? new Date(call.startTime) : (call.timestamp ? new Date(call.timestamp) : new Date(0)),
              endTime: call.endTime ? new Date(call.endTime) : (call.status === 'completed' || call.status === 'failed' ? new Date(call.timestamp || 0) : undefined),
              callType: call.callType || 'unknown_migrated',
              modelUsed: call.modelUsed || 'unknown_migrated',
              error: call.error,
              duration: call.duration
            };
          }
        }
        moxusStructuredMemory.featureSpecificMemory.llmCalls = migratedCalls;
      }
      
      console.log('[MoxusService] Loaded structured memory from localStorage and ensured LLM call structure.');
    }
  } catch (error) {
    console.error('[MoxusService] Error loading memory from localStorage:', error);
    moxusStructuredMemory = createDefaultMemoryStructure();
  }
};

const saveMemory = () => {
  try {
    localStorage.setItem(MOXUS_STRUCTURED_MEMORY_KEY, JSON.stringify(moxusStructuredMemory));
  } catch (error) {
    console.error('[MoxusService] Error saving memory to localStorage:', error);
  }
};

// --- LLM Call Memory Management ---
export const initiateLLMCallRecord = (
  id: string,
  callType: string,
  modelUsed: string,
  promptContent: string,
) => {
  const startTime = new Date();
  const truncatedPrompt = promptContent.length > 5000 ? promptContent.substring(0, 5000) + "... [truncated]" : promptContent;
  const newCall: LLMCall = {
    id,
    prompt: truncatedPrompt,
    timestamp: startTime, 
    status: 'running',
    startTime,
    callType,
    modelUsed,
  };
  moxusStructuredMemory.featureSpecificMemory.llmCalls[id] = newCall;
  saveMemory();
  emitLLMLogUpdate();
  console.log(`[MoxusService] Initiated LLM call: ${id} (${callType}, ${modelUsed}, status: ${newCall.status})`);
};

export const finalizeLLMCallRecord = (id: string, responseContent: string) => {
  const call = moxusStructuredMemory.featureSpecificMemory.llmCalls[id];
  if (!call || call.status !== 'running') {
    console.warn(`[MoxusService] finalizeLLMCallRecord: Call with ID ${id} not found or not in 'running' state.`);
    return;
  }
  const endTime = new Date();
  const truncatedResponse = responseContent.length > 5000 ? responseContent.substring(0, 5000) + "... [truncated]" : responseContent;
  call.response = truncatedResponse;
  call.status = 'completed';
  call.endTime = endTime;
  call.timestamp = endTime; 
  call.duration = endTime.getTime() - call.startTime.getTime();
  // Cleanup old calls (Restored logic)
  const llmCalls = moxusStructuredMemory.featureSpecificMemory.llmCalls;
  const callIds = Object.keys(llmCalls);
  if (callIds.length > 50) {
    const sortedCalls = Object.values(llmCalls).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const callsToDelete = sortedCalls.slice(50);
    callsToDelete.forEach(oldCall => {
      delete llmCalls[oldCall.id];
    });
    console.log(`[MoxusService] Cleaned up ${callsToDelete.length} old LLM calls.`);
  }
  saveMemory();
  emitLLMLogUpdate();
  console.log(`[MoxusService] Finalized LLM call: ${id} (type: ${call.callType}, status: completed, duration: ${call.duration}ms)`);
  
  // Prevent feedback loop: Do not generate feedback tasks for Moxus's own feedback/internal calls.
  const isMoxusInternalProcessingCall = call.callType === 'moxus_feedback_generation' || 
                                      (call.callType && call.callType.startsWith('moxus_feedback_on_'));

  if (!isMoxusInternalProcessingCall) {
    addFeedbackTasksForCall(call);
  } else {
    console.log(`[MoxusService] Skipping feedback task generation for internal/Moxus-feedback call type: ${call.callType}`);
  }
};

const addFeedbackTasksForCall = (call: LLMCall) => {
  if (!call.response) {
    console.warn(`[MoxusService] No response content for call ${call.id}, skipping feedback tasks.`);
    return;
  }
  const promptForTask = call.prompt; 
  const responseForTask = call.response;
  const taskType = (promptForTask.includes('Generate a detailed chapter') || 
                  promptForTask.includes('Generate appropriate dialogue') || 
                  (call.id && call.id.startsWith('chatText-')) ||
                  promptForTask.includes('# TASK:\nYou are the Game Engine of a Node-base game')) 
                  ? 'chatTextFeedback' : 'llmCallFeedback';
  console.log(`[MoxusService] Adding ${taskType} feedback task for completed call ID: ${call.id}, original callType: ${call.callType}`);
  addTask(taskType, {
    id: call.id,
    prompt: promptForTask,
    response: responseForTask,
    callType: call.callType, 
    modelUsed: call.modelUsed 
  });
};

export const failLLMCallRecord = (id: string, errorMessage: string) => {
  const call = moxusStructuredMemory.featureSpecificMemory.llmCalls[id];
  if (!call || (call.status !== 'running' && call.status !== 'queued')) { // Allow failing queued calls too
    console.warn(`[MoxusService] failLLMCallRecord: Call with ID ${id} not found or not in a fail-able state.`);
    return;
  }
  const endTime = new Date();
  call.status = 'failed';
  call.endTime = endTime;
  call.timestamp = endTime; 
  call.error = errorMessage.length > 1000 ? errorMessage.substring(0, 1000) + "..." : errorMessage;
  call.duration = call.startTime ? endTime.getTime() - call.startTime.getTime() : undefined;
  saveMemory();
  emitLLMLogUpdate();
  console.log(`[MoxusService] Failed LLM call: ${id} (status: failed, error: ${call.error})`);
};

export const recordInternalSystemEvent = (
  eventId: string,
  eventPrompt: string, 
  eventResponse: string,
  eventType: string = 'system_event'
) => {
  const now = new Date();
  const truncatedPrompt = eventPrompt.length > 5000 ? eventPrompt.substring(0, 5000) + "..." : eventPrompt;
  const truncatedResponse = eventResponse.length > 5000 ? eventResponse.substring(0, 5000) + "..." : eventResponse;

  const eventCall: LLMCall = {
    id: eventId,
    prompt: truncatedPrompt,
    response: truncatedResponse,
    timestamp: now, // Represents event time
    status: 'completed', // System events are typically completed immediately
    startTime: now,
    endTime: now,
    callType: eventType,
    modelUsed: 'N/A', // Not an LLM call
    duration: 0
  };

  moxusStructuredMemory.featureSpecificMemory.llmCalls[eventId] = eventCall;
  // No need to call saveMemory() or emitLLMLogUpdate() if this is not meant for the logger UI directly,
  // but we DO want Moxus to process it via feedback tasks.
  // However, if we want it in the log UI, we should emit.
  // Let's include it in the UI log for now for visibility.
  saveMemory();
  emitLLMLogUpdate(); 
  
  console.log(`[MoxusService] Recorded internal system event: ${eventId} (${eventType})`);
  
  // Directly trigger feedback task creation for this event
  addFeedbackTasksForCall(eventCall);
};

// (Restored) To get log entries for the UI
export const getLLMLogEntries = (): LLMCall[] => {
  const callsMap = moxusStructuredMemory.featureSpecificMemory.llmCalls;
  return Object.values(callsMap).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
};

export const getLLMCallFeedback = (id: string): string | undefined => {
  return moxusStructuredMemory.featureSpecificMemory.llmCalls[id]?.feedback;
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
const addTask = (type: MoxusTaskType, data: any, chatHistoryContext?: Message[]) => {
  const taskData = { ...data }; // Clone data to avoid modifying the original object

  if (chatHistoryContext) {
    // Store a snapshot of the chat history context if provided
    // This is distinct from any chatHistory that might be within the main `data` object for specific tasks
    taskData.chatHistoryContext = getFormattedChatHistoryStringForMoxus(chatHistoryContext, 10);
  } else if (type === 'finalReport' || type === 'updateGeneralMemory') {
    // For tasks that generate broad reports, ensure a placeholder if no explicit history is passed
    // Other tasks get their specific history via getMemoryUpdatePrompt if their data includes it
    taskData.chatHistoryContext = "(Chat history context not explicitly provided for this report task)";
  }

  const newTask: MoxusTask = {
    id: nextTaskId++,
    type,
    data: taskData, // Use the potentially augmented taskData
    timestamp: new Date(),
  };
  taskQueue.push(newTask);
  console.log(`[MoxusService] Task added: ${type} (ID: ${newTask.id}). Queue size: ${taskQueue.length}`);
  triggerProcessing(); // Attempt to process immediately (will be debounced)
};

// Function to trigger queue processing if not already running (debounced)
const triggerProcessing = () => {
  if (processingTimeoutId) {
    clearTimeout(processingTimeoutId);
  }
  processingTimeoutId = setTimeout(() => {
    processingTimeoutId = null; // Clear the ID once the timeout has fired
    // console.log("[MoxusService] Triggering queue processing via timeout."); // Can be verbose
    processQueue();
  }, 50); // Small delay to batch up quick additions or allow current event loop to clear
};

// Modified prompt template for memory updating tasks
const getMemoryUpdatePrompt = (task: MoxusTask, existingMemory: string): string => {
  const assistantNodesContent = getAssistantNodesContent();
  
  let safeTaskData: any;
  let formattedChatHistory = "(Chat history not applicable for this task type or not available)"; // Default

  if (task.type === 'nodeUpdateFeedback' || task.type === 'storyFeedback') {
    const { nodes, chatHistory, ...otherData } = task.data || {};
    
    if (chatHistory) {
      // Use the new helper to get formatted chat history for the last 10 turns
      formattedChatHistory = getFormattedChatHistoryStringForMoxus(chatHistory, 10);
    }

    safeTaskData = {
      ...otherData,
      nodesCount: nodes?.length || 0,
      nodeTypes: nodes ? Array.from(new Set(nodes.map((n: any) => n.type))).join(', ') : '',
      nodeNames: nodes ? nodes.slice(0, 5).map((n: any) => n.name).join(', ') + (nodes.length > 5 ? '...' : '') : ''
      // Removed chatHistoryLength as we now include the actual history string
    };
  } else {
    // Deep clone task.data to avoid modifying the original object
    safeTaskData = JSON.parse(JSON.stringify(task.data)); // Simple deep clone

    const MAX_FIELD_LENGTH = 5000; // Max length for individual string fields like descriptions/rules

    const truncateField = (obj: any, fieldName: string) => {
      if (obj && typeof obj[fieldName] === 'string' && obj[fieldName].length > MAX_FIELD_LENGTH) {
        obj[fieldName] = obj[fieldName].substring(0, MAX_FIELD_LENGTH) + "... [truncated]";
      }
    };

    // For nodeEditFeedback, task.data contains 'before' and 'after' nodes
    if (safeTaskData && safeTaskData.before) {
      truncateField(safeTaskData.before, 'longDescription');
      truncateField(safeTaskData.before, 'rules');
      // Add other potentially long string fields from the Node model if necessary
    }
    if (safeTaskData && safeTaskData.after) {
      truncateField(safeTaskData.after, 'longDescription');
      truncateField(safeTaskData.after, 'rules');
      // Add other potentially long string fields from the Node model if necessary
    }
    
    // Fallback for other task types if their data is a large string itself
    // This part is less likely to be an issue now but kept for safety,
    // though the main problem was with nested long strings in objects.
    const stringifiedData = JSON.stringify(safeTaskData);
    if (stringifiedData.length > 5000 && typeof task.data === 'string') {
        // This case handles if task.data itself was a massive string that needs truncation.
        // The JSON.parse error was from the object case, but this is a safeguard.
        safeTaskData = task.data.substring(0, 4950) + "... [task.data string truncated]";
    }
  }
  
  return `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You monitor the story, provide guidance, and maintain consistency and quality in the game world.
  Your goal is to maintain a brief record of critical observations that will highlight problems in the game.
  
  ${assistantNodesContent ? `Additional features:
  ---
  ${assistantNodesContent}
  ---` : ""}
  
  # CHAT HISTORY CONTEXT (Last 10 turns)
  ${formattedChatHistory}
  
  # CURRENT MEMORY DOCUMENT
  Below is your current memory document. You should update this document focusing on criticism:
  
  ${existingMemory}
  
  # NEW INFORMATION
  Task Type: ${task.type}
  Data:
  \`\`\`json
  ${JSON.stringify(safeTaskData, null, 2)}
  \`\`\`
  
  # INSTRUCTIONS
  1. Analyze the new information (including Chat History Context if provided) focusing ONLY on problems and issues.
  2. Update the memory document.
  3. Focus exclusively on criticism and improvement areas, not what works well.
  4. Use bullet points for critical observations.
  5. Only include observations that highlight problems or inconsistencies.
  6. The memory document should identify specific issues requiring attention.
  7. Keep any section about your own personality detailled and rich.
  8. The entire document should be critical in nature.

  Return the complete updated memory document.`;
};

// Asynchronous function to process the queue
const processQueue = async () => {
  // console.log(`[MoxusService] processQueue. Queue: ${taskQueue.map(t=>t.type)}. ActiveSF: ${!!activeStoryFeedback}, ActiveNUF: ${!!activeNodeUpdateFeedback}`);

  // Highest priority: Final Report if its conditions are met
  if (!activeStoryFeedback && !activeNodeUpdateFeedback && taskQueue[0]?.type === 'finalReport') {
    const task = taskQueue.shift()!;
    console.log(`[MoxusService] Processing task: ${task.type} (ID: ${task.id})`);
    try {
      await handleFinalReport(task); // Await as it's a concluding step for a sequence
      console.log(`[MoxusService] Completed task: ${task.type} (ID: ${task.id})`);
    } catch (error) {
      console.error(`[MoxusService] Error processing task ${task.id} (${task.type}):`, error);
    } finally {
      // After finalReport, trigger again to see if other, unrelated tasks are pending.
      if (taskQueue.length > 0) {
        triggerProcessing();
      } else {
        console.log('[MoxusService] Queue empty after finalReport. Processor idle.');
      }
      return; // Exclusive processing for finalReport when its turn comes.
    }
  }

  let didLaunchOrProcessTaskThisCycle = false;

  // Attempt to launch storyFeedback
  if (!activeStoryFeedback && taskQueue[0]?.type === 'storyFeedback') {
    const task = taskQueue.shift()!;
    console.log(`[MoxusService] Launching task: ${task.type} (ID: ${task.id})`);
    didLaunchOrProcessTaskThisCycle = true;
    activeStoryFeedback = handleMemoryUpdate(task)
      .catch(err => console.error(`[MoxusService] Error in ${task.type} (ID: ${task.id}):`, err))
      .finally(() => {
        console.log(`[MoxusService] Completed task: ${task.type} (ID: ${task.id})`);
        activeStoryFeedback = null;
        triggerProcessing(); // Check queue again for follow-ups or other tasks
      });
  }

  // Attempt to launch nodeUpdateFeedback (can run with storyFeedback or alone)
  // Must check queue again because storyFeedback might have been shifted by the block above
  if (!activeNodeUpdateFeedback && taskQueue[0]?.type === 'nodeUpdateFeedback') {
    const task = taskQueue.shift()!;
    console.log(`[MoxusService] Launching task: ${task.type} (ID: ${task.id})`);
    didLaunchOrProcessTaskThisCycle = true;
    activeNodeUpdateFeedback = handleMemoryUpdate(task)
      .catch(err => console.error(`[MoxusService] Error in ${task.type} (ID: ${task.id}):`, err))
      .finally(() => {
        console.log(`[MoxusService] Completed task: ${task.type} (ID: ${task.id})`);
        activeNodeUpdateFeedback = null;
        triggerProcessing(); // Check queue again
      });
  }

  // If no feedback tasks are active, and none were launched this cycle, and the queue has other items:
  // This handles tasks that are not 'storyFeedback', 'nodeUpdateFeedback', or 'finalReport'.
  if (!activeStoryFeedback && !activeNodeUpdateFeedback && !didLaunchOrProcessTaskThisCycle && taskQueue.length > 0) {
    const otherTask = taskQueue.shift()!; // Should not be feedback/finalReport due to checks above
    console.log(`[MoxusService] Processing other task: ${otherTask.type} (ID: ${otherTask.id}) sequentially`);
    didLaunchOrProcessTaskThisCycle = true;
    try {
      // Assuming 'other' tasks are also handled by handleMemoryUpdate or a similar async function.
      // If 'other' tasks need different handlers, a switch/case would be needed here.
      await handleMemoryUpdate(otherTask); 
      console.log(`[MoxusService] Completed other task: ${otherTask.type} (ID: ${otherTask.id})`);
    } catch (error) {
      console.error(`[MoxusService] Error processing other task ${otherTask.id} (${otherTask.type}):`, error);
    } finally {
      if (taskQueue.length > 0) {
        triggerProcessing();
      } else {
        console.log('[MoxusService] Queue empty after other task. Processor idle.');
      }
    }
  } else if (didLaunchOrProcessTaskThisCycle && taskQueue.length > 0) {
    // If a feedback task was launched (or another task processed), and there are still items in the queue,
    // ensure processing is triggered to check them.
    // The .finally() blocks of async tasks also call triggerProcessing, this is an additional safeguard/optimization.
    triggerProcessing();
  } else if (!activeStoryFeedback && !activeNodeUpdateFeedback && taskQueue.length === 0 && !didLaunchOrProcessTaskThisCycle) {
     // This condition means: no feedback tasks are running, queue is empty, and nothing was processed/launched in this cycle.
     console.log('[MoxusService] Queue empty and no active tasks. Processor idle.');
  }
};

// Handle final report generation
const handleFinalReport = async (task: MoxusTask) => {
  const assistantNodesContent = getAssistantNodesContent();
  const chatHistoryContextString = task.data?.chatHistoryContext || "(Chat history context not available for this report)";

  const promptContent = `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You monitor the story, provide guidance, and maintain consistency and quality in the game world.
  
  Generate a brief, concise, and straight-to-the-point critical analysis based on your accumulated memory documents and the recent chat context below.
  
  ${assistantNodesContent ? `Additional features:
  ---
  ${assistantNodesContent}
  ---` : ""}

  # CHAT HISTORY CONTEXT (Last 10 turns, if available)
  ${chatHistoryContextString}
  
  # GENERAL MEMORY
  ${moxusStructuredMemory.GeneralMemory || '(No general memory available)'}
  
  # CHAT TEXT ANALYSIS
  ${moxusStructuredMemory.featureSpecificMemory.chatText || '(No chat text analysis available)'}
  
  # NODE EDITIONS ANALYSIS
  ${moxusStructuredMemory.featureSpecificMemory.nodeEdition || '(No node edition analysis available)'}
  
  # INSTRUCTIONS
  Create a brief, concise, and straight-to-the-point critical report focusing ONLY on problems and issues.
  The entire report must be one paragraphs maximum to plan the guide the next "Narrative AI's" message.
  Use minimal markdown formatting.
  
  Focus exclusively on:
  - Critical issues with story consistency or narrative quality
  - Significant problems with world building or coherence
  - Major character development issues
  - Serious gameplay mechanic flaws
  
  Be direct, concise, and straight to the point. Focus only on problems requiring attention, not what works well.
  This will be displayed to the user as a Moxus critical analysis report.`;

  console.log(`[MoxusService] Generating final report using all memory sources...`);
  if (!getMoxusFeedbackImpl) {
    throw new Error('getMoxusFeedback implementation not set. Make sure to call setMoxusFeedbackImpl first.');
  }
  
  const report = await getMoxusFeedbackImpl(promptContent, 'final_report_generation');
  console.log(`[MoxusService] Final report generated. Sending to chat.`);
  
  // Send the report to chat interface
  addMessageCallback({ 
    role: 'moxus',
    content: `**Moxus Report:**\n\n${formatMoxusReport(report)}` 
  });
  
  // Automatically update GeneralMemory after sending the report
  console.log('[MoxusService] Automatically updating GeneralMemory after report generation');
  setTimeout(() => {
    // Use setTimeout to ensure the report is shown in chat first
    updateGeneralMemoryFromAllSources(task.type);
  }, 1000);
};

// Handle memory updates for different task types
const handleMemoryUpdate = async (task: MoxusTask) => {
  // Refactored logic for clarity and to prevent unintended GeneralMemory updates

  if (task.type === 'llmCallFeedback' || task.type === 'chatTextFeedback') {
    if (task.data && task.data.id) {
      const callId = task.data.id;
      const originalCallTypeForFeedback = task.data.callType;

      // Ensure call exists for feedback processing (reconstruction if necessary)
      if (!moxusStructuredMemory.featureSpecificMemory.llmCalls[callId]) {
        console.warn(`[MoxusService] LLM call ${callId} not found for feedback. Reconstructing.`);
        const now = new Date();
        moxusStructuredMemory.featureSpecificMemory.llmCalls[callId] = {
          id: callId, prompt: task.data.prompt || "[prompt unavailable]",
          response: task.data.response || "[response unavailable]", timestamp: now,
          status: 'completed', startTime: new Date(task.data.timestamp || now), endTime: now,
          callType: originalCallTypeForFeedback || 'unknown_reconstructed', 
          modelUsed: task.data.modelUsed || 'unknown_reconstructed',
        };
      }

      // 1. Generate and store specific feedback for the call
      const assistantNodesContent = getAssistantNodesContent();
      const feedbackPrompt = `\n      # Task\n      You have to analyze an LLM call.\n\n      ${assistantNodesContent ? `## Additional features:\n      ---\n      ${assistantNodesContent}\n      ---` : ""}\n      \n      ## PROMPT:\n      ---start of prompt---\n      ${task.data.prompt}\n      ---end of prompt---\n      \n      ## RESPONSE:\n      ---start of response---\n      ${task.data.response}\n      ---end of response---\n      \n      Provide critical feedback focusing ONLY on problems with this response.\n      Focus exclusively on what could be improved, not what went well.\n      Identify specific issues with quality, relevance, coherence, or accuracy.`;
      
      if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set.');
      const feedback = await getMoxusFeedbackImpl(feedbackPrompt, originalCallTypeForFeedback);
      const truncatedFeedback = feedback.length > 2000 ? feedback.substring(0, 2000) + "... [truncated]" : feedback;
      
      if (moxusStructuredMemory.featureSpecificMemory.llmCalls[callId]) {
         moxusStructuredMemory.featureSpecificMemory.llmCalls[callId].feedback = truncatedFeedback;
         saveMemory(); // Save after updating feedback
         emitLLMLogUpdate(); // Update UI after feedback is stored
      }

      // 2. Check if a separate 'updateGeneralMemory' task needs to be scheduled
      const processedFeedbacks = Object.values(moxusStructuredMemory.featureSpecificMemory.llmCalls).filter(c => c.feedback).length;
      const FEEDBACK_THRESHOLD_FOR_GENERAL_MEMORY_UPDATE = 5;
      const systemEventCallTypes = ['chat_reset_event', 'assistant_message_edit_event'];
      
      if (!systemEventCallTypes.includes(task.data.callType)) {
        if (processedFeedbacks > 0 && processedFeedbacks % FEEDBACK_THRESHOLD_FOR_GENERAL_MEMORY_UPDATE === 0) {
          console.log(`[MoxusService] Scheduling GeneralMemory update. Processed feedbacks: ${processedFeedbacks}. Triggered by feedback for call: ${callId} (type: ${task.data.callType})`);
          addTask('updateGeneralMemory', { reason: `periodic_update_after_${processedFeedbacks}_feedbacks`, triggeringCallId: callId, triggeringCallType: task.data.callType });
        }
      } else {
        console.log(`[MoxusService] Feedback for system event ${task.data.callType} (ID: ${callId}) will not trigger periodic GeneralMemory update.`);
      }

      // 3. If this task was specifically 'chatTextFeedback', it also updates the 'chatText' memory document.
      if (task.type === 'chatTextFeedback') {
        console.log(`[MoxusService] Task ${task.id} (${task.type}) is updating chatText memory document.`);
        const chatTextMemoryToUpdate = moxusStructuredMemory.featureSpecificMemory.chatText;
        const chatTextUpdatePrompt = getMemoryUpdatePrompt(task, chatTextMemoryToUpdate);
        const updatedChatTextMemory = await getMoxusFeedbackImpl(chatTextUpdatePrompt, task.type);
        moxusStructuredMemory.featureSpecificMemory.chatText = updatedChatTextMemory;
        console.log(`[MoxusService] Updated chatText memory document via task ${task.id}.`);
        saveMemory();
      }
    }
    // This type of task (llmCallFeedback or chatTextFeedback) is now considered fully handled.
    return;
  } 
  
  // Handle other task types not covered above
  let memoryToUpdate = '';
  let memoryKey: keyof MoxusMemoryStructure['featureSpecificMemory'] | 'GeneralMemory' = 'GeneralMemory';
  let originalCallTypeForGenericUpdate: string = task.type; // Default to the current task's type, now explicitly string

  switch (task.type) {
    case 'nodeEditFeedback':
      memoryKey = 'nodeEdit';
      memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.nodeEdit;
      break;
    case 'storyFeedback':
      memoryKey = 'nodeEdition';
      memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.nodeEdition;
      break;
    case 'nodeUpdateFeedback':
      memoryKey = 'nodeEdition';
      memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.nodeEdition;
      if (task.data && task.data.nodes) {
        task.data.nodes = sanitizeNodesForMoxus(task.data.nodes);
      }
      break;
    case 'assistantFeedback':
      memoryKey = 'assistantFeedback';
      memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.assistantFeedback;
      break;
    case 'updateGeneralMemory':
      console.log(`[MoxusService] Task ${task.id} (${task.type}) is calling updateGeneralMemoryFromAllSources.`);
      await updateGeneralMemoryFromAllSources(task.type);
      return;
    default:
      console.warn(`[MoxusService] Task ${task.id} of unhandled type '${task.type}' falling through to update GeneralMemory.`);
      memoryKey = 'GeneralMemory';
      memoryToUpdate = moxusStructuredMemory.GeneralMemory;
      originalCallTypeForGenericUpdate = 'general_memory_default_update'; // Be specific for this case
  }
  
  if (memoryToUpdate !== undefined && memoryToUpdate !== '') { 
    console.log(`[MoxusService] Task ${task.id} (${task.type}) is updating ${memoryKey} memory document.`);
    const updatePrompt = getMemoryUpdatePrompt(task, memoryToUpdate); 
    if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set for general update path.');
    const updatedMemory = await getMoxusFeedbackImpl(updatePrompt, originalCallTypeForGenericUpdate); 
    
    if (memoryKey === 'GeneralMemory') {
      moxusStructuredMemory.GeneralMemory = updatedMemory;
    } else if (memoryKey && moxusStructuredMemory.featureSpecificMemory[memoryKey as keyof typeof moxusStructuredMemory.featureSpecificMemory]) {
      (moxusStructuredMemory.featureSpecificMemory as any)[memoryKey] = updatedMemory;
    }
    console.log(`[MoxusService] Updated ${memoryKey} memory document via task ${task.id}.`);
    saveMemory();
  } else {
    console.log(`[MoxusService] Task ${task.id} (${task.type}) did not result in a memory update via the final block (memoryToUpdate was empty or undefined).`);
  }
};

// New function to update GeneralMemory from all memory sources
const updateGeneralMemoryFromAllSources = async (originalCallTypeForThisUpdate: string = 'scheduled_general_memory_update') => {
  console.log(`[MoxusService] Attempting to update GeneralMemory from all available memory sources. Trigger reason/type: ${originalCallTypeForThisUpdate}`);
  
  // Get assistant node content for context
  const assistantNodesContent = getAssistantNodesContent();
  
  // Get up to 5 recent LLM call feedbacks
  const recentFeedbacks = Object.entries(moxusStructuredMemory.featureSpecificMemory.llmCalls)
    .sort((a, b) => {
      const dateA = new Date(a[1].timestamp).getTime();
      const dateB = new Date(b[1].timestamp).getTime();
      return dateB - dateA; // Sort descending (newest first)
    })
    .slice(0, 5)
    .map(([id, call]) => ({
      id,
      // Don't include prompt content in the general memory update
      feedback: call.feedback || "No feedback available"
    }));
  
  // Truncate memory sections to avoid token limit issues
  const truncateText = (text: string, maxLength: number = 2000) => {
    return text && text.length > maxLength ? text.substring(0, maxLength) + "... [truncated]" : text;
  };
  
  // Limit the size of each memory section
  const generalMemory = truncateText(moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL);
  const chatTextMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.chatText);
  const nodeEditionMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.nodeEdition);
  const assistantFeedbackMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.assistantFeedback);
  const nodeEditMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.nodeEdit);
  
  // Create a comprehensive prompt that includes all memory sources
  const updatePrompt = `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You are tasked with updating your GeneralMemory document by integrating insights from all memory sources.
  
  Assistant Personality:
  ---
  ${truncateText(assistantNodesContent, 1000)}
  ---
  
  # CURRENT GENERAL MEMORY DOCUMENT
  ${generalMemory}
  
  # ALL MEMORY SOURCES TO INTEGRATE

  ## CHAT TEXT ANALYSIS
  ${chatTextMemory || '(No chat text analysis available)'}
  
  ## NODE EDITIONS ANALYSIS
  ${nodeEditionMemory || '(No node edition analysis available)'}
  
  ## ASSISTANT FEEDBACK ANALYSIS
  ${assistantFeedbackMemory || '(No assistant feedback analysis available)'}
  
  ## NODE EDIT ANALYSIS
  ${nodeEditMemory || '(No node edit analysis available)'}
  
  ## RECENT LLM CALL FEEDBACKS
  ${JSON.stringify(recentFeedbacks, null, 2)}
  
  # INSTRUCTIONS
  1. Create an updated GeneralMemory document that synthesizes the most critical issues from ALL memory sources
  2. Keep each section short - use bullet points.
  3. Focus exclusively on problems, issues, and areas for improvement - NOT what works well
  4. Use bullet points for each critical observation
  5. Only include observations that highlight problems or inconsistencies in the game world
  6. Keep any section about your own personality brief
  7. The entire document should be focused on critique
  
  Return ONLY the complete updated GeneralMemory document.`;
  
  if (!getMoxusFeedbackImpl) {
    throw new Error('getMoxusFeedback implementation not set.');
  }
  
  // Get the updated GeneralMemory
  const updatedGeneralMemory = await getMoxusFeedbackImpl(updatePrompt, originalCallTypeForThisUpdate);
  
  // Truncate the result to prevent memory growth
  const truncatedGeneralMemory = truncateText(updatedGeneralMemory, 5000);
  
  // Update the GeneralMemory
  moxusStructuredMemory.GeneralMemory = truncatedGeneralMemory;
  console.log('[MoxusService] Updated GeneralMemory from all memory sources');
  saveMemory();
};

// Function to get assistant node content
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

export const getMoxusPersonalityContext = (): string => {
  return getAssistantNodesContent();
};

// Generate YAML representation of memory for inclusion in prompts
export const getLLMCallsMemoryYAML = (): string => {
  try {
    // Format according to requested structure - include all memory sections in YAML
    const memoryForYaml = {
      GeneralMemory: moxusStructuredMemory.GeneralMemory,
      featureSpecificMemory: {
        nodeEdition: moxusStructuredMemory.featureSpecificMemory.nodeEdition,
        chatText: moxusStructuredMemory.featureSpecificMemory.chatText,
        assistantFeedback: moxusStructuredMemory.featureSpecificMemory.assistantFeedback,
        nodeEdit: moxusStructuredMemory.featureSpecificMemory.nodeEdit,
      },
      // Include recent LLM call feedback (max 5)
      recentLLMFeedback: Object.entries(moxusStructuredMemory.featureSpecificMemory.llmCalls)
        .sort((a, b) => {
          const dateA = new Date(a[1].timestamp).getTime();
          const dateB = new Date(b[1].timestamp).getTime();
          return dateB - dateA; // Sort descending (newest first)
        })
        .slice(0, 5) // Take only the 5 most recent
        .map(([id, call]) => ({
          id,
          feedback: call.feedback || "No feedback available"
        }))
    };
    
    return yaml.dump(memoryForYaml, {
      lineWidth: 100,
      noRefs: true,
      quotingType: '"'
    });
  } catch (error) {
    console.error('[MoxusService] Error generating YAML:', error);
    return "Error generating memory YAML";
  }
};

// Helper function to format Moxus report for better readability
const formatMoxusReport = (text: string): string => {
  // Break the text into sections if it contains headings
  const sections = text.split(/(?=#+\s+)/);
  
  if (sections.length > 1) {
    // The text contains markdown headings, add proper spacing and formatting
    return sections.map(section => section.trim()).join('\n\n');
  }
  
  // If no headings, try to break by paragraphs and add bullet points where appropriate
  const paragraphs = text.split(/\n+/);
  if (paragraphs.length > 1) {
    return paragraphs
      .map(para => {
        // If the paragraph looks like a list item but doesn't have a marker, add one
        if (para.trim().match(/^[A-Z]/) && para.length < 100 && !para.startsWith('-') && !para.startsWith('*')) {
          return `- ${para.trim()}`;
        }
        return para.trim();
      })
      .join('\n\n');
  }
  
  // Just return the original text if no clear structure is detected
  return text;
};

export const clearLLMLogEntries = (): void => {
  moxusStructuredMemory.featureSpecificMemory.llmCalls = {};
  saveMemory();
  emitLLMLogUpdate();
  console.log('[MoxusService] LLM log entries cleared.');
};

// Export the service functions
export const moxusService = {
  initialize,
  addTask,
  initiateLLMCallRecord,
  finalizeLLMCallRecord,
  failLLMCallRecord,
  recordInternalSystemEvent,
  getLLMLogEntries,
  subscribeToLLMLogUpdates,
  clearLLMLogEntries,
  getLLMCallFeedback,
  getLLMCallsMemoryYAML,
  // Get the number of pending tasks in the queue
  getPendingTaskCount: () => taskQueue.length,
  // Reset Moxus memory to initial state
  resetMemory: () => {
    moxusStructuredMemory = createDefaultMemoryStructure();
    taskQueue = [];
    nextTaskId = 1;
    
    // Clear localStorage for Moxus memory
    localStorage.removeItem(MOXUS_STRUCTURED_MEMORY_KEY);
    
    console.log('[MoxusService] Memory reset to initial state');
  },
  // Get the complete Moxus memory structure for export
  getMoxusMemory: () => {
    return moxusStructuredMemory;
  },
  // Set the Moxus memory from an imported structure
  setMoxusMemory: (importedMemory: MoxusMemoryStructure) => {
    if (!importedMemory) {
      console.error('[MoxusService] Cannot import undefined or null memory structure');
      return;
    }
    
    try {
      // Ensure the structure is valid by using the default structure creator and overriding with imported values
      moxusStructuredMemory = {
        GeneralMemory: importedMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL,
        featureSpecificMemory: {
          nodeEdition: importedMemory.featureSpecificMemory?.nodeEdition || DEFAULT_MEMORY.NODE_EDITION,
          chatText: importedMemory.featureSpecificMemory?.chatText || DEFAULT_MEMORY.CHAT_TEXT,
          assistantFeedback: importedMemory.featureSpecificMemory?.assistantFeedback || DEFAULT_MEMORY.ASSISTANT_FEEDBACK,
          nodeEdit: importedMemory.featureSpecificMemory?.nodeEdit || DEFAULT_MEMORY.NODE_EDIT,
          llmCalls: importedMemory.featureSpecificMemory?.llmCalls || {}
        }
      };
      
      // Save to localStorage
      saveMemory();
      console.log('[MoxusService] Memory imported successfully');
    } catch (error) {
      console.error('[MoxusService] Error importing memory:', error);
    }
  },
  // For testing purposes
  debugLogMemory: () => {
    console.log('Structured Memory:', moxusStructuredMemory);
    console.log('YAML representation:', getLLMCallsMemoryYAML());
  },
  getMoxusPersonalityContext
}; 