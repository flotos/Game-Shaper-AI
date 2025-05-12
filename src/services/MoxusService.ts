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
  | 'chatTextFeedback';

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
  // Create the call object
  const call: LLMCall = {
    prompt,
    response,
    timestamp: new Date()
  };
  
  // Store in the structured memory
  moxusStructuredMemory.featureSpecificMemory.llmCalls[id] = call;
  
  // Skip evaluation for image generation prompts
  if (prompt.includes('generating image prompt') || 
      prompt.includes('generate the caption of image') || 
      prompt.includes('Image generation instructions')) {
    console.log(`[MoxusService] Skipping feedback for image generation prompt: ${id}`);
    // Still record the call but don't add a feedback task
  }
  // Check for chat text generation prompts (match patterns seen in the LLMService)
  else if (prompt.includes('Generate a detailed chapter') || 
      prompt.includes('Generate appropriate dialogue') || 
      id.startsWith('chatText-') || 
      prompt.includes('# TASK:\nYou are the Game Engine of a Node-base game')) {
    console.log(`[MoxusService] Adding chatText feedback task for: ${id}`);
    // Add to special task queue for chat text feedback
    addTask('chatTextFeedback', {
      id: id,
      prompt: prompt,
      response: response
    });
  }
  // Add llmCallFeedback task for all other types of calls
  else {
    addTask('llmCallFeedback', {
      id: id,
      prompt: prompt,
      response: response
    });
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
  Your goal is to maintain a comprehensive and well-structured record of observations and feedback.
  
  Assistant Personality (Defined by 'assistant' nodes):
  ---
  ${assistantNodesContent}
  ---
  
  # CURRENT MEMORY DOCUMENT
  Below is your current memory document. You should update, reorganize, or expand this document based on new observations:
  
  ${existingMemory || '# Game Development and Story Analysis\n\n*No previous analysis available.*'}
  
  # NEW INFORMATION
  Task Type: ${task.type}
  Timestamp: ${task.timestamp.toISOString()}
  Data:
  \`\`\`json
  ${JSON.stringify(task.data, null, 2)}
  \`\`\`
  
  # INSTRUCTIONS
  1. Analyze the new information from the current task
  2. Update the memory document to incorporate this new information
  3. Do NOT simply append the new information - integrate it appropriately into the existing structure
  4. Maintain a clear, well-organized markdown document with headings, subheadings, and bullet points
  5. Focus on insights, patterns, and critical observations rather than raw data
  6. The memory document should be a comprehensive analysis that evolves over time
  7. Ensure the document remains well-structured as a single cohesive markdown document

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
  
  Generate a comprehensive analysis report based on all your accumulated memory documents below.
  
  Assistant Personality:
  ---
  ${assistantNodesContent}
  ---
  
  # GENERAL MEMORY
  ${moxusStructuredMemory.GeneralMemory || '(No general memory available)'}
  
  # CHAT TEXT ANALYSIS
  ${moxusStructuredMemory.featureSpecificMemory.chatText || '(No chat text analysis available)'}
  
  # NODE EDITIONS ANALYSIS
  ${moxusStructuredMemory.featureSpecificMemory.nodeEdition || '(No node edition analysis available)'}
  
  # INSTRUCTIONS
  Create a well-structured, insightful report summarizing the key observations from all memory sources.
  Format your report with clear markdown headings (## for sections) and bullet points for key observations.
  
  Cover these areas if relevant:
  - Story Progress and Narrative Quality
  - World Building and Consistency
  - Character Development
  - Gameplay Mechanics and Balance
  - Technical Implementation
  - Suggestions for Improvement
  
  Be insightful but concise, focusing on the most important observations. This will be displayed to the user as a Moxus analysis report.`;

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
        moxusStructuredMemory.featureSpecificMemory.llmCalls[callId] = {
          prompt: task.data.prompt,
          response: task.data.response,
          timestamp: new Date()
        };
      }
      
      // Get prompt for LLM feedback
      const feedbackPrompt = `Analyze this LLM call:
      
      PROMPT:
      ${task.data.prompt}
      
      RESPONSE:
      ${task.data.response}
      
      Provide concise, constructive feedback on the quality, relevance, and coherence of this response.
      Focus on how the LLM could improve in future iterations.`;
      
      if (!getMoxusFeedbackImpl) {
        throw new Error('getMoxusFeedback implementation not set.');
      }
      
      const feedback = await getMoxusFeedbackImpl(feedbackPrompt);
      
      // Store feedback for this specific LLM call
      moxusStructuredMemory.featureSpecificMemory.llmCalls[callId].feedback = feedback;
      
      // For chatTextFeedback, also update the chatText memory document
      if (task.type === 'chatTextFeedback') {
        memoryKey = 'chatText';
        memoryToUpdate = moxusStructuredMemory.featureSpecificMemory.chatText;
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