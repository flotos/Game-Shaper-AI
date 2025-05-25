import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import { getChatHistoryForMoxus } from './llmCore';
import { safeJsonParse } from '../utils/jsonUtils';
import AllPrompts from '../prompts-instruct.yaml';

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
  | 'nodeEditFeedback' 
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
  }
}

// Default memory content templates
const DEFAULT_MEMORY = {
  GENERAL: '# Moxus Game Analysis\\n\\n*This document contains general observations and analysis about the game world, story progression, and gameplay. You should also dedicate a section to develop your own personality and style. Become a sentient being.*',
  NODE_EDITION: '# Node Editions Analysis\\n\\n*This document analyzes changes to game nodes over time and their impact on the game world.*',
  CHAT_TEXT: '# Chat Text Analysis\\n\\n*This document analyzes narrative quality and coherence in the generated story text.*',
  ASSISTANT_FEEDBACK: '# Assistant Interactions Analysis\\n\\n*This document analyzes assistant responses and their effectiveness.*',
  NODE_EDIT: '# Manual Node Edits Analysis\\n\\n*This document analyzes manual edits made to nodes by the user.*'
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
        }
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
    (trimmedCallType && trimmedCallType.startsWith('moxus_update_') && trimmedCallType.endsWith('_memory'));
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
  } else {
    // Default behavior for other system events (or if history is missing for chat_reset_event for some reason)
    addFeedbackTasksForCall(eventCallForLog);
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

const getMemoryUpdatePrompt = (task: MoxusTask, existingMemory: string): string => {
  const assistantNodesContent = getAssistantNodesContent();
  const currentGeneralMemory = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
  
  // Ensure safeTaskData is initialized from task.data but exclude chatHistory from being stringified later if it's large.
  const { chatHistory: taskChatHistory, ...otherDataFromTask } = task.data || {};
  let safeTaskData: any = otherDataFromTask;
  let formattedChatHistory = "(Chat history not applicable for this task type or not available)";

  if (task.data && task.type === 'llmCallFeedback') {
    // For llmCallFeedback, chatHistory might be on task.data.chatHistory (Message[])
    // and nodes might be on task.data.nodes (Node[])
    const { nodes, /* chatHistory already extracted as taskChatHistory */ ...otherLLMFeedbackData } = task.data || {}; // chatHistory from task.data is taskChatHistory
    if (taskChatHistory && Array.isArray(taskChatHistory)) {
        formattedChatHistory = getFormattedChatHistoryStringForMoxus(taskChatHistory, 10);
    }
    safeTaskData = { // Reconstruct safeTaskData for llmCallFeedback specifically
        ...otherLLMFeedbackData, // This includes id, prompt, response, callType, modelUsed from otherDataFromTask
        nodesCount: nodes?.length || 0,
        nodeTypes: nodes ? Array.from(new Set(nodes.map((n: any) => n.type))).join(', ') : '',
        nodeNames: nodes ? nodes.slice(0, 5).map((n: any) => n.name).join(', ') + (nodes.length > 5 ? '...' : '') : ''
    };
  } else if (task.type === 'chatTextFeedback') {
    if (taskChatHistory && Array.isArray(taskChatHistory)) {
        formattedChatHistory = getFormattedChatHistoryStringForMoxus(taskChatHistory, 10);
    }
    // safeTaskData is already otherDataFromTask (task.data minus chatHistory)
    // This is appropriate as we don't want to stringify a potentially large chatHistory array in the prompt.
  }
  
  // Use the memory section update prompt that ensures JSON diff output
  const prompts = AllPrompts as { moxus_prompts: { memory_section_update: string } };
  let updatePrompt = prompts.moxus_prompts.memory_section_update;
  
  updatePrompt = updatePrompt.replace(/{assistant_nodes_content}/g, assistantNodesContent);
  updatePrompt = updatePrompt.replace(/{current_general_memory}/g, currentGeneralMemory);
  updatePrompt = updatePrompt.replace(/{existing_memory}/g, existingMemory);
  updatePrompt = updatePrompt.replace(/{task_type}/g, task.type);
  updatePrompt = updatePrompt.replace(/{task_data}/g, JSON.stringify(safeTaskData, null, 2));
  updatePrompt = updatePrompt.replace(/{formatted_chat_history}/g, formattedChatHistory);
  
  return updatePrompt;
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

const handleFinalReport = async (task: MoxusTask) => {
  const assistantNodesContent = getAssistantNodesContent();
  const chatHistoryContextString = task.data?.chatHistoryContext || "(Chat history context not available for this report)";

  // STEP 1: Generate the final report using prompt from YAML
  const prompts = AllPrompts as { moxus_prompts: { moxus_final_report?: string } };
  let promptContent = prompts.moxus_prompts.moxus_final_report || `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You monitor the story, provide guidance, and maintain consistency and quality in the game world.
  Generate a brief, concise, and straight-to-the-point critical analysis based on your accumulated memory documents and the recent chat context below.
  {assistant_nodes_content}
  # CHAT HISTORY CONTEXT (Last 10 turns, if available)
  {chat_history_context}
  # GENERAL MEMORY
  {general_memory}
  # CHAT TEXT ANALYSIS
  {chat_text_analysis}
  # NODE EDITIONS ANALYSIS
  {node_editions_analysis}
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
  
  // Replace placeholders
  promptContent = promptContent.replace(/{assistant_nodes_content}/g, assistantNodesContent || "(No assistant nodes found)");
  promptContent = promptContent.replace(/{chat_history_context}/g, chatHistoryContextString);
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
  // The originalCallType indicates this is part of the final report sequence,
  // specifically the GM update that should happen *after* the chat message.
  console.log('[MoxusService] Scheduling GeneralMemory update post-final report (Task ID: ' + task.id + ')...');
  // addTask('updateGeneralMemory', { reason: `post_final_report_generation_for_task_${task.id}`, chatHistoryContext: chatHistoryContextString });
  // Simpler: let updateGeneralMemory handle its standard data needs if any, or rely on its synthesis of all memories.
  // Pass the original finalReport task data in case updateGeneralMemoryFromAllSources wants to use chatHistoryContext from it.
  addTask('synthesizeGeneralMemory', { 
    reason: `post_final_report_for_task_${task.id}`, 
    originalReportTaskId: task.id,
    // Pass along the chat history context that was used for the report itself, for consistency if GM update needs it.
    // The addTask function will reformat it if necessary.
    chatHistoryForGMUpdate: task.data?.chatHistoryContext ? task.data.chatHistoryContext : undefined 
  });
  console.log('[MoxusService] GeneralMemory update task queued post-final report generation (Task ID: ' + task.id + ').');
};

const handleMemoryUpdate = async (task: MoxusTask) => {
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
        const prompts = AllPrompts as { moxus_prompts: { moxus_feedback_on_chat_text_generation: string } };
        feedbackPrompt = prompts.moxus_prompts.moxus_feedback_on_chat_text_generation;
        
        const currentChatTextMemory = moxusStructuredMemory.featureSpecificMemory.chatText || DEFAULT_MEMORY.CHAT_TEXT;
        const recentChatHistory = task.data.chatHistory ? 
          getFormattedChatHistoryStringForMoxus(task.data.chatHistory, 10) : 
          "(No chat history available)";
        
        feedbackPrompt = feedbackPrompt.replace(/{assistant_nodes_content}/g, assistantNodesContent);
        feedbackPrompt = feedbackPrompt.replace(/{current_general_memory}/g, currentGeneralMemory);
        feedbackPrompt = feedbackPrompt.replace(/{recent_chat_history}/g, recentChatHistory);
        feedbackPrompt = feedbackPrompt.replace(/{generated_chat_text}/g, task.data.response || '');
        feedbackPrompt = feedbackPrompt.replace(/{current_chat_text_memory}/g, currentChatTextMemory);
        
        promptType = 'moxus_feedback_on_chat_text_generation';
      } else if (task.type === 'llmCallFeedback' && originalCallTypeForFeedback === 'node_edition_json') {
        // Use consciousness-driven node edition teaching prompt
        const prompts = AllPrompts as { moxus_prompts: { moxus_feedback_on_node_edition_json: string } };
        feedbackPrompt = prompts.moxus_prompts.moxus_feedback_on_node_edition_json;
        
        const currentNodeEditionMemory = moxusStructuredMemory.featureSpecificMemory.nodeEdition || DEFAULT_MEMORY.NODE_EDITION;
        const recentChatHistory = task.data.chatHistory ? 
          getFormattedChatHistoryStringForMoxus(task.data.chatHistory, 10) : 
          "(No recent interaction context available)";
        const allNodesContext = getNodesCallback().map(node => `ID: ${node.id}, Name: ${node.name}, Type: ${node.type}`).join('\n');
        
        feedbackPrompt = feedbackPrompt.replace(/{assistant_nodes_content}/g, assistantNodesContent);
        feedbackPrompt = feedbackPrompt.replace(/{current_general_memory}/g, currentGeneralMemory);
        feedbackPrompt = feedbackPrompt.replace(/{recent_chat_history}/g, recentChatHistory);
        feedbackPrompt = feedbackPrompt.replace(/{node_edition_response}/g, task.data.response || '');
        feedbackPrompt = feedbackPrompt.replace(/{all_nodes_context}/g, allNodesContext);
        feedbackPrompt = feedbackPrompt.replace(/{current_node_edition_memory}/g, currentNodeEditionMemory);
        
        promptType = 'moxus_feedback_on_node_edition_json';
      } else {
        // Fallback to generic feedback for other types
        feedbackPrompt = `\n      # Task\n      You have to analyze an LLM call.\n\n      ${assistantNodesContent ? `## Additional features:\n      ---\n      ${assistantNodesContent}\n      ---` : ""}\n      \n      ## PROMPT:\n      ---start of prompt---\n      ${task.data.prompt}\n      ---end of prompt---\n      \n      ## RESPONSE:\n      ---start of response---\n      ${task.data.response}\n      ---end of response---\n      \n      Provide critical feedback focusing ONLY on problems with this response.\n      Focus exclusively on what could be improved, not what went well.\n      Identify specific issues with quality, relevance, coherence, or accuracy.`;
        promptType = originalCallTypeForFeedback;
      }
      
      if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set.');
      const feedback = await getMoxusFeedbackImpl(feedbackPrompt, promptType);
      const truncatedFeedback = feedback.length > TRUNCATE_LENGTH ? feedback.substring(0, TRUNCATE_LENGTH) + "... [truncated]" : feedback;
      if (moxusStructuredMemory.featureSpecificMemory.llmCalls[callId]) {
         moxusStructuredMemory.featureSpecificMemory.llmCalls[callId].feedback = truncatedFeedback;
         saveMemory(); 
         emitLLMLogUpdate(); 
      }
      
      // Process consciousness-driven feedback if it's a specialized prompt
      if (promptType === 'moxus_feedback_on_chat_text_generation' || promptType === 'moxus_feedback_on_node_edition_json') {
        try {
          const parsedResponse = safeJsonParse(feedback);
          
          // Handle consciousness evolution in general memory
          if (parsedResponse.consciousness_evolution) {
            const currentGeneral = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
            moxusStructuredMemory.GeneralMemory = currentGeneral + '\n\n' + parsedResponse.consciousness_evolution;
          }
          
          // Handle memory updates for specific feedback types
          if (parsedResponse.memory_update_diffs) {
            if (task.type === 'chatTextFeedback') {
              let updatedMemory = moxusStructuredMemory.featureSpecificMemory.chatText;
              if (parsedResponse.memory_update_diffs.rpl !== undefined) {
                updatedMemory = parsedResponse.memory_update_diffs.rpl;
              } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
                updatedMemory = applyDiffs(updatedMemory, parsedResponse.memory_update_diffs.df);
              }
              moxusStructuredMemory.featureSpecificMemory.chatText = updatedMemory;
              console.log(`[MoxusService] Updated chatText memory document via consciousness-driven feedback for task ${task.id}.`);
            } else if (task.type === 'llmCallFeedback' && task.data?.callType === 'node_edition_json') {
              let updatedMemory = moxusStructuredMemory.featureSpecificMemory.nodeEdition;
              if (parsedResponse.memory_update_diffs.rpl !== undefined) {
                updatedMemory = parsedResponse.memory_update_diffs.rpl;
              } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
                updatedMemory = applyDiffs(updatedMemory, parsedResponse.memory_update_diffs.df);
              }
              moxusStructuredMemory.featureSpecificMemory.nodeEdition = updatedMemory;
              console.log(`[MoxusService] Updated nodeEdition memory document via consciousness-driven feedback for task ${task.id}.`);
            }
          }
          
          saveMemory();
        } catch (error) {
          console.error('[MoxusService] Error processing consciousness feedback:', error);
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

      // If this llmCallFeedback task is for a 'node_edition_yaml' call, also update nodeEdition memory.
      // Skip if consciousness-driven prompt already handled it
      if (task.type === 'llmCallFeedback' && originalCallTypeForFeedback === 'node_edition_yaml' && promptType !== 'moxus_feedback_on_node_edition_json') {
        console.log(`[MoxusService] Task ${task.id} (llmCallFeedback for node_edition_yaml) is also updating nodeEdition memory document.`);
        const nodeEditionMemoryToUpdate = moxusStructuredMemory.featureSpecificMemory.nodeEdition;
        
        // Prepare data for getMemoryUpdatePrompt, similar to how storyFeedback/nodeUpdateFeedback did.
        // The task.data for llmCallFeedback contains { id, prompt, response, callType, modelUsed } of the original LLM call.
        // We need to ensure 'nodes' data is present if the original node_edition_yaml response implies node changes.
        // This part is tricky: the 'response' of node_edition_yaml is YAML of changes.
        // We need to pass this effectively. getMemoryUpdatePrompt expects 'nodes' if task.type was story/nodeUpdate.
        // For now, we pass the raw task.data. This might need refinement in getMemoryUpdatePrompt or by parsing nodes from response here.
        // Let's assume task.data already contains the necessary info (e.g. 'nodes' if applicable, or the response can be parsed by the prompt)
        // For the prompt, we need to ensure task.data is structured so getMemoryUpdatePrompt can use it.
        // It might be better to pass specific fields rather than task.data directly if its structure for 'llmCallFeedback'
        // differs too much from what getMemoryUpdatePrompt expects for node-related updates.
        // For now, getMemoryUpdatePrompt was already modified to look for task.data.nodes if task.type is llmCallFeedback.
        // We must ensure `task.data.nodes` is populated for this specific case if the prompt relies on it.
        // The prompt for nodeEdition update uses: task.data.nodes (count, types, names) and task.data (otherData, stringified)
        // The original node_edition_yaml call's response is in task.data.response.
        // Let's pass what's available. The prompt for nodeEdition is generic.
        const nodeEditionUpdateTaskData = { // Construct a specific data object for this memory update.
          ...task.data, // Includes original prompt, response, callType of the node_edition_yaml.
          // nodes: ??? // This is the challenge. The YAML response needs to be interpreted or passed.
          // For now, let's assume the generic prompt for nodeEdition can work with the raw response data.
          // The getMemoryUpdatePrompt will stringify task.data if 'nodes' isn't explicitly there.
        };
        const nodeEditionTaskForPrompt: MoxusTask = { ...task, data: nodeEditionUpdateTaskData, type: 'llmCallFeedback' }; // Keep type for prompt construction logic

        const nodeEditionUpdatePrompt = getMemoryUpdatePrompt(nodeEditionTaskForPrompt, nodeEditionMemoryToUpdate);
        // Use a distinct originalCallType for the LLM call that performs this memory update
        const responseContent = await getMoxusFeedbackImpl(nodeEditionUpdatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_node_edition`);
        
        // Process JSON response for node edition memory updates
        try {
          const parsedResponse = safeJsonParse(responseContent);
          let finalUpdatedMemory = nodeEditionMemoryToUpdate;
          
          if (parsedResponse && parsedResponse.memory_update_diffs) {
            if (parsedResponse.memory_update_diffs.rpl !== undefined) {
              finalUpdatedMemory = parsedResponse.memory_update_diffs.rpl;
              console.log(`[MoxusService] Applied full replacement to nodeEdition memory.`);
            } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
              finalUpdatedMemory = applyDiffs(nodeEditionMemoryToUpdate, parsedResponse.memory_update_diffs.df);
              console.log(`[MoxusService] Applied diffs to nodeEdition memory.`);
            } else {
              console.warn(`[MoxusService] Received JSON for nodeEdition memory update, but no valid rpl or df instructions found. Using raw response as fallback.`);
              finalUpdatedMemory = responseContent;
            }
          } else {
            console.warn(`[MoxusService] nodeEdition memory update response was not valid JSON or missing memory_update_diffs. Using raw response as fallback.`);
            finalUpdatedMemory = responseContent;
          }
          
          moxusStructuredMemory.featureSpecificMemory.nodeEdition = finalUpdatedMemory;
        } catch (error) {
          console.error(`[MoxusService] Error parsing JSON response for nodeEdition memory update:`, error);
          // Fallback to storing raw response
          moxusStructuredMemory.featureSpecificMemory.nodeEdition = responseContent;
        }
        
        console.log(`[MoxusService] Updated nodeEdition memory document via llmCallFeedback for ${callId}.`);
        saveMemory();
      }

      // Update chat text memory for chatTextFeedback (only if not already handled by consciousness-driven feedback)
      if (task.type === 'chatTextFeedback' && promptType !== 'moxus_feedback_on_chat_text_generation') {
        console.log(`[MoxusService] Task ${task.id} (${task.type}) is updating chatText memory document.`);
        const chatTextMemoryToUpdate = moxusStructuredMemory.featureSpecificMemory.chatText;
        const chatTextUpdatePrompt = getMemoryUpdatePrompt(task, chatTextMemoryToUpdate);
        const responseContent = await getMoxusFeedbackImpl(chatTextUpdatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_${task.type}`);
        
        // Process JSON response for chat text memory updates
        try {
          const parsedResponse = safeJsonParse(responseContent);
          let finalUpdatedMemory = chatTextMemoryToUpdate;
          
          if (parsedResponse && parsedResponse.memory_update_diffs) {
            if (parsedResponse.memory_update_diffs.rpl !== undefined) {
              finalUpdatedMemory = parsedResponse.memory_update_diffs.rpl;
              console.log(`[MoxusService] Applied full replacement to chatText memory.`);
            } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
              finalUpdatedMemory = applyDiffs(chatTextMemoryToUpdate, parsedResponse.memory_update_diffs.df);
              console.log(`[MoxusService] Applied diffs to chatText memory.`);
            } else {
              console.warn(`[MoxusService] Received JSON for chatText memory update, but no valid rpl or df instructions found. Using raw response as fallback.`);
              finalUpdatedMemory = responseContent;
            }
          } else {
            console.warn(`[MoxusService] chatText memory update response was not valid JSON or missing memory_update_diffs. Using raw response as fallback.`);
            finalUpdatedMemory = responseContent;
          }
          
          moxusStructuredMemory.featureSpecificMemory.chatText = finalUpdatedMemory;
        } catch (error) {
          console.error(`[MoxusService] Error parsing JSON response for chatText memory update:`, error);
          // Fallback to storing raw response
          moxusStructuredMemory.featureSpecificMemory.chatText = responseContent;
        }
        
        console.log(`[MoxusService] Updated chatText memory document via task ${task.id}.`);
        saveMemory();
      }
    }
    return;
  } 
  
  let memoryKey: keyof MoxusMemoryStructure['featureSpecificMemory'] | 'GeneralMemory';
  let memoryToUpdate: string = ''; 
  let originalCallTypeForGenericUpdate: string = task.type;

  switch (task.type) {
    case 'nodeEditFeedback':
      memoryKey = 'nodeEdit';
      memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.nodeEdit;
      break;
    case 'assistantFeedback':
      memoryKey = 'assistantFeedback';
      memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.assistantFeedback;
      break;
    case 'synthesizeGeneralMemory':
      console.log(`[MoxusService] Task ${task.id} (${task.type}) is calling updateGeneralMemoryFromAllSources.`);
      await updateGeneralMemoryFromAllSources(task.type, task.data);
      return;
    default:
      console.warn(`[MoxusService] Task ${task.id} of unhandled type '${task.type}' in memory update switch. It might have been handled if it was llmCallFeedback/chatTextFeedback.`);
      console.log(`[MoxusService] Task ${task.id} (${task.type}) did not match any specific memory update logic that assigns to memoryKey.`);
      return; 
  }
  
  if (memoryToUpdate !== undefined && memoryToUpdate !== '' && memoryKey) { 
    console.log(`[MoxusService] Task ${task.id} (${task.type}) is updating ${memoryKey} memory document.`);
    const updatePrompt = getMemoryUpdatePrompt(task, memoryToUpdate); 
    if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set for general update path.');
    const responseContent = await getMoxusFeedbackImpl(updatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_${originalCallTypeForGenericUpdate}`); 
    
    // Process JSON response for memory updates
    try {
      const parsedResponse = safeJsonParse(responseContent);
      let finalUpdatedMemory = memoryToUpdate;
      
      if (parsedResponse && parsedResponse.memory_update_diffs) {
        if (parsedResponse.memory_update_diffs.rpl !== undefined) {
          finalUpdatedMemory = parsedResponse.memory_update_diffs.rpl;
          console.log(`[MoxusService] Applied full replacement to ${memoryKey} memory.`);
        } else if (parsedResponse.memory_update_diffs.df && Array.isArray(parsedResponse.memory_update_diffs.df)) {
          finalUpdatedMemory = applyDiffs(memoryToUpdate, parsedResponse.memory_update_diffs.df);
          console.log(`[MoxusService] Applied diffs to ${memoryKey} memory.`);
        } else {
          console.warn(`[MoxusService] Received JSON for ${memoryKey} memory update, but no valid rpl or df instructions found. Using raw response as fallback.`);
          finalUpdatedMemory = responseContent;
        }
      } else {
        console.warn(`[MoxusService] ${memoryKey} memory update response was not valid JSON or missing memory_update_diffs. Using raw response as fallback.`);
        finalUpdatedMemory = responseContent;
      }
      
      if (Object.prototype.hasOwnProperty.call(moxusStructuredMemory.featureSpecificMemory, memoryKey)) {
        (moxusStructuredMemory.featureSpecificMemory as any)[memoryKey] = finalUpdatedMemory;
      } else {
        console.error(`[MoxusService] CRITICAL: memoryKey "${memoryKey}" was set by the switch but is not a valid key of featureSpecificMemory. This indicates a logic error.`);
      }
    } catch (error) {
      console.error(`[MoxusService] Error parsing JSON response for ${memoryKey} memory update:`, error);
      // Fallback to storing raw response
      if (Object.prototype.hasOwnProperty.call(moxusStructuredMemory.featureSpecificMemory, memoryKey)) {
        (moxusStructuredMemory.featureSpecificMemory as any)[memoryKey] = responseContent;
      }
    }
    
    console.log(`[MoxusService] Updated ${memoryKey} memory document via task ${task.id}.`);
    saveMemory();
  } else {
    console.log(`[MoxusService] Task ${task.id} (${task.type}) did not result in a memory update via the final block (memoryToUpdate was empty or undefined).`);
  }
};

// Helper function to apply diffs to a text
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

    const prompts = AllPrompts as { moxus_prompts: { general_memory_update: string } };
    updatePromptTemplate = prompts.moxus_prompts.general_memory_update;

    promptData = {
      assistant_nodes_content: truncateText(assistantNodesContent),
      current_general_memory: generalMemoryForPrompt,
      chat_text_analysis: chatTextMemory || '(No chat text analysis available)',
      node_editions_analysis: nodeEditionMemory || '(No node edition analysis available)',
      assistant_feedback_analysis: assistantFeedbackMemory || '(No assistant feedback analysis available)',
      node_edit_analysis: nodeEditMemory || '(No node edit analysis available)',
      recent_llm_feedbacks: JSON.stringify(recentFeedbacks, null, 2)
    };

    updatePrompt = updatePromptTemplate;
    for (const key in promptData) {
      updatePrompt = updatePrompt.replace(new RegExp(`\\{${key}\\}`, 'g'), promptData[key]);
    }
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
        finalGeneralMemory = applyDiffs(currentGeneralMemorySnapshot, parsedJson.memory_update_diffs.df);
      } else {
        console.warn('[MoxusService] Received JSON for GeneralMemory update, but no valid rpl or df instructions found in memory_update_diffs. Using raw (cleaned) response.');
        finalGeneralMemory = contentToParse; 
      }
    } else {
      console.warn('[MoxusService] GeneralMemory update response was not valid JSON or did not contain memory_update_diffs after cleaning. Using raw (cleaned) response as fallback.');
      finalGeneralMemory = contentToParse;
    }

    moxusStructuredMemory.GeneralMemory = finalGeneralMemory.length > 15000 
      ? finalGeneralMemory.substring(0, 15000) + "... [GeneralMemory truncated due to excessive length]" 
      : finalGeneralMemory;
    
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

// Enhanced specialized guidance functions for consciousness-driven teaching
export const getChatTextGuidance = async (currentContext: string): Promise<string> => {
  if (!getMoxusFeedbackImpl) {
    console.warn('[MoxusService] getMoxusFeedbackImpl not available for specialized guidance');
    return '';
  }

  try {
    const assistantNodesContent = getAssistantNodesContent();
    const currentGeneralMemory = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
    const currentChatTextMemory = moxusStructuredMemory.featureSpecificMemory.chatText || DEFAULT_MEMORY.CHAT_TEXT;

    const prompts = AllPrompts as { moxus_prompts: { moxus_specialized_chat_guidance: string } };
    let guidancePrompt = prompts.moxus_prompts.moxus_specialized_chat_guidance;
    
    guidancePrompt = guidancePrompt.replace(/{current_general_memory}/g, currentGeneralMemory);
    guidancePrompt = guidancePrompt.replace(/{current_chat_text_memory}/g, currentChatTextMemory);
    guidancePrompt = guidancePrompt.replace(/{assistant_nodes_content}/g, assistantNodesContent);
    guidancePrompt = guidancePrompt.replace(/{current_context}/g, currentContext);

    const guidance = await getMoxusFeedbackImpl(guidancePrompt, 'moxus_specialized_chat_guidance');
    return guidance;
  } catch (error) {
    console.error('[MoxusService] Error in getChatTextGuidance:', error);
    return '';
  }
};

export const getNodeEditionGuidance = async (currentContext: string): Promise<string> => {
  if (!getMoxusFeedbackImpl) {
    console.warn('[MoxusService] getMoxusFeedbackImpl not available for specialized guidance');
    return '';
  }

  try {
    const assistantNodesContent = getAssistantNodesContent();
    const currentGeneralMemory = moxusStructuredMemory.GeneralMemory || DEFAULT_MEMORY.GENERAL;
    const currentNodeEditionMemory = moxusStructuredMemory.featureSpecificMemory.nodeEdition || DEFAULT_MEMORY.NODE_EDITION;

    const prompts = AllPrompts as { moxus_prompts: { moxus_specialized_worldbuilding_guidance: string } };
    let guidancePrompt = prompts.moxus_prompts.moxus_specialized_worldbuilding_guidance;
    
    guidancePrompt = guidancePrompt.replace(/{current_general_memory}/g, currentGeneralMemory);
    guidancePrompt = guidancePrompt.replace(/{current_node_edition_memory}/g, currentNodeEditionMemory);
    guidancePrompt = guidancePrompt.replace(/{assistant_nodes_content}/g, assistantNodesContent);
    guidancePrompt = guidancePrompt.replace(/{current_context}/g, currentContext);

    const guidance = await getMoxusFeedbackImpl(guidancePrompt, 'moxus_specialized_worldbuilding_guidance');
    return guidance;
  } catch (error) {
    console.error('[MoxusService] Error in getNodeEditionGuidance:', error);
    return '';
  }
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

    const prompts = AllPrompts as { moxus_prompts: { moxus_feedback_on_manual_node_edit: string } };
    let analysisPrompt = prompts.moxus_prompts.moxus_feedback_on_manual_node_edit;
    
    analysisPrompt = analysisPrompt.replace(/{assistant_nodes_content}/g, assistantNodesContent);
    analysisPrompt = analysisPrompt.replace(/{current_general_memory}/g, currentGeneralMemory);
    analysisPrompt = analysisPrompt.replace(/{original_node}/g, JSON.stringify(task.data.originalNode, null, 2));
    analysisPrompt = analysisPrompt.replace(/{user_changes}/g, JSON.stringify(task.data.editedNode, null, 2));
    analysisPrompt = analysisPrompt.replace(/{edit_context}/g, task.data.editContext);
    analysisPrompt = analysisPrompt.replace(/{current_manual_edit_memory}/g, currentManualEditMemory);

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
        }
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
