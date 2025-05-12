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

// LLM Call interface structure
interface LLMCall {
  prompt: string;
  response: string;
  timestamp: Date;
  feedback?: string;
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
let isProcessing = false;
let taskQueue: MoxusTask[] = [];
let nextTaskId = 1;
let getNodesCallback: () => Node[] = () => []; // Callback to get current nodes
let addMessageCallback: (message: Message) => void = () => {}; // Callback to add chat message

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
      
      console.log('[MoxusService] Loaded structured memory from localStorage.');
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
export const recordLLMCall = (id: string, prompt: string, response: string) => {
  // Truncate the prompt and response to reduce memory usage
  // Limit to approximately 1000 characters for each
  const truncatedPrompt = prompt.length > 1000 ? prompt.substring(0, 1000) + "... [truncated]" : prompt;
  const truncatedResponse = response.length > 1000 ? response.substring(0, 1000) + "... [truncated]" : response;
  
  // Create the call object
  const call: LLMCall = {
    prompt: truncatedPrompt,
    response: truncatedResponse,
    timestamp: new Date()
  };
  
  // Store in the structured memory
  moxusStructuredMemory.featureSpecificMemory.llmCalls[id] = call;
  
  // Check for chat text generation prompts (match patterns seen in the LLMService)
  if (prompt.includes('Generate a detailed chapter') || 
      prompt.includes('Generate appropriate dialogue') || 
      id.startsWith('chatText-') || 
      prompt.includes('# TASK:\nYou are the Game Engine of a Node-base game')) {
    console.log(`[MoxusService] Adding chatText feedback task for: ${id}`);
    // Add to special task queue for chat text feedback
    addTask('chatTextFeedback', {
      id: id,
      prompt: truncatedPrompt,
      response: truncatedResponse
    });
  }
  // Add llmCallFeedback task for all other types of calls
  else {
    addTask('llmCallFeedback', {
      id: id,
      prompt: truncatedPrompt,
      response: truncatedResponse
    });
  }
  
  // Clean up old LLM calls to prevent memory growth
  const llmCalls = moxusStructuredMemory.featureSpecificMemory.llmCalls;
  const callIds = Object.keys(llmCalls);
  
  // Keep only the 50 most recent calls
  if (callIds.length > 50) {
    const sortedIds = callIds.sort((a, b) => {
      const timeA = new Date(llmCalls[a].timestamp).getTime();
      const timeB = new Date(llmCalls[b].timestamp).getTime();
      return timeB - timeA; // Sort descending (newest first)
    });
    
    // Delete older calls beyond the 50 most recent
    for (let i = 50; i < sortedIds.length; i++) {
      delete llmCalls[sortedIds[i]];
    }
    
    console.log(`[MoxusService] Cleaned up ${sortedIds.length - 50} old LLM calls`);
  }
  
  saveMemory();
  console.log(`[MoxusService] Recorded LLM call: ${id}`);
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

// Modified prompt template for memory updating tasks
const getMemoryUpdatePrompt = (task: MoxusTask, existingMemory: string): string => {
  const assistantNodesContent = getAssistantNodesContent();
  
  return `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You monitor the story, provide guidance, and maintain consistency and quality in the game world.
  Your goal is to maintain a brief record of critical observations that will highlight problems in the game.
  
  ${assistantNodesContent ? `Additional features:
  ---
  ${assistantNodesContent}
  ---` : ""}
  
  # CURRENT MEMORY DOCUMENT
  Below is your current memory document. You should update this document to be very brief and focused on criticism:
  
  ${existingMemory}
  
  # NEW INFORMATION
  Task Type: ${task.type}
  Data:
  \`\`\`json
  ${JSON.stringify(task.data, null, 2)}
  \`\`\`
  
  # INSTRUCTIONS
  1. Analyze the new information focusing ONLY on problems and issues
  2. Update the memory document to be extremely concise (1-3 sentences per section maximum)
  3. Focus exclusively on criticism and improvement areas, not what works well
  4. Use minimal bullet points for critical observations only
  5. Only include observations that highlight problems or inconsistencies
  6. The memory document should identify specific issues requiring attention
  7. Keep any section about your own personality very brief
  8. The entire document should be concise and critical in nature

  Return the complete updated memory document.`;
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
    // Handle final report differently from memory updates
    if (task.type === 'finalReport') {
      await handleFinalReport();
    } else {
      await handleMemoryUpdate(task);
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

// Handle final report generation
const handleFinalReport = async () => {
  // Get assistant node content for context
  const assistantNodesContent = getAssistantNodesContent();

  // Comprehensive prompt using all memory sources
  const promptContent = `Your name is Moxus, the World Design & Interactivity Watcher for this game engine.
  You monitor the story, provide guidance, and maintain consistency and quality in the game world.
  
  Generate a very brief critical analysis based on your accumulated memory documents below.
  
  ${assistantNodesContent ? `Additional features:
  ---
  ${assistantNodesContent}
  ---` : ""}
  
  # GENERAL MEMORY
  ${moxusStructuredMemory.GeneralMemory || '(No general memory available)'}
  
  # CHAT TEXT ANALYSIS
  ${moxusStructuredMemory.featureSpecificMemory.chatText || '(No chat text analysis available)'}
  
  # NODE EDITIONS ANALYSIS
  ${moxusStructuredMemory.featureSpecificMemory.nodeEdition || '(No node edition analysis available)'}
  
  # INSTRUCTIONS
  Create a brief critical report focusing ONLY on problems and issues.
  Keep the entire report to 1-3 short paragraphs maximum.
  Use minimal markdown formatting.
  
  Focus exclusively on:
  - Critical issues with story consistency or narrative quality
  - Significant problems with world building or coherence
  - Major character development issues
  - Serious gameplay mechanic flaws
  
  Be direct and concise. Focus only on problems requiring attention, not what works well.
  This will be displayed to the user as a Moxus critical analysis report.`;

  console.log(`[MoxusService] Generating final report using all memory sources...`);
  if (!getMoxusFeedbackImpl) {
    throw new Error('getMoxusFeedback implementation not set. Make sure to call setMoxusFeedbackImpl first.');
  }
  
  const report = await getMoxusFeedbackImpl(promptContent);
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
    updateGeneralMemoryFromAllSources();
  }, 1000);
};

// Handle memory updates for different task types
const handleMemoryUpdate = async (task: MoxusTask) => {
  // Determine which memory to update based on task type
  let memoryToUpdate = '';
  let memoryKey: keyof MoxusMemoryStructure['featureSpecificMemory'] | 'GeneralMemory' = 'GeneralMemory';
  
  if (task.type === 'llmCallFeedback' || task.type === 'chatTextFeedback') {
    // Handle specific LLM call feedback storage
    if (task.data && task.data.id) {
      const callId = task.data.id;
      if (!moxusStructuredMemory.featureSpecificMemory.llmCalls[callId]) {
        // The call might have been deleted during cleanup, reuse truncated data from task
        moxusStructuredMemory.featureSpecificMemory.llmCalls[callId] = {
          prompt: task.data.prompt,
          response: task.data.response,
          timestamp: new Date()
        };
      }
      
      // Get assistant node content for context
      const assistantNodesContent = getAssistantNodesContent();
      
      // Get prompt for LLM feedback
      const feedbackPrompt = `
      
      # Task
      You have to analyze an LLM call.

      ${assistantNodesContent ? `## Additional features:
      ---
      ${assistantNodesContent}
      ---` : ""}
      
      ## PROMPT:
      ---start of prompt---
      ${task.data.prompt}
      ---end of prompt---
      
      ## RESPONSE:
      ---start of response---
      ${task.data.response}
      ---end of response---
      
      Provide VERY brief, critical feedback focusing ONLY on problems with this response.
      Keep your feedback to a maximum of 1-3 short sentences.
      Focus exclusively on what could be improved, not what went well.
      Identify specific issues with quality, relevance, coherence, or accuracy.`;
      
      if (!getMoxusFeedbackImpl) {
        throw new Error('getMoxusFeedback implementation not set.');
      }
      
      const feedback = await getMoxusFeedbackImpl(feedbackPrompt);
      
      // Truncate feedback to avoid memory growth
      const truncatedFeedback = feedback.length > 500 ? feedback.substring(0, 500) + "... [truncated]" : feedback;
      
      // Store feedback for this specific LLM call
      moxusStructuredMemory.featureSpecificMemory.llmCalls[callId].feedback = truncatedFeedback;
      
      // For chatTextFeedback, also update the chatText memory document
      if (task.type === 'chatTextFeedback') {
        memoryKey = 'chatText';
        memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.chatText;
      }
      
      // Schedule GeneralMemory update after 5 processed feedback tasks
      const processedFeedbacks = Object.values(moxusStructuredMemory.featureSpecificMemory.llmCalls)
        .filter(call => call.feedback).length;
      
      if (processedFeedbacks > 0 && processedFeedbacks % 5 === 0) {
        console.log(`[MoxusService] Scheduling GeneralMemory update after ${processedFeedbacks} processed feedbacks.`);
        addTask('updateGeneralMemory', { reason: 'periodic_update_after_feedbacks' });
      }
    }
  } else {
    // For other tasks, determine which memory section to update
    switch (task.type) {
      case 'nodeEditFeedback':
        memoryKey = 'nodeEdit';
        memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.nodeEdit;
        break;
      case 'storyFeedback':
      case 'nodeUpdateFeedback':
        memoryKey = 'nodeEdition';
        memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.nodeEdition;
        break;
      case 'assistantFeedback':
        memoryKey = 'assistantFeedback';
        memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.assistantFeedback;
        break;
      case 'updateGeneralMemory':
        await updateGeneralMemoryFromAllSources();
        return; // Skip the regular memory update process
      default:
        memoryKey = 'GeneralMemory';
        memoryToUpdate = moxusStructuredMemory.GeneralMemory;
    }
  }
  
  // Only proceed with memory document update if we have a valid memory key to update
  if (memoryToUpdate !== undefined) {
    // Get memory update prompt
    const updatePrompt = getMemoryUpdatePrompt(task, memoryToUpdate);
    
    if (!getMoxusFeedbackImpl) {
      throw new Error('getMoxusFeedback implementation not set.');
    }
    
    const updatedMemory = await getMoxusFeedbackImpl(updatePrompt);
    
    // Update the appropriate memory section
    if (memoryKey === 'GeneralMemory') {
      moxusStructuredMemory.GeneralMemory = updatedMemory;
    } else {
      moxusStructuredMemory.featureSpecificMemory[memoryKey] = updatedMemory;
    }
    
    console.log(`[MoxusService] Updated ${memoryKey} memory document.`);
    saveMemory();
  }
};

// New function to update GeneralMemory from all memory sources
const updateGeneralMemoryFromAllSources = async () => {
  console.log('[MoxusService] Updating GeneralMemory from all available memory sources...');
  
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
  1. Create a VERY BRIEF updated GeneralMemory document that synthesizes only the most critical issues from ALL memory sources
  2. Keep each section extremely short - use 1-3 sentences maximum per section
  3. Focus exclusively on problems, issues, and areas for improvement - NOT what works well
  4. Use minimal bullet points for each critical observation
  5. Only include observations that highlight problems or inconsistencies in the game world
  6. Keep any section about your own personality very brief (1-2 sentences maximum)
  7. The entire document should be concise and focused on critique
  
  Return ONLY the complete updated GeneralMemory document.`;
  
  if (!getMoxusFeedbackImpl) {
    throw new Error('getMoxusFeedback implementation not set.');
  }
  
  // Get the updated GeneralMemory
  const updatedGeneralMemory = await getMoxusFeedbackImpl(updatePrompt);
  
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

// Export the service functions
export const moxusService = {
  initialize,
  addTask,
  recordLLMCall,
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
  }
}; 