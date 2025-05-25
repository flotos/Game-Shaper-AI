import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import { getChatHistoryForMoxus, loadedPrompts, formatPrompt } from './llmCore';
import { safeJsonParse } from '../utils/jsonUtils';

// Avoid circular dependency by forward declaring the function type
type GetMoxusFeedbackFn = (promptContent: string, originalCallType?: string) => Promise<string>;
let getMoxusFeedbackImpl: GetMoxusFeedbackFn | null = null;
const TRUNCATE_LENGTH = parseInt(import.meta.env.VITE_TRUNCATE_TEXT || '5000', 10);

// This function will be called to set the actual implementation after LLMService is initialized
export const setMoxusFeedbackImpl = (impl: GetMoxusFeedbackFn) => {
  getMoxusFeedbackImpl = impl;
};

// Define Task Types
type MoxusTaskType = 
  | 'assistantFeedback' 
  | 'finalReport'
  | 'llmCallFeedback'
  | 'chatTextFeedback'
  | 'synthesizeGeneralMemory'
  | 'manualNodeEditAnalysis';

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
  chatHistory?: Message[];
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
  };
  cachedGuidance?: {
    chatTextGuidance?: string;
    nodeEditionGuidance?: string;
    assistantGuidance?: string;
  };
  pendingConsciousnessEvolution?: string[];
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
  },
  cachedGuidance: {},
  pendingConsciousnessEvolution: []
});

// Storage key
const MOXUS_STRUCTURED_MEMORY_KEY = 'moxusStructuredMemory';

// Memory update mutex to prevent race conditions
let memoryUpdateMutex = Promise.resolve();

// Initialize memory structure
let moxusStructuredMemory = createDefaultMemoryStructure();
let taskQueue: MoxusTask[] = [];
let nextTaskId = 1;
let getNodesCallback: () => Node[] = () => [];
let addMessageCallback: (message: Message) => void = () => {};
let getChatHistoryCallback: () => Message[] = () => [];

// State for active feedback tasks
let activeChatTextFeedback: Promise<void> | null = null; 
let activeLLMNodeEditionYamlFeedback: Promise<void> | null = null;
let activeFinalReport: Promise<void> | null = null; 
let processingTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Flags for final report trigger
let hasNodeEditionFeedbackCompletedForReport = false;
let hasChatTextFeedbackCompletedForReport = false;

let isInitialized = false;

// --- Listener Pattern for UI Updates ---
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

// Function to sanitize nodes for Moxus feedback
const sanitizeNodesForMoxus = (nodes: Node[]): any[] => {
  if (!nodes || !Array.isArray(nodes)) return [];
  return nodes.map(node => {
    const { image, ...sanitizedNode } = node;
    return sanitizedNode;
  });
};

const getFormattedChatHistoryStringForMoxus = (chatHistory: Message[], numTurns: number): string => {
  if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) {
    return "(No chat history available)";
  }
  const relevantHistory = getChatHistoryForMoxus(chatHistory, numTurns);
  if (relevantHistory.length === 0) {
    return "(No relevant chat history for the last " + numTurns + " turns)";
  }
  return relevantHistory.map(msg => `${msg.role}: ${msg.content}`).join('\\n');
};

// --- Memory Management ---
const loadMemory = () => {
  try {
    const savedStructuredMemory = localStorage.getItem(MOXUS_STRUCTURED_MEMORY_KEY);
    if (savedStructuredMemory) {
      const parsedMemory = JSON.parse(savedStructuredMemory);
      moxusStructuredMemory = {
        GeneralMemory: parsedMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL,
        featureSpecificMemory: {
          nodeEdition: parsedMemory.featureSpecificMemory?.nodeEdition || DEFAULT_MEMORY.NODE_EDITION,
          chatText: parsedMemory.featureSpecificMemory?.chatText || DEFAULT_MEMORY.CHAT_TEXT,
          assistantFeedback: parsedMemory.featureSpecificMemory?.assistantFeedback || DEFAULT_MEMORY.ASSISTANT_FEEDBACK,
          nodeEdit: parsedMemory.featureSpecificMemory?.nodeEdit || DEFAULT_MEMORY.NODE_EDIT,
          llmCalls: parsedMemory.featureSpecificMemory?.llmCalls || {}
        },
        cachedGuidance: parsedMemory.cachedGuidance || {},
        pendingConsciousnessEvolution: parsedMemory.pendingConsciousnessEvolution || []
      };
      if (moxusStructuredMemory.featureSpecificMemory.llmCalls) {
        const migratedCalls: LLMCallsMemoryMap = {};
        for (const key in moxusStructuredMemory.featureSpecificMemory.llmCalls) {
          if (Object.prototype.hasOwnProperty.call(moxusStructuredMemory.featureSpecificMemory.llmCalls, key)) {
            const call = moxusStructuredMemory.featureSpecificMemory.llmCalls[key] as any;
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
              duration: call.duration,
              chatHistory: call.chatHistory
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
export const initiateLLMCallRecord = (id: string, callType: string, modelUsed: string, promptContent: string) => {
  const startTime = new Date();
  const truncatedPrompt = promptContent.length > TRUNCATE_LENGTH ? promptContent.substring(0, TRUNCATE_LENGTH) + "... [truncated]" : promptContent;
  const newCall: LLMCall = { id, prompt: truncatedPrompt, timestamp: startTime, status: 'running', startTime, callType, modelUsed };
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
  const truncatedResponse = responseContent.length > TRUNCATE_LENGTH ? responseContent.substring(0, TRUNCATE_LENGTH) + "... [truncated]" : responseContent;
  call.response = truncatedResponse;
  call.status = 'completed';
  call.endTime = endTime;
  call.timestamp = endTime; 
  call.duration = endTime.getTime() - call.startTime.getTime();
  const llmCalls = moxusStructuredMemory.featureSpecificMemory.llmCalls;
  const callIds = Object.keys(llmCalls);
  if (callIds.length > 50) {
    const sortedCalls = Object.values(llmCalls).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const callsToDelete = sortedCalls.slice(50);
    callsToDelete.forEach(oldCall => { delete llmCalls[oldCall.id]; });
    console.log(`[MoxusService] Cleaned up ${callsToDelete.length} old LLM calls.`);
  }
  saveMemory();
  emitLLMLogUpdate();
  console.log(`[MoxusService] Finalized LLM call: ${id} (type: ${call.callType}, status: completed, duration: ${call.duration}ms)`);
  
  const trimmedCallType = call.callType?.trim();
  const isMoxusInternalProcessingCall = 
    trimmedCallType === 'moxus_feedback' ||
    trimmedCallType === 'moxus_feedback_generation' || 
    trimmedCallType === 'moxus_finalreport' || 
    trimmedCallType === 'INTERNAL_FINAL_REPORT_GENERATION_STEP' || 
    (trimmedCallType && trimmedCallType.startsWith('moxus_feedback_on_')) || 
    (trimmedCallType && trimmedCallType.startsWith('moxus_specialized_')) ||
    (trimmedCallType && trimmedCallType.startsWith('INTERNAL_MEMORY_UPDATE_FOR_')) ||
    (trimmedCallType && trimmedCallType.startsWith('moxus_update_') && trimmedCallType.endsWith('_memory')) ||
    trimmedCallType === 'story_refocus_event' ||
    trimmedCallType === 'chat_reset_event' ||
    trimmedCallType === 'assistant_message_edit_event' ||
    trimmedCallType === 'chat_regenerate_event' ||
    trimmedCallType === 'chat_input_regenerate_event' ||
    trimmedCallType === 'refocus_story_generation';
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
  const taskType = (
    call.callType === 'chat_text_generation' ||
    promptForTask.includes('Generate a detailed chapter') || 
    promptForTask.includes('Generate appropriate dialogue') || 
    (call.id && call.id.startsWith('chatText-')) || 
    promptForTask.includes('# TASK:\nYou are the Game Engine of a Node-base game')
  ) ? 'chatTextFeedback' : 'llmCallFeedback';
  console.log(`[MoxusService] Adding ${taskType} feedback task for completed call ID: ${call.id}, original callType: ${call.callType}`);
  const taskData = {
    id: call.id,
    prompt: promptForTask,
    response: responseForTask,
    callType: call.callType,
    modelUsed: call.modelUsed,
    chatHistory: call.chatHistory
  };
  addTask(taskType, taskData);
};

export const failLLMCallRecord = (id: string, errorMessage: string) => {
  const call = moxusStructuredMemory.featureSpecificMemory.llmCalls[id];
  if (!call || (call.status !== 'running' && call.status !== 'queued')) {
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

export const recordInternalSystemEvent = (eventId: string, eventPrompt: string, eventResponse: string, eventType: string = 'system_event', eventContextData?: { previousChatHistory?: Message[] }) => {
  const now = new Date();
  const truncatedPrompt = eventPrompt.length > TRUNCATE_LENGTH ? eventPrompt.substring(0, TRUNCATE_LENGTH) + "..." : eventPrompt;
  const truncatedResponse = eventResponse.length > TRUNCATE_LENGTH ? eventResponse.substring(0, TRUNCATE_LENGTH) + "..." : eventResponse;
  
  const eventCallForLog: LLMCall = { id: eventId, prompt: truncatedPrompt, response: truncatedResponse, timestamp: now, status: 'completed', startTime: now, endTime: now, callType: eventType, modelUsed: 'N/A', duration: 0 };
  moxusStructuredMemory.featureSpecificMemory.llmCalls[eventId] = eventCallForLog;
  saveMemory();
  emitLLMLogUpdate(); 
  console.log(`[MoxusService] Recorded internal system event: ${eventId} (${eventType})`);

  // Check if this is a system event that should not generate feedback tasks
  const isSystemEventThatSkipsFeedback = 
    eventType === 'story_refocus_event' ||
    eventType === 'chat_reset_event' ||
    eventType === 'assistant_message_edit_event' ||
    eventType === 'chat_regenerate_event' ||
    eventType === 'chat_input_regenerate_event';

  if (eventType === "chat_reset_event" && eventContextData?.previousChatHistory) {
    console.log(`[MoxusService] Chat reset event detected. Queueing updateGeneralMemory task with previous chat history.`);
    const previousChatHistoryString = getFormattedChatHistoryStringForMoxus(eventContextData.previousChatHistory, 20); // Use more turns for this analysis
    addTask('synthesizeGeneralMemory', { 
      reason: "chat_reset_event", 
      eventDetails: { 
        id: eventId, 
        prompt: truncatedPrompt, // The system event prompt
        response: truncatedResponse // The system event response ("Chat history has been cleared.")
      }, 
      previousChatHistoryString 
    });
  } else if (!isSystemEventThatSkipsFeedback) {
    // Only generate feedback tasks for non-system events
    addFeedbackTasksForCall(eventCallForLog);
  } else {
    console.log(`[MoxusService] Skipping feedback task generation for system event type: ${eventType}`);
  }
};

export const getLLMLogEntries = (): LLMCall[] => {
  const callsMap = moxusStructuredMemory.featureSpecificMemory.llmCalls;
  return Object.values(callsMap).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
};

export const getLLMCallFeedback = (id: string): string | undefined => {
  return moxusStructuredMemory.featureSpecificMemory.llmCalls[id]?.feedback;
};

// --- Initialization ---
const initialize = (getNodes: () => Node[], addMessage: (message: Message) => void, getChatHistory: () => Message[]) => {
  // Allow re-initialization in test environments (like Vitest) for clean state.
  // In normal operation, it should ideally initialize only once.
  if (isInitialized && !(import.meta.env && import.meta.env.VITEST)) {
    console.warn('[MoxusService] Already initialized. Skipping re-initialization in normal mode.');
    return;
  }
  console.log('[MoxusService] Initializing/Re-initializing for ' + (import.meta.env && import.meta.env.VITEST ? 'Vitest test' : 'normal operation') + '...');

  getNodesCallback = getNodes;
  addMessageCallback = addMessage;
  getChatHistoryCallback = getChatHistory;

  // Explicitly reset state variables for a clean slate
  taskQueue = [];
  nextTaskId = 1;
  hasNodeEditionFeedbackCompletedForReport = false;
  hasChatTextFeedbackCompletedForReport = false;
  activeChatTextFeedback = null;
  activeLLMNodeEditionYamlFeedback = null;
  activeFinalReport = null;
  if (processingTimeoutId) {
    clearTimeout(processingTimeoutId);
    processingTimeoutId = null;
  }

  loadMemory(); // Loads or reloads memory, potentially applying defaults
  // triggerProcessing(); // Let's comment this out for now. Processing should start when a task is added.
  isInitialized = true;
  console.log('[MoxusService] Initialized/Re-initialized with callbacks.');
};

// Function to add a task to the queue
const addTask = (type: MoxusTaskType, data: any, chatHistoryContext?: Message[]) => {
  const taskData = { ...data };
  if (chatHistoryContext) {
    if (type === 'finalReport') {
      taskData.chatHistoryContext = getFormattedChatHistoryStringForMoxus(chatHistoryContext, 5); // Use 5 turns for finalReport
    } else {
      taskData.chatHistoryContext = getFormattedChatHistoryStringForMoxus(chatHistoryContext, 10); // Default to 10 for other tasks if context is provided
    }
  } else if (type === 'finalReport' || type === 'synthesizeGeneralMemory') {
    // This fallback for finalReport should ideally not be hit if currentChatHistory is always provided by checkAndTriggerFinalReport
    taskData.chatHistoryContext = "(Chat history context not explicitly provided for this specific task)";
  }
  const newTask: MoxusTask = { id: nextTaskId++, type, data: taskData, timestamp: new Date() };
  taskQueue.push(newTask);
  console.log(`[MoxusService] Task added: ${type} (ID: ${newTask.id}, CHContext used: ${!!chatHistoryContext}). Queue size: ${taskQueue.length}`);
  triggerProcessing();
};

// Function to trigger queue processing if not already running (debounced)
const triggerProcessing = () => {
  if (processingTimeoutId) {
    clearTimeout(processingTimeoutId);
  }
  processingTimeoutId = setTimeout(() => {
    processingTimeoutId = null; 
    processQueue();
  }, 50); 
};

const checkAndTriggerFinalReport = () => {
  console.log(`[MoxusService] Checking final report conditions: NodeEditionDone=${hasNodeEditionFeedbackCompletedForReport}, ChatTextDone=${hasChatTextFeedbackCompletedForReport}`);
  if (hasNodeEditionFeedbackCompletedForReport && hasChatTextFeedbackCompletedForReport) {
    if (!taskQueue.some(task => task.type === 'finalReport')) {
      console.log('[MoxusService] Both node edition and chat text feedbacks completed. Adding finalReport task.');
      const currentChatHistory = getChatHistoryCallback();
      addTask('finalReport', { reason: "Automatic report after node and chat feedback" }, currentChatHistory);
    } else {
      console.log('[MoxusService] Final report conditions met, but a finalReport task is already in the queue.');
    }
    hasNodeEditionFeedbackCompletedForReport = false;
    hasChatTextFeedbackCompletedForReport = false;
  }
};

// Function to get assistant node content (Restored)
const getAssistantNodesContent = (): string => {
  const currentNodes = getNodesCallback(); 
  const assistantNodes = currentNodes.filter(node => node.type === 'assistant');
  if (assistantNodes.length === 0) {
      return "(No 'assistant' type nodes found)";
  }
  return assistantNodes
      .map(node => `Name: ${node.name}\\nDescription: ${node.longDescription}`)
      .join('\\n\\n---\\n\\n');
};

// Asynchronous function to process the queue
const processQueue = async () => {
  let didLaunchOrProcessTaskThisCycle = false;

  if (taskQueue.length === 0) {
    console.log('[MoxusService] Queue empty. Processor idle.');
    return;
  }

  // 1. Attempt to launch finalReport (Highest priority)
  const finalReportTaskIndex = taskQueue.findIndex(t => t.type === 'finalReport');
  if (!activeFinalReport && finalReportTaskIndex !== -1) {
    const task = taskQueue.splice(finalReportTaskIndex, 1)[0];
    console.log(`[MoxusService] Launching task: ${task.type} (ID: ${task.id}) from queue index ${finalReportTaskIndex}`);
    didLaunchOrProcessTaskThisCycle = true;
    activeFinalReport = handleFinalReport(task)
      .catch(err => console.error(`[MoxusService] Error in ${task.type} (ID: ${task.id}):`, err))
      .finally(() => {
        console.log(`[MoxusService] Completed task: ${task.type} (ID: ${task.id})`);
        activeFinalReport = null;
        triggerProcessing(); 
      });
  }

  // 2. Attempt to launch chatTextFeedback
  if (!activeChatTextFeedback && taskQueue[0]?.type === 'chatTextFeedback') {
    const task = taskQueue.shift()!;
    console.log(`[MoxusService] Launching task: ${task.type} (ID: ${task.id})`);
    didLaunchOrProcessTaskThisCycle = true;
    activeChatTextFeedback = handleMemoryUpdate(task) 
      .catch(err => console.error(`[MoxusService] Error in ${task.type} (ID: ${task.id}):`, err))
      .finally(() => {
        console.log(`[MoxusService] Completed task: ${task.type} (ID: ${task.id})`);
        activeChatTextFeedback = null;
        hasChatTextFeedbackCompletedForReport = true;
        console.log('[MoxusService] ChatTextFeedback completed, flag set for final report.');
        checkAndTriggerFinalReport();
        triggerProcessing(); 
      });
  }

  // 3. Attempt to launch llmCallFeedback for node_edition_yaml (and other llmCallFeedbacks)
  // This can run concurrently with chatTextFeedback.
  if (!activeLLMNodeEditionYamlFeedback) { 
    // General llmCallFeedback processing (includes node_edition_yaml)
    const taskIndex = taskQueue.findIndex(t => t.type === 'llmCallFeedback');
    if (taskIndex !== -1) {
        const task = taskQueue.splice(taskIndex, 1)[0]; 
        const callTypeSuffix = task.data?.callType ? ` for ${task.data.callType}` : '';
        console.log(`[MoxusService] Launching task: ${task.type}${callTypeSuffix} (ID: ${task.id}) from queue index ${taskIndex}`);
        didLaunchOrProcessTaskThisCycle = true;
        
        // Use activeLLMNodeEditionYamlFeedback slot for any llmCallFeedback task to simplify active task tracking for this type.
        // This assumes we only process one 'llmCallFeedback' at a time, which is reasonable.
        activeLLMNodeEditionYamlFeedback = handleMemoryUpdate(task)
            .catch(err => console.error(`[MoxusService] Error in ${task.type}${callTypeSuffix} (ID: ${task.id}):`, err))
            .finally(() => {
                console.log(`[MoxusService] Completed task: ${task.type}${callTypeSuffix} (ID: ${task.id})`);
                activeLLMNodeEditionYamlFeedback = null;
                // Set the flag for both node_edition_yaml and node_edition_json calls
                if (task.data?.callType === 'node_edition_yaml' || task.data?.callType === 'node_edition_json') {
                    hasNodeEditionFeedbackCompletedForReport = true; 
                    console.log(`[MoxusService] LLMCallFeedback for ${task.data.callType} completed, flag set for final report.`);
                    checkAndTriggerFinalReport();
                }
                triggerProcessing(); 
            });
    }
  }

  // 4. Handle manual node edit analysis
  if (!didLaunchOrProcessTaskThisCycle) {
    const manualEditTaskIndex = taskQueue.findIndex(t => t.type === 'manualNodeEditAnalysis');
    if (manualEditTaskIndex !== -1) {
      const task = taskQueue.splice(manualEditTaskIndex, 1)[0];
      console.log(`[MoxusService] Launching task: ${task.type} (ID: ${task.id})`);
      didLaunchOrProcessTaskThisCycle = true;
      handleManualNodeEditAnalysis(task)
        .catch(err => console.error(`[MoxusService] Error in ${task.type} (ID: ${task.id}):`, err))
        .finally(() => {
          console.log(`[MoxusService] Completed task: ${task.type} (ID: ${task.id})`);
          triggerProcessing();
        });
    }
  }

  // 5. Process "other" tasks
  if (!didLaunchOrProcessTaskThisCycle && taskQueue.length > 0) {
    const nextTask = taskQueue[0];
    const isTaskForADifferentDedicatedHandlerThatIsBusy = 
        (nextTask.type === 'finalReport' && activeFinalReport) ||
        (nextTask.type === 'chatTextFeedback' && activeChatTextFeedback) ||
        (nextTask.type === 'llmCallFeedback' && activeLLMNodeEditionYamlFeedback); // Covers all llmCallFeedback

    if (nextTask.type === 'llmCallFeedback' && activeLLMNodeEditionYamlFeedback) {
        console.log('[MoxusService] llmCallFeedback at queue head, but its dedicated handler is busy. Waiting.');
    } else if (!isTaskForADifferentDedicatedHandlerThatIsBusy) {
        if ( !activeFinalReport && 
             !activeChatTextFeedback &&
             !activeLLMNodeEditionYamlFeedback
            ) {
            const otherTask = taskQueue.shift()!; 
            console.log(`[MoxusService] Launching other task: ${otherTask.type} (ID: ${otherTask.id})`);
            didLaunchOrProcessTaskThisCycle = true; 
            handleMemoryUpdate(otherTask)
                .catch(err => console.error(`[MoxusService] Error in other task ${otherTask.type} (ID: ${otherTask.id}):`, err))
                .finally(() => {
                    console.log(`[MoxusService] Completed other task: ${otherTask.type} (ID: ${otherTask.id})`);
                    triggerProcessing();
                });
        } else {
            console.log('[MoxusService] Other task at queue head, but one or more major feedback tasks it should wait for are active. Waiting.');
        }
    } else {
        console.log('[MoxusService] Task at queue head is for a different dedicated handler which is currently busy. Waiting.');
    }
  }

  if (!didLaunchOrProcessTaskThisCycle && taskQueue.length > 0) {
    console.log('[MoxusService] No task processed in this cycle, but queue not empty. Active tasks may be blocking or queue head is for a busy handler.');
  }
};

// Helper function to format Moxus report for better readability (Restored)
const formatMoxusReport = (text: string): string => {
  const sections = text.split(/(?=#+\\s+)/);
  if (sections.length > 1) {
    return sections.map(section => section.trim()).join('\\n\\n');
  }
  const paragraphs = text.split(/\\n+/);
  if (paragraphs.length > 1) {
    return paragraphs
      .map(para => {
        if (para.trim().match(/^[A-Z]/) && para.length < 100 && !para.startsWith('-') && !para.startsWith('*')) {
          return `- ${para.trim()}`;
        }
        return para.trim();
      })
      .join('\\n\\n');
  }
  return text;
};

// Helper function to extract previous Moxus final reports from chat history
const extractPreviousFinalReport = (chatHistory: Message[]): { 
  previousReport: string | null, 
  reportAge: number
} => {
  // Find the most recent Moxus message (previous final report)
  const moxusMessages = chatHistory.filter(msg => msg.role === 'moxus');
  if (moxusMessages.length === 0) {
    return {
      previousReport: null,
      reportAge: 0
    };
  }

  const lastMoxusReport = moxusMessages[moxusMessages.length - 1];
  const lastMoxusIndex = chatHistory.findIndex(msg => msg === lastMoxusReport);
  const messagesSinceReport = chatHistory.length - 1 - lastMoxusIndex;

  return {
    previousReport: lastMoxusReport.content,
    reportAge: messagesSinceReport
  };
};



const handleFinalReport = async (task: MoxusTask) => {
  const assistantNodesContent = getAssistantNodesContent();
  const chatHistoryContextString = task.data?.chatHistoryContext || "(Chat history context not available for this report)";
  
  // Get full chat history for previous report analysis
  const fullChatHistory = getChatHistoryCallback();
  const previousReportData = extractPreviousFinalReport(fullChatHistory);

  console.log(`[MoxusService] Previous report found: ${!!previousReportData.previousReport}, age: ${previousReportData.reportAge} messages`);

  // STEP 1: Generate the final report using enhanced prompt
  let promptContent = (loadedPrompts.moxus_prompts as any).moxus_final_report
  
  // Replace placeholders
  promptContent = promptContent.replace(/{assistant_nodes_content}/g, assistantNodesContent || "(No assistant nodes found)");
  promptContent = promptContent.replace(/{chat_history_context}/g, chatHistoryContextString);
  promptContent = promptContent.replace(/{previous_report_analysis}/g, 
    previousReportData.previousReport ? 
    `Previous Report Content:\n${previousReportData.previousReport}\n\nMessages since previous report: ${previousReportData.reportAge}` :
    "No previous final report found in chat history."
  );
  promptContent = promptContent.replace(/{compliance_analysis}/g, 
    previousReportData.previousReport ? 
    `You have a previous report from ${previousReportData.reportAge} messages ago. Analyze what has been applied and what hasn't based on the narrative AI's subsequent responses.` :
    "No previous final report to analyze compliance against."
  );
  promptContent = promptContent.replace(/{general_memory}/g, moxusStructuredMemory.GeneralMemory || '(No general memory available)');
  promptContent = promptContent.replace(/{chat_text_analysis}/g, moxusStructuredMemory.featureSpecificMemory.chatText || '(No chat text analysis available)');
  promptContent = promptContent.replace(/{node_editions_analysis}/g, moxusStructuredMemory.featureSpecificMemory.nodeEdition || '(No node edition analysis available)');

  console.log(`[MoxusService] Generating final report (Task ID: ${task.id}) using current memory sources...`);
  if (!getMoxusFeedbackImpl) {
    throw new Error('getMoxusFeedback implementation not set. Make sure to call setMoxusFeedbackImpl first.');
  }
  const report = await getMoxusFeedbackImpl(promptContent, 'INTERNAL_FINAL_REPORT_GENERATION_STEP');
  console.log(`[MoxusService] Final report generated for Task ID: ${task.id}. Sending to chat.`);

  // STEP 2: Send the report to chat
  addMessageCallback({ role: 'moxus', content: formatMoxusReport(report) });
  
  // STEP 3: Update General Memory AFTER sending the report (as per spec)
  console.log('[MoxusService] Scheduling GeneralMemory update post-final report (Task ID: ' + task.id + ')...');
  addTask('synthesizeGeneralMemory', { 
    reason: `post_final_report_for_task_${task.id}`, 
    originalReportTaskId: task.id,
    chatHistoryForGMUpdate: task.data?.chatHistoryContext ? task.data.chatHistoryContext : undefined,
    previousReportInfo: previousReportData.previousReport ? 
      `Previous report was ${previousReportData.reportAge} messages ago` : 
      "No previous report found"
  });
  console.log('[MoxusService] GeneralMemory update task queued post-final report generation (Task ID: ' + task.id + ').');
};

const handleMemoryUpdate = async (task: MoxusTask) => {
  // Handle assistantFeedback tasks with consciousness-driven approach
  if (task.type === 'assistantFeedback') {
    const assistantNodesContent = getAssistantNodesContent();
    const currentGeneralMemory = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
    const currentAssistantFeedbackMemory = moxusStructuredMemory.featureSpecificMemory.assistantFeedback || DEFAULT_MEMORY.ASSISTANT_FEEDBACK;

    // Use consciousness-driven assistant feedback teaching prompt
    let feedbackPrompt = (loadedPrompts.moxus_prompts as any).moxus_feedback_on_assistant_feedback;
    
    feedbackPrompt = formatPrompt(feedbackPrompt, {
      assistant_nodes_content: assistantNodesContent,
      current_general_memory: currentGeneralMemory,
      user_query: task.data.query || '',
      assistant_result: JSON.stringify(task.data.result, null, 2) || '',
      current_assistant_feedback_memory: currentAssistantFeedbackMemory
    });

    if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set.');
    const feedback = await getMoxusFeedbackImpl(feedbackPrompt, 'moxus_feedback_on_assistant_feedback');

    // Process consciousness-driven feedback
    try {
      const parsedResponse = safeJsonParse(feedback);
      
      // Store consciousness evolution for later consolidation (don't append directly)
      if (parsedResponse.consciousness_evolution) {
        await atomicMemoryUpdate(() => {
          moxusStructuredMemory.pendingConsciousnessEvolution = 
            (moxusStructuredMemory.pendingConsciousnessEvolution || [])
            .concat(parsedResponse.consciousness_evolution);
          console.log(`[MoxusService] Stored consciousness evolution for later consolidation: ${parsedResponse.consciousness_evolution}`);
        });
      }
      
      // Handle memory updates for assistantFeedback using atomic updates
      if (parsedResponse.memory_update_diffs) {
        await atomicMemoryUpdate(() => {
          let updatedMemory = moxusStructuredMemory.featureSpecificMemory.assistantFeedback;
          if (parsedResponse.memory_update_diffs.rpl !== undefined) {
            updatedMemory = parsedResponse.memory_update_diffs.rpl;
          } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
            // Filter diffs to only include those that target content in assistantFeedback memory
            const validDiffs = parsedResponse.memory_update_diffs.df.filter((diff: any) => {
              if (!diff.prev_txt) return true; // Allow append operations
              const found = updatedMemory.includes(diff.prev_txt);
              if (!found) {
                console.warn(`[MoxusService] Skipping assistantFeedback diff that targets content not found in assistantFeedback memory: "${diff.prev_txt.substring(0, 100)}..."`);
              }
              return found;
            });
            
            if (validDiffs.length > 0) {
              updatedMemory = applyDiffs(updatedMemory, validDiffs);
              console.log(`[MoxusService] Applied ${validDiffs.length} out of ${parsedResponse.memory_update_diffs.df.length} diffs to assistantFeedback memory.`);
            } else {
              console.warn('[MoxusService] No valid diffs found for assistantFeedback memory. All diffs target content not in assistantFeedback memory.');
            }
          }
          moxusStructuredMemory.featureSpecificMemory.assistantFeedback = updatedMemory;
          console.log(`[MoxusService] Updated assistantFeedback memory document via consciousness-driven feedback for task ${task.id}.`);
        });
      }
      
      // Store teaching insights for future guidance use
      if (parsedResponse.assistant_teaching) {
        const guidanceText = [
          parsedResponse.assistant_teaching.performance_assessment,
          parsedResponse.assistant_teaching.interaction_guidance,
          parsedResponse.assistant_teaching.solution_quality_notes,
          parsedResponse.assistant_teaching.user_experience_insights
        ].filter(Boolean).join('\n\n');
        
        if (guidanceText.trim()) {
          await atomicMemoryUpdate(() => {
            moxusStructuredMemory.cachedGuidance = moxusStructuredMemory.cachedGuidance || {};
            moxusStructuredMemory.cachedGuidance.assistantGuidance = guidanceText;
            console.log(`[MoxusService] Cached assistant teaching insights for future guidance.`);
          });
        }
      }
    } catch (error) {
      console.error('[MoxusService] Error processing consciousness feedback for assistantFeedback:', error);
      // Fallback to storing raw feedback
      moxusStructuredMemory.featureSpecificMemory.assistantFeedback += '\n\n' + feedback;
      saveMemory();
    }

    return;
  }

  if (task.type === 'llmCallFeedback' || task.type === 'chatTextFeedback') {
    if (task.data && task.data.id) {
      const callId = task.data.id;
      const originalCallTypeForFeedback = task.data.callType;
      const typesToSkipMoxusFeedback = ['image_prompt_generation', 'action_generation', 'image_generation_novelai'];
      if (typesToSkipMoxusFeedback.includes(originalCallTypeForFeedback)) {
        console.log(`[MoxusService] Skipping Moxus feedback generation for call type '${originalCallTypeForFeedback}' (ID: ${callId}).`);
        return; 
      }
      if (!moxusStructuredMemory.featureSpecificMemory.llmCalls[callId]) {
        console.warn(`[MoxusService] LLM call ${callId} not found for feedback. Reconstructing.`);
        const now = new Date();
        moxusStructuredMemory.featureSpecificMemory.llmCalls[callId] = { id: callId, prompt: task.data.prompt || "[prompt unavailable]", response: task.data.response || "[response unavailable]", timestamp: now, status: 'completed', startTime: new Date(task.data.timestamp || now), endTime: now, callType: originalCallTypeForFeedback || 'unknown_reconstructed', modelUsed: task.data.modelUsed || 'unknown_reconstructed'};
      }
      const assistantNodesContent = getAssistantNodesContent();
      const currentGeneralMemory = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
      let feedbackPrompt: string;
      let promptType: string;
      
      // Use consciousness-driven prompts for specific call types
      if (task.type === 'chatTextFeedback' && originalCallTypeForFeedback === 'chat_text_generation') {
        // Use consciousness-driven chat text teaching prompt
        feedbackPrompt = loadedPrompts.moxus_prompts.moxus_feedback_on_chat_text_generation;
        
        const currentChatTextMemory = moxusStructuredMemory.featureSpecificMemory.chatText || DEFAULT_MEMORY.CHAT_TEXT;
        const recentChatHistory = task.data.chatHistory ? 
          getFormattedChatHistoryStringForMoxus(task.data.chatHistory, 10) : 
          "(No chat history available)";
        
        feedbackPrompt = formatPrompt(feedbackPrompt, {
          assistant_nodes_content: assistantNodesContent,
          current_general_memory: currentGeneralMemory,
          recent_chat_history: recentChatHistory,
          generated_chat_text: task.data.response || '',
          current_chat_text_memory: currentChatTextMemory
        });
        
        promptType = 'moxus_feedback_on_chat_text_generation';
      } else if (task.type === 'llmCallFeedback' && originalCallTypeForFeedback === 'node_edition_json') {
        // Use consciousness-driven node edition teaching prompt
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Starting node_edition_json feedback for task ${task.id}`);
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Call ID: ${task.data.id}`);
        
        feedbackPrompt = loadedPrompts.moxus_prompts.moxus_feedback_on_node_edition_json;
        
        const currentNodeEditionMemory = moxusStructuredMemory.featureSpecificMemory.nodeEdition || DEFAULT_MEMORY.NODE_EDITION;
        const recentChatHistory = task.data.chatHistory ? 
          getFormattedChatHistoryStringForMoxus(task.data.chatHistory, 10) : 
          "(No recent interaction context available)";
        const allNodesContext = getNodesCallback().map(node => `ID: ${node.id}, Name: ${node.name}, Type: ${node.type}`).join('\n');
        
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Current nodeEdition memory length: ${currentNodeEditionMemory.length}`);
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Current nodeEdition memory preview: "${currentNodeEditionMemory.substring(0, 200)}..."`);
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Full nodeEdition memory being sent to LLM: "${currentNodeEditionMemory}"`);
        
        feedbackPrompt = formatPrompt(feedbackPrompt, {
          assistant_nodes_content: assistantNodesContent,
          current_general_memory: currentGeneralMemory,
          recent_chat_history: recentChatHistory,
          node_edition_response: task.data.response || '',
          all_nodes_context: allNodesContext,
          current_node_edition_memory: currentNodeEditionMemory
        });
        
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Formatted prompt length: ${feedbackPrompt.length}`);
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Prompt contains JSON instruction: ${feedbackPrompt.toLowerCase().includes('json')}`);
        
        promptType = 'moxus_feedback_on_node_edition_json';
      } else {
        // Fallback to generic feedback for other types
        feedbackPrompt = `\n      # Task\n      You have to analyze an LLM call.\n\n      ${assistantNodesContent ? `## Additional features:\n      ---\n      ${assistantNodesContent}\n      ---` : ""}\n      \n      ## PROMPT:\n      ---start of prompt---\n      ${task.data.prompt}\n      ---end of prompt---\n      \n      ## RESPONSE:\n      ---start of response---\n      ${task.data.response}\n      ---end of response---\n      \n      Provide critical feedback focusing ONLY on problems with this response.\n      Focus exclusively on what could be improved, not what went well.\n      Identify specific issues with quality, relevance, coherence, or accuracy.`;
        promptType = originalCallTypeForFeedback;
      }
      
      if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set.');
      
      console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: About to call LLM for feedback with promptType: ${promptType}`);
      const feedback = await getMoxusFeedbackImpl(feedbackPrompt, promptType);
      console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Received LLM feedback, length: ${feedback.length}`);
      console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Feedback preview: "${feedback.substring(0, 300)}..."`);
      
      const truncatedFeedback = feedback.length > TRUNCATE_LENGTH ? feedback.substring(0, TRUNCATE_LENGTH) + "... [truncated]" : feedback;
      if (moxusStructuredMemory.featureSpecificMemory.llmCalls[callId]) {
         moxusStructuredMemory.featureSpecificMemory.llmCalls[callId].feedback = truncatedFeedback;
         saveMemory(); 
         emitLLMLogUpdate(); 
      }
      
      // Process consciousness-driven feedback if it's a specialized prompt
      if (promptType === 'moxus_feedback_on_chat_text_generation' || promptType === 'moxus_feedback_on_node_edition_json') {
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Processing consciousness feedback for promptType: ${promptType}`);
        
        try {
          const parsedResponse = safeJsonParse(feedback);
          console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: JSON parsing successful: ${!!parsedResponse}`);
          console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Has memory_update_diffs: ${!!parsedResponse?.memory_update_diffs}`);
          
          if (parsedResponse?.memory_update_diffs) {
            console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: memory_update_diffs structure:`, JSON.stringify(parsedResponse.memory_update_diffs, null, 2));
          }
          
          // Store consciousness evolution for later consolidation (don't append directly)
          if (parsedResponse.consciousness_evolution) {
            await atomicMemoryUpdate(() => {
              moxusStructuredMemory.pendingConsciousnessEvolution = 
                (moxusStructuredMemory.pendingConsciousnessEvolution || [])
                .concat(parsedResponse.consciousness_evolution);
              console.log(`[MoxusService] Stored consciousness evolution for later consolidation: ${parsedResponse.consciousness_evolution}`);
            });
          }
          
          // Handle memory updates for specific feedback types using atomic updates
          if (parsedResponse.memory_update_diffs) {
            if (task.type === 'chatTextFeedback') {
              await atomicMemoryUpdate(() => {
                let updatedMemory = moxusStructuredMemory.featureSpecificMemory.chatText;
                if (parsedResponse.memory_update_diffs.rpl !== undefined) {
                  updatedMemory = parsedResponse.memory_update_diffs.rpl;
                } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
                  // Filter diffs to only include those that target content in chatText memory
                  const validDiffs = parsedResponse.memory_update_diffs.df.filter((diff: any) => {
                    if (!diff.prev_txt) return true; // Allow append operations
                    const found = updatedMemory.includes(diff.prev_txt);
                    if (!found) {
                      console.warn(`[MoxusService] Skipping chatText diff that targets content not found in chatText memory: "${diff.prev_txt.substring(0, 100)}..."`);
                    }
                    return found;
                  });
                  
                  if (validDiffs.length > 0) {
                    updatedMemory = applyDiffs(updatedMemory, validDiffs);
                    console.log(`[MoxusService] Applied ${validDiffs.length} out of ${parsedResponse.memory_update_diffs.df.length} diffs to chatText memory.`);
                  } else {
                    console.warn('[MoxusService] No valid diffs found for chatText memory. All diffs target content not in chatText memory.');
                  }
                }
                moxusStructuredMemory.featureSpecificMemory.chatText = updatedMemory;
              });
            } else if (task.type === 'llmCallFeedback' && task.data?.callType === 'node_edition_json') {
              
              await atomicMemoryUpdate(() => {
                let updatedMemory = moxusStructuredMemory.featureSpecificMemory.nodeEdition;                
                if (parsedResponse.memory_update_diffs.rpl !== undefined) {
                  updatedMemory = parsedResponse.memory_update_diffs.rpl;
                } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
                  
                  // Filter diffs to only include those that target content in nodeEdition memory
                  const validDiffs = parsedResponse.memory_update_diffs.df.filter((diff: any) => {
                    if (!diff.prev_txt) {
                      console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Allowing append operation (empty prev_txt)`);
                      return true; // Allow append operations
                    }
                    const found = updatedMemory.includes(diff.prev_txt);
                    if (!found) {                      
                      // Check for partial matches to help debug
                      const firstLine = diff.prev_txt.split('\n')[0];
                      
                      // Try normalized comparison
                      const normalizedMemory = updatedMemory.replace(/\r\n/g, '\n').trim();
                      const normalizedExpected = diff.prev_txt.replace(/\r\n/g, '\n').trim();
                      if (normalizedMemory.includes(normalizedExpected)) {
                        return true; // Allow this diff with normalization
                      }
                    }
                    return found;
                  });
                  
                  if (validDiffs.length > 0) {
                    const beforeLength = updatedMemory.length;
                    updatedMemory = applyDiffs(updatedMemory, validDiffs);
                    const afterLength = updatedMemory.length;
                  } else {
                    console.warn('[MoxusService] No valid diffs found for nodeEdition memory. All diffs target content not in nodeEdition memory.');
                  }
                } else {
                  console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: No rpl or df found in memory_update_diffs`);
                }
                
                moxusStructuredMemory.featureSpecificMemory.nodeEdition = updatedMemory;
                console.log(`[MoxusService] Updated nodeEdition memory document via consciousness-driven feedback for task ${task.id}.`);
              });
              
              console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Completed atomic update for nodeEdition memory`);
              
              // Verify the memory was actually updated
              const finalMemory = moxusStructuredMemory.featureSpecificMemory.nodeEdition;
              console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Post-atomic-update memory length: ${finalMemory.length}`);
              console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Post-atomic-update memory preview: "${finalMemory.substring(0, 200)}..."`);
            }
          }
          
          // Store teaching insights for future guidance use using atomic updates
          if (parsedResponse.narrative_teaching && task.type === 'chatTextFeedback') {
            const guidanceText = [
              parsedResponse.narrative_teaching.performance_assessment,
              parsedResponse.narrative_teaching.specific_guidance,
              parsedResponse.narrative_teaching.learned_preferences,
              parsedResponse.narrative_teaching.emotional_intelligence
            ].filter(Boolean).join('\n\n');
            
            if (guidanceText.trim()) {
              await atomicMemoryUpdate(() => {
                moxusStructuredMemory.cachedGuidance = moxusStructuredMemory.cachedGuidance || {};
                moxusStructuredMemory.cachedGuidance.chatTextGuidance = guidanceText;
                console.log(`[MoxusService] Cached narrative teaching insights for future guidance.`);
              });
            }
          }
          
          if (parsedResponse.worldbuilding_teaching && task.type === 'llmCallFeedback' && task.data?.callType === 'node_edition_json') {
            const guidanceText = [
              parsedResponse.worldbuilding_teaching.performance_assessment,
              parsedResponse.worldbuilding_teaching.structural_guidance,
              parsedResponse.worldbuilding_teaching.narrative_integration,
              parsedResponse.worldbuilding_teaching.user_preference_alignment
            ].filter(Boolean).join('\n\n');
            
            if (guidanceText.trim()) {
              await atomicMemoryUpdate(() => {
                moxusStructuredMemory.cachedGuidance = moxusStructuredMemory.cachedGuidance || {};
                moxusStructuredMemory.cachedGuidance.nodeEditionGuidance = guidanceText;
                console.log(`[MoxusService] Cached worldbuilding teaching insights for future guidance.`);
              });
            }
          }
          
          // Check if we should trigger consciousness consolidation
          const shouldTriggerConsolidation = shouldTriggerConsciousnessConsolidation();
          if (shouldTriggerConsolidation) {
            console.log('[MoxusService] Triggering consciousness consolidation due to accumulated evolution insights');
            addTask('synthesizeGeneralMemory', { 
              reason: 'consciousness_consolidation',
              pendingEvolution: [...(moxusStructuredMemory.pendingConsciousnessEvolution || [])]
            });
          }
        } catch (error) {
          console.error('[MoxusService] Error processing consciousness feedback:', error);
          console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Error in consciousness feedback processing: ${error}`);
          // Fallback processing already handled by storing raw feedback above
        }
      }
      const processedFeedbacks = Object.values(moxusStructuredMemory.featureSpecificMemory.llmCalls).filter(c => c.feedback).length;
      const FEEDBACK_THRESHOLD_FOR_GENERAL_MEMORY_UPDATE = 5;
      const systemEventCallTypes = ['chat_reset_event', 'assistant_message_edit_event'];
      if (!systemEventCallTypes.includes(task.data.callType)) {
        // if (processedFeedbacks > 0 && processedFeedbacks % FEEDBACK_THRESHOLD_FOR_GENERAL_MEMORY_UPDATE === 0) {
        //   console.log(`[MoxusService] Scheduling GeneralMemory update. Processed feedbacks: ${processedFeedbacks}. Triggered by feedback for call: ${callId} (type: ${task.data.callType})`);
        //   addTask('synthesizeGeneralMemory', { reason: `periodic_update_after_${processedFeedbacks}_feedbacks`, triggeringCallId: callId, triggeringCallType: task.data.callType });
        // }
      } else {
        console.log(`[MoxusService] Feedback for system event ${task.data.callType} (ID: ${callId}) will not trigger periodic GeneralMemory update.`);
      }

      // Note: Removed fallback handling for node_edition_yaml and non-consciousness-driven chatTextFeedback
      // All tasks now use consciousness-driven approaches
    }
    return;
  }

  // Handle synthesizeGeneralMemory tasks
  if (task.type === 'synthesizeGeneralMemory') {
    console.log(`[MoxusService] Task ${task.id} (${task.type}) is calling updateGeneralMemoryFromAllSources.`);
    await updateGeneralMemoryFromAllSources(task.type, task.data);
    return;
  }

  // All other task types should be handled by consciousness-driven approaches above
  console.warn(`[MoxusService] Task ${task.id} of unhandled type '${task.type}'. All tasks should use consciousness-driven approaches.`);
};

// Helper function to apply diffs to a text
// Function to determine if consciousness consolidation should be triggered
const shouldTriggerConsciousnessConsolidation = (): boolean => {
  const pendingEvolution = moxusStructuredMemory.pendingConsciousnessEvolution || [];
  const CONSOLIDATION_THRESHOLD = 3; // Trigger after 3 consciousness evolution insights
  
  return pendingEvolution.length >= CONSOLIDATION_THRESHOLD;
};

const applyDiffs = (originalText: string, diffs: Array<{ prev_txt: string, next_txt: string, occ?: number }>): string => {
  let modifiedText = originalText;
  for (const diff of diffs) {
    const { prev_txt, next_txt, occ = 1 } = diff;
    
    // Handle empty prev_txt as append operation
    if (!prev_txt) {
      if (next_txt) { // Only append if there's something to append
        modifiedText += next_txt;
        console.log(`[MoxusService] applyDiffs: Appended content to end of text. New length: ${modifiedText.length}`);
      }
      continue;
    }

    let count = 0;
    let pos = modifiedText.indexOf(prev_txt);
    
    while (pos !== -1) {
      count++;
      if (count === occ) {
        modifiedText = modifiedText.substring(0, pos) + next_txt + modifiedText.substring(pos + prev_txt.length);
        break; 
      }
      pos = modifiedText.indexOf(prev_txt, pos + 1);
    }
    if (count < occ) {
      console.warn(`[MoxusService] applyDiffs: Could not find occurrence ${occ} of "${prev_txt}". Only ${count} found.`);
    }
  }
  return modifiedText;
};

// Function to update GeneralMemory from all memory sources (Restored)
const updateGeneralMemoryFromAllSources = async (originalCallTypeForThisUpdate: string = 'scheduled_general_memory_update', taskData?: any) => {
  console.log(`[MoxusService] Attempting to update GeneralMemory. Trigger reason/type: ${originalCallTypeForThisUpdate}`);
  const assistantNodesContent = getAssistantNodesContent();
  
  let updatePrompt: string;
  let updatePromptTemplate: string;
  let promptData: Record<string, string>;
  const currentGeneralMemorySnapshot = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
  
  // Handle pending consciousness evolution (declare at function scope)
  const pendingEvolution = moxusStructuredMemory.pendingConsciousnessEvolution || [];

  if (originalCallTypeForThisUpdate === 'synthesizeGeneralMemory' && taskData?.reason === "chat_reset_event" && taskData?.previousChatHistoryString && taskData?.eventDetails) {
    console.log('[MoxusService] Using dedicated prompt for chat_reset_event GeneralMemory update.');
    updatePrompt = getChatResetMemoryUpdatePrompt(
      currentGeneralMemorySnapshot,
      assistantNodesContent,
      taskData.previousChatHistoryString,
      taskData.eventDetails
    );
    if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set.');
    const fullUpdatedMemory = await getMoxusFeedbackImpl(updatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_${originalCallTypeForThisUpdate}`);
    moxusStructuredMemory.GeneralMemory = fullUpdatedMemory.length > 15000 ? fullUpdatedMemory.substring(0, 15000) + "... [GeneralMemory truncated]" : fullUpdatedMemory;
    console.log('[MoxusService] Updated GeneralMemory via chat_reset_event (full update).');
    saveMemory();
    return;
  } else {
    console.log('[MoxusService] Using standard synthesis prompt for GeneralMemory update (expecting JSON diff).');
    const recentFeedbacks = Object.entries(moxusStructuredMemory.featureSpecificMemory.llmCalls)
      .sort((a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime()).reverse().slice(0, 5)
      .map(([id, call]) => ({ id, feedback: call.feedback || "No feedback available" }));
    
    const truncateText = (text: string, maxLength: number = TRUNCATE_LENGTH) => text && text.length > maxLength ? text.substring(0, maxLength) + "... [truncated]" : text;
    
    const generalMemoryForPrompt = truncateText(currentGeneralMemorySnapshot); 
    const chatTextMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.chatText);
    const nodeEditionMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.nodeEdition);
    const assistantFeedbackMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.assistantFeedback);
    const nodeEditMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.nodeEdit);

    updatePromptTemplate = loadedPrompts.moxus_prompts.general_memory_update;

    // Add previous report context if this update is post-final-report
    let reportContext = '';
    if (taskData?.previousReportInfo) {
      reportContext = `\n\n## RECENT FINAL REPORT CONTEXT\nMoxus just generated a final report.\nPrevious Report Info: ${taskData.previousReportInfo}\n\nThis provides context about the timing and presence of previous reports.`;
    }

    promptData = {
      assistant_nodes_content: truncateText(assistantNodesContent),
      current_general_memory: generalMemoryForPrompt,
      chat_text_analysis: chatTextMemory || '(No chat text analysis available)',
      node_editions_analysis: nodeEditionMemory || '(No node edition analysis available)',
      assistant_feedback_analysis: assistantFeedbackMemory || '(No assistant feedback analysis available)',
      node_edit_analysis: nodeEditMemory || '(No node edit analysis available)',
      recent_llm_feedbacks: JSON.stringify(recentFeedbacks, null, 2),
      pending_consciousness_evolution: (pendingEvolution.length > 0 
        ? pendingEvolution.join('\n\n') 
        : '(No pending consciousness evolution insights)') + reportContext
    };

    updatePrompt = formatPrompt(updatePromptTemplate, promptData);
  }
  
  if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set.');
  const jsonResponse = await getMoxusFeedbackImpl(updatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_${originalCallTypeForThisUpdate}`);
  
  let contentToParse = jsonResponse.trim();

  try {
    const parsedJson = safeJsonParse(contentToParse) as any;
    let finalGeneralMemory = currentGeneralMemorySnapshot;

    if (parsedJson && parsedJson.memory_update_diffs) {
      if (parsedJson.memory_update_diffs.rpl !== undefined) {
        console.log('[MoxusService] Applying full replacement to GeneralMemory.');
        finalGeneralMemory = parsedJson.memory_update_diffs.rpl;
      } else if (parsedJson.memory_update_diffs.df && Array.isArray(parsedJson.memory_update_diffs.df)) {
        console.log('[MoxusService] Applying diffs to GeneralMemory.');
        
        // Filter diffs to only include those that target content in GeneralMemory
        const validDiffs = parsedJson.memory_update_diffs.df.filter((diff: any) => {
          if (!diff.prev_txt) return true; // Allow append operations
          const found = currentGeneralMemorySnapshot.includes(diff.prev_txt);
          if (!found) {
            console.warn(`[MoxusService] Skipping diff that targets content not found in GeneralMemory: "${diff.prev_txt.substring(0, 100)}..."`);
          }
          return found;
        });
        
        if (validDiffs.length > 0) {
          finalGeneralMemory = applyDiffs(currentGeneralMemorySnapshot, validDiffs);
          console.log(`[MoxusService] Applied ${validDiffs.length} out of ${parsedJson.memory_update_diffs.df.length} diffs to GeneralMemory.`);
        } else {
          console.warn('[MoxusService] No valid diffs found for GeneralMemory. All diffs target content not in GeneralMemory.');
          finalGeneralMemory = currentGeneralMemorySnapshot; // Keep original if no valid diffs
        }
      } else {
        console.warn('[MoxusService] Received JSON for GeneralMemory update, but no valid rpl or df instructions found in memory_update_diffs.');
        console.warn('[MoxusService] Using raw (cleaned) response as fallback.');
        finalGeneralMemory = contentToParse; 
      }
    } else {
      console.warn('[MoxusService] GeneralMemory update response was not valid JSON or did not contain memory_update_diffs after cleaning.');
      console.warn('[MoxusService] Using raw (cleaned) response as fallback.');
      finalGeneralMemory = contentToParse;
    }

    moxusStructuredMemory.GeneralMemory = finalGeneralMemory.length > 15000 
      ? finalGeneralMemory.substring(0, 15000) + "... [GeneralMemory truncated due to excessive length]" 
      : finalGeneralMemory;
    
    // Clear pending consciousness evolution after successful consolidation
    if (pendingEvolution.length > 0) {
      moxusStructuredMemory.pendingConsciousnessEvolution = [];
      console.log(`[MoxusService] Cleared ${pendingEvolution.length} pending consciousness evolution insights after consolidation`);
    }
    
    console.log('[MoxusService] Updated GeneralMemory');
    saveMemory();

  } catch (error) {
    console.error('[MoxusService] Error processing JSON response for GeneralMemory update:', error);
    console.warn('[MoxusService] Falling back to storing raw (cleaned) response in GeneralMemory due to JSON processing error.');
    const rawCleanedResponseFallback = contentToParse.length > 15000 
        ? contentToParse.substring(0, 15000) + "... [GeneralMemory truncated due to excessive length]" 
        : contentToParse;
    moxusStructuredMemory.GeneralMemory = rawCleanedResponseFallback;
    saveMemory();
  }
};

const getChatResetMemoryUpdatePrompt = (currentGeneralMemory: string, assistantNodesContent: string, previousChatHistoryString: string, eventDetails: {id: string, prompt: string, response: string}): string => {
  return `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
You are tasked with updating your GeneralMemory document because a "Chat Reset" event has just occurred.

# ASSISTANT NODE DETAILS (Moxus's current understanding of the Narrative AI's core function/personality)
${assistantNodesContent}
---

# PREVIOUS CHAT HISTORY (Content before the user initiated the reset)
${previousChatHistoryString}
---

# CHAT RESET EVENT DETAILS
Event ID: ${eventDetails.id}
Trigger: ${eventDetails.prompt}
Details: ${eventDetails.response}
---

# CURRENT GENERAL MEMORY DOCUMENT (Your existing knowledge and personality)
${currentGeneralMemory}
---

# INSTRUCTIONS
1.  **Acknowledge the Reset**: Note that the user has reset the chat interface.
2.  **Analyze Context**: Review the "PREVIOUS CHAT HISTORY" and "ASSISTANT NODE DETAILS".
3.  **Speculate on Cause**: Based on the analysis, hypothesize *why* the user might have reset the chat. Consider:
    *   Was the story stuck, unclear, or unengaging?
    *   Did the narrative AI (guided by ASSISTANT NODE DETAILS) lead the user to a point of frustration?
    *   Were there unresolved issues or loops in the previous interactions?
4.  **Formulate Prevention Strategies**: Reflect on how similar chat resets could be minimized. What can the narrative AI do differently to:
    *   Maintain user engagement?
    *   Ensure clarity and a sense of progress?
    *   Adapt better to user desires or perceived dead-ends?
5.  **Update GeneralMemory**: Integrate these insights into your "CURRENT GENERAL MEMORY DOCUMENT".
    *   Focus on critical observations specifically related to this reset event and its implications.
    *   The goal is to refine your understanding and guide the narrative AI to improve future user experiences, making resets less likely.
    *   Maintain and enrich your established personality, ensuring it reflects a deeper understanding of user interaction patterns.
6.  **Output**: Return ONLY the complete, updated GeneralMemory document. It should be a single block of text.

Your updated GeneralMemory should be critical yet constructive, aiming to prevent future user desire to reset the chat. Focus on learning from this event.`;
};

export const getMoxusPersonalityContext = (): string => {
  return getAssistantNodesContent();
};

export const getLLMCallsMemoryJSON = (): string => {
  try {
    const memoryForJson = {
      GeneralMemory: moxusStructuredMemory.GeneralMemory,
      featureSpecificMemory: {
        nodeEdition: moxusStructuredMemory.featureSpecificMemory.nodeEdition,
        chatText: moxusStructuredMemory.featureSpecificMemory.chatText,
        assistantFeedback: moxusStructuredMemory.featureSpecificMemory.assistantFeedback,
        nodeEdit: moxusStructuredMemory.featureSpecificMemory.nodeEdit,
      },
      recentLLMFeedback: Object.entries(moxusStructuredMemory.featureSpecificMemory.llmCalls)
        .sort((a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime()).reverse().slice(0, 5)
        .map(([id, call]) => ({ id, feedback: call.feedback || "No feedback available" }))
    };
    return JSON.stringify(memoryForJson, null, 2);
  } catch (error) {
    console.error('[MoxusService] Error generating JSON:', error);
    return "Error generating memory JSON";
  }
};

export const clearLLMLogEntries = (): void => {
  moxusStructuredMemory.featureSpecificMemory.llmCalls = {};
  saveMemory();
  emitLLMLogUpdate();
  console.log('[MoxusService] LLM log entries cleared.');
};

// Enhanced specialized guidance functions using cached teaching insights
export const getChatTextGuidance = async (currentContext: string): Promise<string> => {
  // Return cached guidance from recent feedback analysis, or fallback to general memory
  const cachedGuidance = moxusStructuredMemory.cachedGuidance?.chatTextGuidance;
  if (cachedGuidance && cachedGuidance.trim()) {
    console.log('[MoxusService] Using cached narrative teaching insights for guidance');
    return cachedGuidance;
  }
  
  // Fallback to general memory if no cached guidance available
  const fallbackGuidance = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
  console.log('[MoxusService] No cached narrative guidance available, using general memory fallback');
  return fallbackGuidance;
};

export const getNodeEditionGuidance = async (currentContext: string): Promise<string> => {
  // Return cached guidance from recent feedback analysis, or fallback to general memory
  const cachedGuidance = moxusStructuredMemory.cachedGuidance?.nodeEditionGuidance;
  if (cachedGuidance && cachedGuidance.trim()) {
    console.log('[MoxusService] Using cached worldbuilding teaching insights for guidance');
    return cachedGuidance;
  }
  
  // Fallback to general memory if no cached guidance available
  const fallbackGuidance = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
  console.log('[MoxusService] No cached worldbuilding guidance available, using general memory fallback');
  return fallbackGuidance;
};

export const getSpecializedMoxusGuidance = async (callType: string, currentContext: string): Promise<string> => {
  if (callType === 'chat_text_generation') {
    return await getChatTextGuidance(currentContext);
  } else if (callType === 'node_edition_json') {
    return await getNodeEditionGuidance(currentContext);
  } else {
    // For unrecognized call types, return general memory
    return moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
  }
};

export const recordManualNodeEdit = (originalNode: any, editedNode: any, editContext: string) => {
  // Add manual node edit analysis task
  setTimeout(() => {
    addTask('manualNodeEditAnalysis', {
      originalNode,
      editedNode,
      editContext,
      timestamp: new Date()
    });
  }, 100);
};

// Helper function to sanitize node data for Moxus prompts (removes base64 image data)
const sanitizeNodeForMoxusPrompt = (node: any): any => {
  if (!node) return node;
  
  const sanitized = { ...node };
  
  // Remove or replace base64 image data
  if (sanitized.image && typeof sanitized.image === 'string') {
    if (sanitized.image.startsWith('data:image/') || sanitized.image.length > 100) {
      sanitized.image = '[IMAGE_DATA_FILTERED_FOR_ANALYSIS]';
    }
  }
  
  return sanitized;
};

// Handle manual node edit analysis
const handleManualNodeEditAnalysis = async (task: MoxusTask) => {
  if (!getMoxusFeedbackImpl) {
    console.warn('[MoxusService] getMoxusFeedbackImpl not available for manual node edit analysis');
    return;
  }

  try {
    const assistantNodesContent = getAssistantNodesContent();
    const currentGeneralMemory = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
    const currentManualEditMemory = moxusStructuredMemory.featureSpecificMemory.nodeEdit || DEFAULT_MEMORY.NODE_EDIT;

    // Sanitize node data to remove base64 image content
    const sanitizedOriginalNode = sanitizeNodeForMoxusPrompt(task.data.originalNode);
    const sanitizedEditedNode = sanitizeNodeForMoxusPrompt(task.data.editedNode);

    let analysisPrompt = loadedPrompts.moxus_prompts.moxus_feedback_on_manual_node_edit;
    
    analysisPrompt = formatPrompt(analysisPrompt, {
      assistant_nodes_content: assistantNodesContent,
      current_general_memory: currentGeneralMemory,
      original_node: JSON.stringify(sanitizedOriginalNode, null, 2),
      user_changes: JSON.stringify(sanitizedEditedNode, null, 2),
      edit_context: task.data.editContext,
      current_manual_edit_memory: currentManualEditMemory
    });

    const learningResponse = await getMoxusFeedbackImpl(analysisPrompt, 'moxus_feedback_on_manual_node_edit');
    
    // Process the JSON learning response using the new diff format
    try {
      const parsedResponse = safeJsonParse(learningResponse);
      if (parsedResponse && parsedResponse.memory_update_diffs) {
        let updatedMemory = currentManualEditMemory;
        if (parsedResponse.memory_update_diffs.rpl !== undefined) {
          updatedMemory = parsedResponse.memory_update_diffs.rpl;
        } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
          updatedMemory = applyDiffs(updatedMemory, parsedResponse.memory_update_diffs.df);
        }
        moxusStructuredMemory.featureSpecificMemory.nodeEdit = updatedMemory;
        console.log(`[MoxusService] Updated nodeEdit memory document via manual edit analysis for task ${task.id}.`);
      } else {
        // Fallback to appending raw response if JSON parsing fails
        console.warn('[MoxusService] Manual edit analysis response was not valid JSON or missing memory_update_diffs. Using raw response as fallback.');
        moxusStructuredMemory.featureSpecificMemory.nodeEdit += '\n\n' + learningResponse;
      }
    } catch (error) {
      console.error('[MoxusService] Error parsing manual edit analysis JSON response:', error);
      // Fallback to appending raw response
      moxusStructuredMemory.featureSpecificMemory.nodeEdit += '\n\n' + learningResponse;
    }
    
    saveMemory();
  } catch (error) {
    console.error('[MoxusService] Error in handleManualNodeEditAnalysis:', error);
  }
};

// Atomic memory update function to prevent race conditions
const atomicMemoryUpdate = async (updateFunction: () => void | Promise<void>): Promise<void> => {
  return memoryUpdateMutex = memoryUpdateMutex.then(async () => {
    try {
      // Only reload memory from localStorage in non-test environments
      // In test environments, we want to preserve the in-memory state
      if (!(import.meta.env && import.meta.env.VITEST)) {
        const beforeReload = moxusStructuredMemory.featureSpecificMemory.nodeEdition.length;
        loadMemory();
        const afterReload = moxusStructuredMemory.featureSpecificMemory.nodeEdition.length;
        console.log(`[MoxusService] 🔍 NODEDIT-DEBUG: Memory reloaded from localStorage - nodeEdition length: ${beforeReload} -> ${afterReload}`);
        if (beforeReload !== afterReload) {
          console.warn(`[MoxusService] 🔍 NODEDIT-DEBUG: Memory changed during reload! This could cause diff mismatches.`);
        }
      }
      
      // Apply the update
      await updateFunction();
      
      // Save the updated memory
      saveMemory();
      
      console.log('[MoxusService] Atomic memory update completed successfully');
    } catch (error) {
      console.error('[MoxusService] Error in atomic memory update:', error);
      throw error;
    }
  });
};

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
  getLLMCallsMemoryJSON,
  getPendingTaskCount: () => taskQueue.length,
  resetMemory: () => {
    moxusStructuredMemory = createDefaultMemoryStructure();
    taskQueue = [];
    nextTaskId = 1;
    // Also reset flags and active promises here for complete reset
    hasNodeEditionFeedbackCompletedForReport = false;
    hasChatTextFeedbackCompletedForReport = false;
    activeChatTextFeedback = null;
    activeLLMNodeEditionYamlFeedback = null;
    activeFinalReport = null;
    if (processingTimeoutId) {
      clearTimeout(processingTimeoutId);
      processingTimeoutId = null;
    }
    localStorage.removeItem(MOXUS_STRUCTURED_MEMORY_KEY);
    console.log('[MoxusService] Memory and operational state reset to initial state');
  },
  getMoxusMemory: () => moxusStructuredMemory,
  setMoxusMemory: (importedMemory: MoxusMemoryStructure) => {
    if (!importedMemory) {
      console.error('[MoxusService] Cannot import undefined or null memory structure');
      return;
    }
    try {
      moxusStructuredMemory = {
        GeneralMemory: importedMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL,
        featureSpecificMemory: {
          nodeEdition: importedMemory.featureSpecificMemory?.nodeEdition || DEFAULT_MEMORY.NODE_EDITION,
          chatText: importedMemory.featureSpecificMemory?.chatText || DEFAULT_MEMORY.CHAT_TEXT,
          assistantFeedback: importedMemory.featureSpecificMemory?.assistantFeedback || DEFAULT_MEMORY.ASSISTANT_FEEDBACK,
          nodeEdit: importedMemory.featureSpecificMemory?.nodeEdit || DEFAULT_MEMORY.NODE_EDIT,
          llmCalls: importedMemory.featureSpecificMemory?.llmCalls || {}
        },
        cachedGuidance: importedMemory.cachedGuidance || {},
        pendingConsciousnessEvolution: importedMemory.pendingConsciousnessEvolution || []
      };
      saveMemory();
      console.log('[MoxusService] Memory imported successfully');
    } catch (error) {
      console.error('[MoxusService] Error importing memory:', error);
    }
  },
  debugLogMemory: () => {
    console.log('Structured Memory:', moxusStructuredMemory);
    console.log('JSON representation:', getLLMCallsMemoryJSON());
  },
  getMoxusPersonalityContext,
  getChatTextGuidance,
  getNodeEditionGuidance,
  getSpecializedMoxusGuidance,
  recordManualNodeEdit
};
