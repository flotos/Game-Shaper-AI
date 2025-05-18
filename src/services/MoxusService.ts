import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import yaml from 'js-yaml';
import { getChatHistoryForMoxus } from './llmCore';
import AllPrompts from '../prompts-instruct.yaml'; // Assuming YAML can be imported like this

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
export const initiateLLMCallRecord = (id: string, callType: string, modelUsed: string, promptContent: string) => {
  const startTime = new Date();
  const truncatedPrompt = promptContent.length > 5000 ? promptContent.substring(0, 5000) + "... [truncated]" : promptContent;
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
  const truncatedResponse = responseContent.length > 5000 ? responseContent.substring(0, 5000) + "... [truncated]" : responseContent;
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
  
  const isMoxusInternalProcessingCall = call.callType === 'moxus_feedback_generation' || call.callType === 'moxus_finalreport' || call.callType === 'INTERNAL_FINAL_REPORT_GENERATION_STEP' || (call.callType && call.callType.startsWith('moxus_feedback_on_')) || (call.callType && call.callType.startsWith('moxus_update_') && call.callType.endsWith('_memory'));
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
  const taskType = (promptForTask.includes('Generate a detailed chapter') || promptForTask.includes('Generate appropriate dialogue') || (call.id && call.id.startsWith('chatText-')) || promptForTask.includes('# TASK:\\nYou are the Game Engine of a Node-base game')) ? 'chatTextFeedback' : 'llmCallFeedback';
  console.log(`[MoxusService] Adding ${taskType} feedback task for completed call ID: ${call.id}, original callType: ${call.callType}`);
  addTask(taskType, { id: call.id, prompt: promptForTask, response: responseForTask, callType: call.callType, modelUsed: call.modelUsed });
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
  const truncatedPrompt = eventPrompt.length > 5000 ? eventPrompt.substring(0, 5000) + "..." : eventPrompt;
  const truncatedResponse = eventResponse.length > 5000 ? eventResponse.substring(0, 5000) + "..." : eventResponse;
  
  const eventCallForLog: LLMCall = { id: eventId, prompt: truncatedPrompt, response: truncatedResponse, timestamp: now, status: 'completed', startTime: now, endTime: now, callType: eventType, modelUsed: 'N/A', duration: 0 };
  moxusStructuredMemory.featureSpecificMemory.llmCalls[eventId] = eventCallForLog;
  saveMemory();
  emitLLMLogUpdate(); 
  console.log(`[MoxusService] Recorded internal system event: ${eventId} (${eventType})`);

  if (eventType === "chat_reset_event" && eventContextData?.previousChatHistory) {
    console.log(`[MoxusService] Chat reset event detected. Queueing updateGeneralMemory task with previous chat history.`);
    const previousChatHistoryString = getFormattedChatHistoryStringForMoxus(eventContextData.previousChatHistory, 20); // Use more turns for this analysis
    addTask('updateGeneralMemory', { 
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
  console.log('[MoxusService] Initializing...');
  getNodesCallback = getNodes;
  addMessageCallback = addMessage;
  getChatHistoryCallback = getChatHistory;
  loadMemory();
  triggerProcessing();
  console.log('[MoxusService] Initialized with callbacks including getChatHistory.');
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
  } else if (type === 'finalReport' || type === 'updateGeneralMemory') {
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
  let safeTaskData: any;
  let formattedChatHistory = "(Chat history not applicable for this task type or not available)";

  if (task.data && task.data.nodes && task.type === 'llmCallFeedback') {
    const { nodes, chatHistory, ...otherData } = task.data || {};
    if (chatHistory) {
      formattedChatHistory = getFormattedChatHistoryStringForMoxus(chatHistory, 10);
    }
    safeTaskData = { 
      ...otherData,
      nodesCount: nodes?.length || 0, 
      nodeTypes: nodes ? Array.from(new Set(nodes.map((n: any) => n.type))).join(', ') : '', 
      nodeNames: nodes ? nodes.slice(0, 5).map((n: any) => n.name).join(', ') + (nodes.length > 5 ? '...' : '') : '' 
    };
  } else {
    // Deep clone task.data to avoid modifying the original task object and to work on it
    safeTaskData = JSON.parse(JSON.stringify(task.data)); 

    if (task.type === 'nodeEditFeedback') {
      // Sanitize 'before' node data if it exists and is an object
      if (safeTaskData.before && typeof safeTaskData.before === 'object') {
        delete safeTaskData.before.image;
      }
      // Sanitize 'after' node data if it exists and is an object
      if (safeTaskData.after && typeof safeTaskData.after === 'object') {
        delete safeTaskData.after.image;
      }
    }
    
    const MAX_FIELD_LENGTH = 5000;
    const truncateField = (obj: any, fieldName: string) => {
      if (obj && typeof obj[fieldName] === 'string' && obj[fieldName].length > MAX_FIELD_LENGTH) {
        obj[fieldName] = obj[fieldName].substring(0, MAX_FIELD_LENGTH) + "... [truncated]";
      }
    };
    if (safeTaskData && safeTaskData.before) {
      truncateField(safeTaskData.before, 'longDescription');
    }
    if (safeTaskData && safeTaskData.after) {
      truncateField(safeTaskData.after, 'longDescription');
    }
    const stringifiedData = JSON.stringify(safeTaskData);
    if (stringifiedData.length > 5000 && typeof task.data === 'string') {
        safeTaskData = task.data.substring(0, 4950) + "... [task.data string truncated]";
    }
  }
  
  return `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You monitor the story, provide guidance, and maintain consistency and quality in the game world.
  Your goal is to maintain a brief record of critical observations that will highlight problems in the game.
  
  ${assistantNodesContent ? `Additional features:\n  ---\n  ${assistantNodesContent}\n  ---` : ""}
  
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
  let didLaunchOrProcessTaskThisCycle = false;

  if (taskQueue.length === 0) {
    console.log('[MoxusService] Queue empty. Processor idle.');
    return;
  }

  // 1. Attempt to launch finalReport (Highest priority)
  if (!activeFinalReport && taskQueue[0]?.type === 'finalReport') {
    const task = taskQueue.shift()!;
    console.log(`[MoxusService] Launching task: ${task.type} (ID: ${task.id})`);
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
                // Only set the flag if it was specifically for node_edition_yaml, as this is what final report depends on.
                if (task.data?.callType === 'node_edition_yaml') {
                    hasNodeEditionFeedbackCompletedForReport = true; 
                    console.log('[MoxusService] LLMCallFeedback for node_edition_yaml completed, flag set for final report.');
                    checkAndTriggerFinalReport();
                }
                triggerProcessing(); 
            });
    }
  }

  // 6. Process "other" tasks (now block 4)
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

  // STEP 1: Generate the final report (MOVED GM UPDATE TO AFTER)
  const promptContent = `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You monitor the story, provide guidance, and maintain consistency and quality in the game world.
  Generate a brief, concise, and straight-to-the-point critical analysis based on your accumulated memory documents and the recent chat context below.
  ${assistantNodesContent ? `Additional features:\n  ---\n  ${assistantNodesContent}\n  ---` : ""}
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
  addTask('updateGeneralMemory', { 
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
      const feedbackPrompt = `\n      # Task\n      You have to analyze an LLM call.\n\n      ${assistantNodesContent ? `## Additional features:\n      ---\n      ${assistantNodesContent}\n      ---` : ""}\n      \n      ## PROMPT:\n      ---start of prompt---\n      ${task.data.prompt}\n      ---end of prompt---\n      \n      ## RESPONSE:\n      ---start of response---\n      ${task.data.response}\n      ---end of response---\n      \n      Provide critical feedback focusing ONLY on problems with this response.\n      Focus exclusively on what could be improved, not what went well.\n      Identify specific issues with quality, relevance, coherence, or accuracy.`;
      if (!getMoxusFeedbackImpl) throw new Error('getMoxusFeedback implementation not set.');
      const feedback = await getMoxusFeedbackImpl(feedbackPrompt, originalCallTypeForFeedback);
      const truncatedFeedback = feedback.length > 2000 ? feedback.substring(0, 2000) + "... [truncated]" : feedback;
      if (moxusStructuredMemory.featureSpecificMemory.llmCalls[callId]) {
         moxusStructuredMemory.featureSpecificMemory.llmCalls[callId].feedback = truncatedFeedback;
         saveMemory(); 
         emitLLMLogUpdate(); 
      }
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

      // If this llmCallFeedback task is for a 'node_edition_yaml' call, also update nodeEdition memory.
      if (task.type === 'llmCallFeedback' && originalCallTypeForFeedback === 'node_edition_yaml') {
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
        const updatedNodeEditionMemory = await getMoxusFeedbackImpl(nodeEditionUpdatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_node_edition`);
        moxusStructuredMemory.featureSpecificMemory.nodeEdition = updatedNodeEditionMemory;
        console.log(`[MoxusService] Updated nodeEdition memory document via llmCallFeedback for ${callId}.`);
        saveMemory();
      }

      if (task.type === 'chatTextFeedback') {
        console.log(`[MoxusService] Task ${task.id} (${task.type}) is updating chatText memory document.`);
        const chatTextMemoryToUpdate = moxusStructuredMemory.featureSpecificMemory.chatText;
        const chatTextUpdatePrompt = getMemoryUpdatePrompt(task, chatTextMemoryToUpdate);
        const updatedChatTextMemory = await getMoxusFeedbackImpl(chatTextUpdatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_${task.type}`);
        moxusStructuredMemory.featureSpecificMemory.chatText = updatedChatTextMemory;
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
    case 'updateGeneralMemory':
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
    const updatedMemory = await getMoxusFeedbackImpl(updatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_${originalCallTypeForGenericUpdate}`); 
    if (Object.prototype.hasOwnProperty.call(moxusStructuredMemory.featureSpecificMemory, memoryKey)) {
      (moxusStructuredMemory.featureSpecificMemory as any)[memoryKey] = updatedMemory;
    } else {
      console.error(`[MoxusService] CRITICAL: memoryKey "${memoryKey}" was set by the switch but is not a valid key of featureSpecificMemory. This indicates a logic error.`);
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
    if (!prev_txt) continue; // Skip if prev_txt is empty

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

  if (originalCallTypeForThisUpdate === 'updateGeneralMemory' && taskData?.reason === "chat_reset_event" && taskData?.previousChatHistoryString && taskData?.eventDetails) {
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
    console.log('[MoxusService] Using standard synthesis prompt for GeneralMemory update (expecting YAML diff).');
    const recentFeedbacks = Object.entries(moxusStructuredMemory.featureSpecificMemory.llmCalls)
      .sort((a, b) => new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime()).reverse().slice(0, 5)
      .map(([id, call]) => ({ id, feedback: call.feedback || "No feedback available" }));
    
    const truncateText = (text: string, maxLength: number = 2000) => text && text.length > maxLength ? text.substring(0, maxLength) + "... [truncated]" : text;
    
    const generalMemoryForPrompt = truncateText(currentGeneralMemorySnapshot); 
    const chatTextMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.chatText);
    const nodeEditionMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.nodeEdition);
    const assistantFeedbackMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.assistantFeedback);
    const nodeEditMemory = truncateText(moxusStructuredMemory.featureSpecificMemory.nodeEdit);

    const prompts = AllPrompts as { moxus_prompts: { general_memory_update: string } };
    updatePromptTemplate = prompts.moxus_prompts.general_memory_update;

    promptData = {
      assistant_nodes_content: truncateText(assistantNodesContent, 1000),
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
  const yamlResponse = await getMoxusFeedbackImpl(updatePrompt, `INTERNAL_MEMORY_UPDATE_FOR_${originalCallTypeForThisUpdate}`);
  
  let contentToParse = yamlResponse.trim();
  const yamlFenceStart = "```yaml";
  const yamlFenceEnd = "```";

  if (contentToParse.startsWith(yamlFenceStart)) {
    contentToParse = contentToParse.substring(yamlFenceStart.length).trimStart();
    if (contentToParse.endsWith(yamlFenceEnd)) {
      contentToParse = contentToParse.substring(0, contentToParse.length - yamlFenceEnd.length).trimEnd();
    }
  }
  contentToParse = contentToParse.trim();

  try {
    const parsedYaml = yaml.load(contentToParse) as any;
    let finalGeneralMemory = currentGeneralMemorySnapshot;

    if (parsedYaml && parsedYaml.memory_update_diffs) {
      if (parsedYaml.memory_update_diffs.rpl !== undefined) {
        console.log('[MoxusService] Applying full replacement to GeneralMemory.');
        finalGeneralMemory = parsedYaml.memory_update_diffs.rpl;
      } else if (parsedYaml.memory_update_diffs.df && Array.isArray(parsedYaml.memory_update_diffs.df)) {
        console.log('[MoxusService] Applying diffs to GeneralMemory.');
        finalGeneralMemory = applyDiffs(currentGeneralMemorySnapshot, parsedYaml.memory_update_diffs.df);
      } else {
        console.warn('[MoxusService] Received YAML for GeneralMemory update, but no valid rpl or df instructions found in memory_update_diffs. Using raw (cleaned) response.');
        finalGeneralMemory = contentToParse; 
      }
    } else {
      console.warn('[MoxusService] GeneralMemory update response was not valid YAML or did not contain memory_update_diffs after cleaning. Using raw (cleaned) response as fallback.');
      finalGeneralMemory = contentToParse;
    }

    moxusStructuredMemory.GeneralMemory = finalGeneralMemory.length > 15000 
      ? finalGeneralMemory.substring(0, 15000) + "... [GeneralMemory truncated due to excessive length]" 
      : finalGeneralMemory;
    
    console.log('[MoxusService] Updated GeneralMemory');
    saveMemory();

  } catch (error) {
    console.error('[MoxusService] Error processing YAML response for GeneralMemory update:', error);
    console.warn('[MoxusService] Falling back to storing raw (cleaned) response in GeneralMemory due to YAML processing error.');
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

export const getLLMCallsMemoryYAML = (): string => {
  try {
    const memoryForYaml = {
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
    return yaml.dump(memoryForYaml, { lineWidth: 100, noRefs: true, quotingType: '"' });
  } catch (error) {
    console.error('[MoxusService] Error generating YAML:', error);
    return "Error generating memory YAML";
  }
};

export const clearLLMLogEntries = (): void => {
  moxusStructuredMemory.featureSpecificMemory.llmCalls = {};
  saveMemory();
  emitLLMLogUpdate();
  console.log('[MoxusService] LLM log entries cleared.');
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
  getLLMCallsMemoryYAML,
  getPendingTaskCount: () => taskQueue.length,
  resetMemory: () => {
    moxusStructuredMemory = createDefaultMemoryStructure();
    taskQueue = [];
    nextTaskId = 1;
    localStorage.removeItem(MOXUS_STRUCTURED_MEMORY_KEY);
    console.log('[MoxusService] Memory reset to initial state');
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
    console.log('YAML representation:', getLLMCallsMemoryYAML());
  },
  getMoxusPersonalityContext
};
