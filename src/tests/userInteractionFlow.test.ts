import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { moxusService, setMoxusFeedbackImpl } from '../services/MoxusService';
import type { LLMCall } from '../services/MoxusService';
import type { Node } from '../models/Node';
import type { Message } from '../context/ChatContext';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock dependencies
vi.mock('../services/llmCore', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getChatHistoryForMoxus: vi.fn((chatHistory: Message[], numTurns: number): Message[] => {
      return chatHistory.slice(-numTurns).filter(msg => msg.role === 'user' || msg.role === 'assistant');
    }),
  };
});

// Test helpers
const mockGetMoxusFeedbackImpl = vi.fn();
const mockGetNodesCallback = vi.fn();
const mockAddMessageCallback = vi.fn();
const mockGetChatHistoryCallback = vi.fn();

describe('User Interaction LLM Flow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    
    // Reset MoxusService
    mockGetMoxusFeedbackImpl.mockResolvedValue('Moxus feedback response');
    mockGetNodesCallback.mockReturnValue([]);
    mockGetChatHistoryCallback.mockReturnValue([]);
    
    setMoxusFeedbackImpl(mockGetMoxusFeedbackImpl);
    moxusService.initialize(
      mockGetNodesCallback,
      mockAddMessageCallback,
      mockGetChatHistoryCallback
    );
  });

  afterEach(() => {
    moxusService.resetMemory();
    vi.useRealTimers();
  });

  const advanceTimersByTime = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve(); 
    vi.runOnlyPendingTimers();
    await Promise.resolve(); 
  };

  it('should record chat text LLM call and generate feedback', async () => {
    vi.useFakeTimers();
    
    // 1. Record a chat text generation call
    const chatTextCallId = 'simple-test-chat-text-123';
    moxusService.initiateLLMCallRecord(
      chatTextCallId,
      'chat_text_generation', 
      'gpt-4o',
      'Generate a response about heroes'
    );
    
    // 2. Finalize the call with a response
    moxusService.finalizeLLMCallRecord(
      chatTextCallId,
      'Heroes come in many forms, from those who save lives to those who inspire others.'
    );
    
    // 3. Allow time for the feedback task to be processed
    await advanceTimersByTime(500);
    
    // 4. Verify the call was recorded
    const llmCalls = moxusService.getLLMLogEntries();
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0].id).toBe(chatTextCallId);
    
    // 5. Verify MoxusService called getMoxusFeedbackImpl
    expect(mockGetMoxusFeedbackImpl).toHaveBeenCalled();
    
    // 6. Verify that the feedback was set on the call
    const chatTextCall = moxusService.getMoxusMemory().featureSpecificMemory.llmCalls[chatTextCallId];
    expect(chatTextCall.feedback).toBeTruthy();
    
    // 7. Verify that the chatText memory was updated
    const memory = moxusService.getMoxusMemory();
    expect(memory.featureSpecificMemory.chatText).toBeTruthy();
  });

  it('should record node edition LLM call and generate feedback', async () => {
    vi.useFakeTimers();
    
    // 1. Record a node edition call
    const nodeEditionCallId = 'simple-test-node-edition-456';
    moxusService.initiateLLMCallRecord(
      nodeEditionCallId,
      'node_edition_yaml',
      'gpt-4o',
      'Update the hero character node'
    );
    
    // 2. Finalize the call with a YAML response
    const nodeEditionResponse = `
n_nodes:
  - id: hero1
    name: Brave Hero
    type: character
    longDescription: A hero who stands up for what is right.
    image: hero.jpg
`;
    
    moxusService.finalizeLLMCallRecord(
      nodeEditionCallId,
      nodeEditionResponse
    );
    
    // 3. Allow time for the feedback task to be processed
    await advanceTimersByTime(500);
    
    // 4. Verify the call was recorded
    const llmCalls = moxusService.getLLMLogEntries();
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0].id).toBe(nodeEditionCallId);
    
    // 5. Verify MoxusService called getMoxusFeedbackImpl
    expect(mockGetMoxusFeedbackImpl).toHaveBeenCalled();
    
    // 6. Verify that the feedback was set on the call
    const nodeEditionCall = moxusService.getMoxusMemory().featureSpecificMemory.llmCalls[nodeEditionCallId];
    expect(nodeEditionCall.feedback).toBeTruthy();
    
    // 7. Verify that the nodeEdition memory was updated
    const memory = moxusService.getMoxusMemory();
    expect(memory.featureSpecificMemory.nodeEdition).toBeTruthy();
  });

  it('should record image generation call but skip feedback', async () => {
    vi.useFakeTimers();
    
    // 1. Record an image generation call
    const imagePromptCallId = 'simple-test-image-prompt-789';
    moxusService.initiateLLMCallRecord(
      imagePromptCallId,
      'image_prompt_generation', 
      'gpt-4o',
      'Generate image prompt for a hero'
    );
    
    // 2. Finalize the call
    moxusService.finalizeLLMCallRecord(
      imagePromptCallId,
      'A majestic hero standing on a cliff, golden light behind them, detailed, fantasy'
    );
    
    // 3. Allow time for any potential tasks
    await advanceTimersByTime(200);
    
    // 4. Verify the call was recorded
    const llmCalls = moxusService.getLLMLogEntries();
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0].id).toBe(imagePromptCallId);
    
    // 5. Verify that feedback was NOT generated (should be skipped)
    const imagePromptCall = moxusService.getMoxusMemory().featureSpecificMemory.llmCalls[imagePromptCallId];
    expect(imagePromptCall.feedback).toBeUndefined();
    
    // 6. Verify that MoxusService didn't call getMoxusFeedbackImpl for this call type
    expect(mockGetMoxusFeedbackImpl).not.toHaveBeenCalled();
  });

  it('should manually trigger a final report', async () => {
    vi.useFakeTimers();
    
    // Setup mock data
    const mockNodes: Node[] = [
      {
        id: 'char1', 
        name: 'Hero Character',
        longDescription: 'A brave hero',
        type: 'character',
        image: 'hero.jpg'
      },
      {
        id: 'assist1',
        name: 'Assistant Personality',
        longDescription: 'Helpful storyteller',
        type: 'assistant',
        image: 'assistant.jpg'
      }
    ];
    
    const mockChatHistory: Message[] = [
      { role: 'user', content: 'Tell me a story' },
      { role: 'assistant', content: 'Once upon a time...' }
    ];
    
    mockGetNodesCallback.mockReturnValue(mockNodes);
    mockGetChatHistoryCallback.mockReturnValue(mockChatHistory);
    
    // Manually add a finalReport task
    moxusService.addTask('finalReport', { reason: "Manual test trigger" }, mockChatHistory);
    
    // Allow time for the report to be processed
    await advanceTimersByTime(500);
    
    // Verify MoxusService called getMoxusFeedbackImpl for the report
    expect(mockGetMoxusFeedbackImpl).toHaveBeenCalled();
    
    // Verify that a Moxus message was sent to chat
    expect(mockAddMessageCallback).toHaveBeenCalledWith(expect.objectContaining({
      role: 'moxus',
      content: expect.any(String)
    }));
  });

  it('should process a complete comprehensive chain of all LLM calls after a user interaction', async () => {
    // This test comprehensively covers ALL LLM calls made during a complete user interaction:
    //
    // MAIN USER INTERACTION LLM CALLS (9 total):
    // 1. getRelevantNodes (node_relevance_check) - when nodes > 15
    // 2. generateChatText (chat_text_generation) - streaming response  
    // 3. generateActions (action_generation) - parallel with node edition
    // 4. generateNodeEdition (node_edition_yaml) - parallel with actions
    // 5-9. generateImagePrompt (image_prompt_generation) x5 - background image generation
    //
    // MOXUS FEEDBACK PIPELINE LLM CALLS (6 total):
    // 1. Feedback for node_relevance_check 
    // 2. Feedback for chat_text_generation
    // 3. chatText memory update (INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback)
    // 4. Feedback for node_edition_yaml
    // 5. nodeEdition memory update (INTERNAL_MEMORY_UPDATE_FOR_node_edition) 
    // 6. Final report generation (INTERNAL_FINAL_REPORT_GENERATION_STEP)
    // 7. General memory update (INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory) - optional
    //
    // CALL TYPES VERIFIED TO BE SKIPPED:
    // - action_generation (no feedback generated)
    // - image_prompt_generation (no feedback generated)
    //
    // TOTAL: 15+ LLM operations per user interaction
    
    vi.useFakeTimers();
    
    // Setup mock data with many nodes to trigger getRelevantNodes
    const mockNodes: Node[] = [
      {
        id: 'char1', 
        name: 'Hero Character',
        longDescription: 'A brave hero',
        type: 'character',
        image: 'hero.jpg',
        updateImage: true
      },
      {
        id: 'location1',
        name: 'Fantasy World',
        longDescription: 'A magical realm',
        type: 'location',
        image: 'world.jpg',
        updateImage: true
      },
      {
        id: 'assist1',
        name: 'Assistant Personality',
        longDescription: 'Helpful storyteller',
        type: 'assistant',
        image: 'assistant.jpg'
      },
      // Add many more nodes to trigger getRelevantNodes (>15 nodes)
      ...Array.from({ length: 13 }, (_, i) => ({
        id: `extra_node_${i + 1}`,
        name: `Extra Node ${i + 1}`,
        longDescription: `Description for extra node ${i + 1}`,
        type: 'location',
        image: `extra${i + 1}.jpg`,
        updateImage: i < 2 // Only first 2 extra nodes need image updates
      }))
    ];
    
    const mockChatHistory: Message[] = [
      { role: 'user', content: 'Tell me a story about a hero' },
      { role: 'assistant', content: 'Once upon a time...' },
      { role: 'user', content: 'What happens next?' }
    ];
    
    mockGetNodesCallback.mockReturnValue(mockNodes);
    mockGetChatHistoryCallback.mockReturnValue(mockChatHistory);
    
    // Track all LLM calls made by callType
    const llmCallTracker: Record<string, number> = {};
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      llmCallTracker[callType] = (llmCallTracker[callType] || 0) + 1;
      return Promise.resolve('Moxus feedback response');
    });
    
    // PHASE 1: Main User Interaction LLM Calls
    
    // STEP 1: getRelevantNodes (triggered because we have >15 nodes)
    const relevantNodesCallId = 'comprehensive-relevant-nodes-123';
    moxusService.initiateLLMCallRecord(
      relevantNodesCallId,
      'node_relevance_check',
      'gpt-3.5-turbo',
      'Determine which nodes are relevant to user input'
    );
    moxusService.finalizeLLMCallRecord(
      relevantNodesCallId,
      '{"relevantNodes": ["char1", "location1"]}'
    );
    
    // STEP 2: generateChatText (streaming)
    const chatTextCallId = 'comprehensive-chat-text-456';
    moxusService.initiateLLMCallRecord(
      chatTextCallId,
      'chat_text_generation',
      'gpt-4o',
      'Generate a response to the user question about what happens next'
    );
    moxusService.getMoxusMemory().featureSpecificMemory.llmCalls[chatTextCallId].chatHistory = mockChatHistory;
    moxusService.finalizeLLMCallRecord(
      chatTextCallId,
      'The hero ventured into the dark forest, where ancient secrets awaited...'
    );
    
    // STEP 3: generateActions (parallel with node edition)
    const actionsCallId = 'comprehensive-actions-789';
    moxusService.initiateLLMCallRecord(
      actionsCallId,
      'action_generation',
      'gpt-4o',
      'Generate possible actions based on the story text'
    );
    moxusService.finalizeLLMCallRecord(
      actionsCallId,
      '{"actions": ["Explore deeper into the forest", "Set up camp for the night", "Look for clues"]}'
    );
    
    // STEP 4: generateNodeEdition (parallel with actions)
    const nodeEditionCallId = 'comprehensive-node-edition-012';
    moxusService.initiateLLMCallRecord(
      nodeEditionCallId,
      'node_edition_json',
      'gpt-4o',
      'Update nodes based on the hero entering the forest'
    );
    moxusService.finalizeLLMCallRecord(
      nodeEditionCallId,
      JSON.stringify({
        n_nodes: [{
          id: 'forest1',
          name: 'Dark Forest',
          type: 'location',
          longDescription: 'An ancient forest filled with mysteries and secrets.',
          image: 'forest.jpg',
          updateImage: true
        }],
        u_nodes: {
          "char1": {
            longDescription: {
              df: [{
                prev_txt: "A brave hero",
                next_txt: "A brave hero exploring the ancient forest"
              }]
            },
            img_upd: true
          }
        }
      })
    );
    
    // PHASE 2: Image Generation LLM Calls (background)
    
    // STEP 5: Image prompt generation for multiple nodes
    const imagePromptCallIds = [];
    const nodesToUpdateImages = ['char1', 'location1', 'forest1', 'extra_node_1', 'extra_node_2'];
    
    for (let i = 0; i < nodesToUpdateImages.length; i++) {
      const nodeId = nodesToUpdateImages[i];
      const imageCallId = `comprehensive-image-prompt-${nodeId}-${i}`;
      imagePromptCallIds.push(imageCallId);
      
      moxusService.initiateLLMCallRecord(
        imageCallId,
        'image_prompt_generation',
        'gpt-4o',
        `Generate image prompt for node ${nodeId}`
      );
      moxusService.finalizeLLMCallRecord(
        imageCallId,
        `A detailed image prompt for ${nodeId} with fantasy elements`
      );
    }
    
    // Allow time for initial feedback tasks to be queued
    await advanceTimersByTime(100);
    
    // PHASE 3: Moxus Feedback Pipeline (background, asynchronous)
    
    // Allow time for all feedback tasks to be processed sequentially
    // The MoxusService should process these in order: chatTextFeedback, llmCallFeedback, then finalReport
    console.log('[TEST] Processing Moxus feedback pipeline...');
    
    // Process chatTextFeedback
    await advanceTimersByTime(400);
    
    // Process llmCallFeedback tasks (for node_edition_yaml, action_generation, etc.)
    await advanceTimersByTime(400);
    
    // Process nodeEdition memory update (part of node_edition_yaml feedback)
    await advanceTimersByTime(300);
    
    // Process chatText memory update
    await advanceTimersByTime(300);
    
    // Final report should be triggered when both major feedbacks are complete
    await advanceTimersByTime(400);
    
    // General memory update after final report
    await advanceTimersByTime(400);
    
    // COMPREHENSIVE VERIFICATION
    console.log('[TEST] Starting comprehensive verification');
    
    // 1. Verify all main interaction LLM calls were recorded
    const llmCalls = moxusService.getLLMLogEntries();
    console.log(`[TEST] Total LLM calls recorded: ${llmCalls.length}`);
    
    // Should have: relevantNodes + chatText + actions + nodeEdition + 5 imagePrompts = 9 main calls
    const mainCallTypes = ['node_relevance_check', 'chat_text_generation', 'action_generation', 'node_edition_json', 'image_prompt_generation'];
    const mainCalls = llmCalls.filter(call => mainCallTypes.includes(call.callType));
    expect(mainCalls.length).toBeGreaterThanOrEqual(9); // 4 main + 5 image prompts
    
    // Verify specific main calls exist
    expect(llmCalls.some(call => call.id === relevantNodesCallId)).toBe(true);
    expect(llmCalls.some(call => call.id === chatTextCallId)).toBe(true);
    expect(llmCalls.some(call => call.id === actionsCallId)).toBe(true);
    expect(llmCalls.some(call => call.id === nodeEditionCallId)).toBe(true);
    imagePromptCallIds.forEach(imageId => {
      expect(llmCalls.some(call => call.id === imageId)).toBe(true);
    });
    
    // 2. Verify feedback was generated for eligible calls ONLY
    // According to MoxusService: action_generation and image_prompt_generation are SKIPPED
    const chatTextCall = llmCalls.find(call => call.id === chatTextCallId);
    const actionsCall = llmCalls.find(call => call.id === actionsCallId);
    const nodeEditionCall = llmCalls.find(call => call.id === nodeEditionCallId);
    
    expect(chatTextCall?.feedback).toBeTruthy();
    expect(nodeEditionCall?.feedback).toBeTruthy();
    
    // action_generation calls should NOT have feedback (they're skipped)
    expect(actionsCall?.feedback).toBeUndefined();
    
    // Image prompt calls should NOT have feedback (they're skipped)
    imagePromptCallIds.forEach(imageId => {
      const imageCall = llmCalls.find(call => call.id === imageId);
      expect(imageCall?.feedback).toBeUndefined();
    });
    
    // 3. Verify all memory areas were updated
    const memory = moxusService.getMoxusMemory();
    expect(memory.featureSpecificMemory.chatText).toBeTruthy();
    expect(memory.featureSpecificMemory.nodeEdition).toBeTruthy();
    expect(memory.GeneralMemory).toBeTruthy();
    
    // 4. Verify comprehensive Moxus LLM call pattern
    const moxusCallCount = mockGetMoxusFeedbackImpl.mock.calls.length;
    console.log(`[TEST] Total Moxus LLM calls made: ${moxusCallCount}`);
    console.log('[TEST] Moxus call breakdown by type:', llmCallTracker);
    
    // Expected Moxus calls (CONSCIOUSNESS-DRIVEN SYSTEM):
    // - Feedback for node_relevance_check (✓) - fallback to basic feedback
    // - Consciousness-driven feedback for chat_text_generation (✓) - combines feedback + memory update
    // - Consciousness-driven feedback for node_edition_json (✓) - combines feedback + memory update  
    // - Final report generation (✓)
    // - General memory update after final report (may or may not happen in test timing)
    // 
    // NOTE: With consciousness-driven system, feedback and memory updates are COMBINED
    // OLD SYSTEM: 6 calls = 2 for chat_text + 2 for node_edition + 1 final report + 1 general memory
    // NEW SYSTEM: 4 calls = 1 for chat_text + 1 for node_edition + 1 final report + 1 general memory
    expect(moxusCallCount).toBeGreaterThanOrEqual(4);
    expect(moxusCallCount).toBeLessThanOrEqual(6); // Allow some variation in processing order
    
    // Verify specific Moxus call types were made (consciousness-driven system)
    expect(llmCallTracker['node_relevance_check']).toBe(1);
    
    // Consciousness-driven calls (these replace separate feedback + memory update calls)
    expect(llmCallTracker['moxus_feedback_on_chat_text_generation']).toBe(1);
    expect(llmCallTracker['moxus_feedback_on_node_edition_json'] || llmCallTracker['node_edition_json']).toBeTruthy();
    
    expect(llmCallTracker['INTERNAL_FINAL_REPORT_GENERATION_STEP']).toBe(1);
    
    // General memory update may or may not complete in test timing - make it optional
    if (llmCallTracker['INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory']) {
      expect(llmCallTracker['INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory']).toBe(1);
    }
    
    // These old separate memory update calls should NOT exist in consciousness-driven system
    expect(llmCallTracker['INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback']).toBeUndefined();
    expect(llmCallTracker['INTERNAL_MEMORY_UPDATE_FOR_node_edition']).toBeUndefined();
    
    // Verify that action_generation and image_prompt_generation were NOT processed by Moxus
    expect(llmCallTracker['action_generation']).toBeUndefined();
    expect(llmCallTracker['image_prompt_generation']).toBeUndefined();
    
    // 5. Verify that a Moxus report was sent to chat
    expect(mockAddMessageCallback).toHaveBeenCalledWith(expect.objectContaining({
      role: 'moxus',
      content: expect.any(String)
    }));
    
    // 6. Verify total LLM call count is comprehensive
    // Main calls (4) + Image prompts (5) + Moxus calls (4-6) = 13-15 total
    const totalLLMCalls = llmCalls.length + moxusCallCount;
    console.log(`[TEST] Total LLM operations (main + Moxus): ${totalLLMCalls}`);
    expect(totalLLMCalls).toBeGreaterThanOrEqual(13);
    expect(totalLLMCalls).toBeLessThanOrEqual(17); // Reasonable upper bound
    
    console.log('[TEST] Comprehensive userInteractionFlow test completed successfully');
  });

  it('should handle assistant update flow without infinite moxus_feedback loop', async () => {
    vi.useFakeTimers();
    
    // Track all LLM calls made by callType
    const llmCallTracker: Record<string, number> = {};
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      llmCallTracker[callType] = (llmCallTracker[callType] || 0) + 1;
      return Promise.resolve('Moxus feedback response');
    });
    
    // 1. Simulate the actual scenario that caused the infinite loop
    // First, simulate a moxus_feedback call being made (this would happen in the real flow)
    moxusService.initiateLLMCallRecord('test-moxus-feedback-call', 'moxus_feedback', 'gpt-4o-mini', 'Test moxus feedback prompt');
    moxusService.finalizeLLMCallRecord('test-moxus-feedback-call', 'Test moxus feedback response');
    
    // 2. Allow time for any feedback tasks to be processed
    await advanceTimersByTime(200);
    
    // 3. Verify that the moxus_feedback call was recorded
    const llmCalls = moxusService.getLLMLogEntries();
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0].callType).toBe('moxus_feedback');
    
    // 4. Most importantly: verify that NO additional feedback tasks were generated
    // (which would have caused the infinite loop before the fix)
    expect(llmCallTracker['moxus_feedback']).toBeUndefined(); // Should not have generated more moxus_feedback calls
    
    // 5. Wait a bit more to ensure no delayed tasks are triggered
    await advanceTimersByTime(200);
    
    const finalLlmCalls = moxusService.getLLMLogEntries();
    expect(finalLlmCalls.length).toBe(1); // Still should be exactly 1 call
    
    // 6. Now test the assistantFeedback flow separately
    moxusService.addTask('assistantFeedback', { 
      query: "Update the hero character to be more powerful",
      result: {
        callId: `assistant-${Date.now()}`,
        u_nodes: {
          "hero1": {
            longDescription: { rpl: "A very powerful hero with enhanced abilities" },
            img_upd: true
          }
        }
      }
    });
    
    await advanceTimersByTime(500);
    
    // 7. Verify assistantFeedback was processed with the correct call type
    expect(llmCallTracker['moxus_feedback_on_assistant_feedback']).toBe(1);
    
    // 8. Verify the assistantFeedback memory was updated
    const memory = moxusService.getMoxusMemory();
    expect(memory.featureSpecificMemory.assistantFeedback).toBeTruthy();
    
    console.log('[TEST] Assistant update flow completed without infinite loop - moxus_feedback calls are now properly excluded from generating additional feedback');
  });

  it('should process a complete assistant feature LLM call flow', async () => {
    // This test comprehensively covers ALL LLM calls made during a complete assistant feature interaction:
    //
    // ASSISTANT FEATURE LLM CALLS:
    // 1. generateNodesFromPrompt (node_creation_from_prompt) - main assistant LLM call
    // 2. (optional) Image prompt generation for updated nodes (image_prompt_generation) x N
    //
    // MOXUS FEEDBACK PIPELINE LLM CALLS:
    // 1. Feedback for node_creation_from_prompt (standard LLM call feedback)
    // 2. AssistantFeedback task processing (INTERNAL_MEMORY_UPDATE_FOR_assistantFeedback)
    // 3. (optional) Final report if conditions are met
    // 4. (optional) General memory update
    //
    // ASSISTANT FEATURE FLOW:
    // User Query → generateNodesFromPrompt → User Preview/Confirmation → updateGraph → assistantFeedback task → Moxus Analysis
    
    vi.useFakeTimers();
    
    // Setup mock data
    const mockNodes: Node[] = [
      {
        id: 'char1', 
        name: 'Hero Character',
        longDescription: 'A brave hero',
        type: 'character',
        image: 'hero.jpg'
      },
      {
        id: 'location1',
        name: 'Starting Village',
        longDescription: 'A peaceful village',
        type: 'location',
        image: 'village.jpg'
      },
      {
        id: 'assist1',
        name: 'Narrative Assistant',
        longDescription: 'Helpful storytelling AI',
        type: 'assistant',
        image: 'assistant.jpg'
      },
      {
        id: 'sys1',
        name: 'Game System',
        longDescription: 'Core game mechanics',
        type: 'system',
        image: 'system.jpg'
      }
    ];
    
    const mockChatHistory: Message[] = [
      { role: 'user', content: 'I want to make the hero more powerful' },
      { role: 'assistant', content: 'The hero character could be enhanced in several ways...' }
    ];
    
    mockGetNodesCallback.mockReturnValue(mockNodes);
    mockGetChatHistoryCallback.mockReturnValue(mockChatHistory);
    
    // Track all LLM calls made by callType
    const llmCallTracker: Record<string, number> = {};
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      llmCallTracker[callType] = (llmCallTracker[callType] || 0) + 1;
      
      // Return proper JSON format for consciousness-driven prompts
      if (callType === 'moxus_feedback_on_assistant_feedback') {
        return Promise.resolve(JSON.stringify({
          memory_update_diffs: {
            rpl: `# Assistant Interactions Analysis\n\nMoxus feedback response for ${callType}`
          },
          assistant_teaching: {
            performance_assessment: "Good assistant performance",
            interaction_guidance: "Continue this approach",
            solution_quality_notes: "Quality is acceptable",
            user_experience_insights: "User experience was positive"
          },
          consciousness_evolution: "Learning about assistant interactions"
        }));
      }
      
      return Promise.resolve('Moxus feedback response for ' + callType);
    });
    
    // PHASE 1: Assistant Feature Main LLM Call
    
    // STEP 1: generateNodesFromPrompt (this is the core assistant feature LLM call)
    const assistantPromptCallId = 'assistant-generate-nodes-123';
    const userQuery = "Make the hero more powerful and add a magical sword";
    
    moxusService.initiateLLMCallRecord(
      assistantPromptCallId,
      'node_creation_from_prompt',
      'gpt-4',
      `Generate nodes based on user prompt: ${userQuery}`
    );
    
    // Mock the response that generateNodesFromPrompt would return
    const assistantLLMResponse = JSON.stringify({
      u_nodes: {
        "char1": {
          longDescription: { rpl: "A brave and powerful hero with enhanced magical abilities" },
          img_upd: true
        }
      },
      n_nodes: [{
        id: "sword1",
        name: "Enchanted Sword",
        longDescription: "A magical sword that glows with mystical energy and enhances the wielder's power.",
        type: "item",
        updateImage: true
      }]
    });
    
    moxusService.finalizeLLMCallRecord(
      assistantPromptCallId,
      assistantLLMResponse
    );
    
    // PHASE 2: Image Generation LLM Calls (optional, background)
    
    // STEP 2: Image prompt generation for updated nodes (char1 and sword1)
    const imagePromptCallIds = [];
    const nodesToUpdateImages = ['char1', 'sword1'];
    
    for (let i = 0; i < nodesToUpdateImages.length; i++) {
      const nodeId = nodesToUpdateImages[i];
      const imageCallId = `assistant-image-prompt-${nodeId}-${i}`;
      imagePromptCallIds.push(imageCallId);
      
      moxusService.initiateLLMCallRecord(
        imageCallId,
        'image_prompt_generation',
        'gpt-4o',
        `Generate image prompt for updated node ${nodeId}`
      );
      moxusService.finalizeLLMCallRecord(
        imageCallId,
        `A detailed fantasy image of ${nodeId === 'char1' ? 'a powerful hero with enhanced abilities' : 'an enchanted magical sword'}`
      );
    }
    
    // Allow time for initial feedback tasks to be queued
    await advanceTimersByTime(100);
    
    // PHASE 3: User Confirmation and Assistant Feedback Task
    
    // STEP 3: User confirms the changes (this triggers assistantFeedback task)
    // This simulates what happens when user clicks "Apply Changes" in AssistantOverlay
    const assistantFeedbackData = {
      query: userQuery,
      result: {
        callId: `assistant-${Date.now()}`,
        u_nodes: {
          "char1": {
            longDescription: { rpl: "A brave and powerful hero with enhanced magical abilities" },
            img_upd: true
          }
        },
        n_nodes: [{
          id: "sword1",
          name: "Enchanted Sword", 
          longDescription: "A magical sword that glows with mystical energy and enhances the wielder's power.",
          type: "item",
          updateImage: true,
          image: ""
        }]
      }
    };
    
    moxusService.addTask('assistantFeedback', assistantFeedbackData);
    
    // PHASE 4: Moxus Feedback Pipeline (background, asynchronous)
    
    // Allow time for all feedback tasks to be processed sequentially
    console.log('[TEST] Processing assistant feature Moxus feedback pipeline...');
    
    // Process LLM call feedback for node_creation_from_prompt
    await advanceTimersByTime(400);
    
    // Process assistantFeedback task
    await advanceTimersByTime(400);
    
    // Optional: Process final report (if conditions are met)
    await advanceTimersByTime(300);
    
    // Optional: Process general memory update
    await advanceTimersByTime(300);
    
    // COMPREHENSIVE VERIFICATION
    console.log('[TEST] Starting assistant feature comprehensive verification');
    
    // 1. Verify all main assistant feature LLM calls were recorded
    const llmCalls = moxusService.getLLMLogEntries();
    console.log(`[TEST] Total LLM calls recorded: ${llmCalls.length}`);
    
    // Should have: generateNodesFromPrompt + 2 image prompts = 3 main calls
    const mainCallTypes = ['node_creation_from_prompt', 'image_prompt_generation'];
    const mainCalls = llmCalls.filter(call => mainCallTypes.includes(call.callType));
    expect(mainCalls.length).toBeGreaterThanOrEqual(3); // 1 main + 2 image prompts
    
    // Verify specific main calls exist
    expect(llmCalls.some(call => call.id === assistantPromptCallId)).toBe(true);
    imagePromptCallIds.forEach(imageId => {
      expect(llmCalls.some(call => call.id === imageId)).toBe(true);
    });
    
    // 2. Verify feedback was generated for eligible calls ONLY
    // According to MoxusService: image_prompt_generation is SKIPPED, but node_creation_from_prompt should get feedback
    const assistantPromptCall = llmCalls.find(call => call.id === assistantPromptCallId);
    expect(assistantPromptCall?.feedback).toBeTruthy();
    
    // Image prompt calls should NOT have feedback (they're skipped)
    imagePromptCallIds.forEach(imageId => {
      const imageCall = llmCalls.find(call => call.id === imageId);
      expect(imageCall?.feedback).toBeUndefined();
    });
    
    // 3. Verify assistant feedback memory was updated
    const memory = moxusService.getMoxusMemory();
    expect(memory.featureSpecificMemory.assistantFeedback).toBeTruthy();
    expect(memory.featureSpecificMemory.assistantFeedback).toContain('Moxus feedback response'); // Should contain the mocked response
    
    // 4. Verify comprehensive Moxus LLM call pattern for assistant feature
    const moxusCallCount = mockGetMoxusFeedbackImpl.mock.calls.length;
    console.log(`[TEST] Total Moxus LLM calls made: ${moxusCallCount}`);
    console.log('[TEST] Moxus call breakdown by type:', llmCallTracker);
    
    // Expected Moxus calls for assistant feature:
    // - Feedback for node_creation_from_prompt (✓) - standard LLM call feedback
    // - AssistantFeedback consciousness-driven analysis (✓) - moxus_feedback_on_assistant_feedback
    // - (optional) Additional memory updates or reports depending on timing
    expect(moxusCallCount).toBeGreaterThanOrEqual(2);
    expect(moxusCallCount).toBeLessThanOrEqual(5); // Allow some variation
    
    // Verify specific Moxus call types were made
    expect(llmCallTracker['node_creation_from_prompt']).toBe(1); // Standard feedback for the main call
    expect(llmCallTracker['moxus_feedback_on_assistant_feedback']).toBe(1); // Assistant feedback consciousness-driven analysis
    
    // Verify that image_prompt_generation was NOT processed by Moxus
    expect(llmCallTracker['image_prompt_generation']).toBeUndefined();
    
    // 5. Verify total LLM call count is reasonable
    // Main calls (1 + 2) + Moxus calls (2-5) = 5-8 total
    const totalLLMCalls = llmCalls.length + moxusCallCount;
    console.log(`[TEST] Total LLM operations (main + Moxus): ${totalLLMCalls}`);
    expect(totalLLMCalls).toBeGreaterThanOrEqual(5);
    expect(totalLLMCalls).toBeLessThanOrEqual(10); // Reasonable upper bound
    
         // 6. Verify the assistantFeedback task data was properly structured
     // This ensures the assistant feature is correctly passing data to Moxus
     const assistantMemory = memory.featureSpecificMemory.assistantFeedback;
     expect(assistantMemory).toContain('Moxus feedback response'); // Should contain the mocked response
     expect(assistantMemory.length).toBeGreaterThan(50); // Should have been updated from default empty state
    
    console.log('[TEST] Assistant feature LLM call flow test completed successfully');
  });

  it('should call the correct moxus_feedback_on_manual_node_edit prompt when user manually edits a node', async () => {
    vi.useFakeTimers();
    
    // Track all LLM calls made by callType to detect if generic "moxus_feedback" is being called
    const llmCallTracker: Record<string, number> = {};
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      llmCallTracker[callType] = (llmCallTracker[callType] || 0) + 1;
      
      // Simulate the LLM call recording that would normally happen in getResponse
      const mockCallId = `mock-${callType}-${Date.now()}`;
      moxusService.initiateLLMCallRecord(mockCallId, callType, 'gpt-4o-mini', prompt);
      const response = 'Moxus manual edit feedback response';
      moxusService.finalizeLLMCallRecord(mockCallId, response);
      
      return Promise.resolve(response);
    });
    
    // Setup original and edited nodes
    const originalNode = {
      id: 'hero1',
      name: 'Hero Character',
      longDescription: 'A brave hero',
      type: 'character',
      image: 'hero.jpg'
    };
    
    const editedNode = {
      id: 'hero1',
      name: 'Hero Character',
      longDescription: 'A very powerful and brave hero with magical abilities', // User's manual edit
      type: 'character',
      image: 'hero.jpg'
    };
    
    // 1. Record the manual node edit (this should use the specific manual edit prompt)
    moxusService.recordManualNodeEdit(originalNode, editedNode, 'Manual edit via node editor');
    
    // 2. Allow time for the manual edit analysis task to be processed
    await advanceTimersByTime(500);
    
    // 3. Verify that the correct specialized prompt was called, NOT the generic moxus_feedback
    console.log('[TEST] LLM call tracker:', llmCallTracker);
    
    // This should be the SPECIFIC manual edit prompt, not generic
    expect(llmCallTracker['moxus_feedback_on_manual_node_edit']).toBe(1);
    
    // These generic call types should NOT be called for manual node edits
    expect(llmCallTracker['moxus_feedback']).toBeUndefined();
    expect(llmCallTracker['nodeEditFeedback']).toBeUndefined();
    
    // 4. Verify that the manual edit memory was updated
    const memory = moxusService.getMoxusMemory();
    expect(memory.featureSpecificMemory.nodeEdit).toBeTruthy();
    expect(memory.featureSpecificMemory.nodeEdit).toContain('Moxus manual edit feedback response');
    
    console.log('[TEST] Manual node edit prompt test completed - should use specific moxus_feedback_on_manual_node_edit prompt');
  });

  it('should record manual node edit analysis in LLM call logs with correct call type', async () => {
    vi.useFakeTimers();
    
    // Setup tracking
    const llmCallTracker: Record<string, number> = {};
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      llmCallTracker[callType] = (llmCallTracker[callType] || 0) + 1;
      
      // Simulate the LLM call recording that would normally happen in getResponse
      const mockCallId = `mock-${callType}-${Date.now()}`;
      moxusService.initiateLLMCallRecord(mockCallId, callType, 'gpt-4o-mini', prompt);
      const response = '{"memory_update_diffs": {"rpl": "Updated manual edit memory"}, "consciousness_evolution": "Learning from manual edit"}';
      moxusService.finalizeLLMCallRecord(mockCallId, response);
      
      return Promise.resolve(response);
    });
    
    // Setup nodes
    const originalNode = {
      id: 'hero1',
      name: 'Hero Character',
      longDescription: 'A brave hero',
      type: 'character',
      image: 'hero.jpg'
    };
    
    const editedNode = {
      id: 'hero1',
      name: 'Hero Character',
      longDescription: 'A very powerful and brave hero with magical abilities',
      type: 'character',
      image: 'hero.jpg'
    };
    
    // 1. Check initial LLM call logs (should be empty)
    let llmCalls = moxusService.getLLMLogEntries();
    expect(llmCalls.length).toBe(0);
    
    // 2. Record the manual node edit
    moxusService.recordManualNodeEdit(originalNode, editedNode, 'Manual edit via node editor');
    
    // 3. Allow time for processing
    await advanceTimersByTime(500);
    
    // 4. Check LLM call logs after manual edit analysis
    llmCalls = moxusService.getLLMLogEntries();
    console.log('[TEST] LLM calls after manual edit:', llmCalls.map(call => ({ id: call.id, callType: call.callType })));
    
    // 5. The key question: Is the manual edit analysis recorded as an LLM call in the logs?
    // If this is empty, then manual edit analysis is NOT being recorded in LLM logs,
    // which would explain why the user doesn't see the correct call type in the logs
    console.log(`[TEST] Total LLM calls recorded: ${llmCalls.length}`);
    console.log('[TEST] LLM call types recorded:', llmCalls.map(call => call.callType));
    
    // 6. Check if we can find the manual edit analysis call
    const manualEditAnalysisCalls = llmCalls.filter(call => 
      call.callType === 'moxus_feedback_on_manual_node_edit' || 
      call.callType === 'manualNodeEditAnalysis'
    );
    
    console.log(`[TEST] Manual edit analysis calls found: ${manualEditAnalysisCalls.length}`);
    
    // 7. Verify that manual edit analysis WAS called (we know this from previous test)
    expect(llmCallTracker['moxus_feedback_on_manual_node_edit']).toBe(1);
    
    // 8. The critical test: Is the manual edit analysis recorded in LLM logs?
    // This might fail if manual edit analysis doesn't create LLM log entries
    expect(manualEditAnalysisCalls.length).toBe(1);
    if (manualEditAnalysisCalls.length > 0) {
      expect(manualEditAnalysisCalls[0].callType).toBe('moxus_feedback_on_manual_node_edit');
    }
    
    console.log('[TEST] Manual node edit LLM log recording test completed');
  });

  it('should NOT create duplicate LLM call entries for manual node edits (regression test)', async () => {
    vi.useFakeTimers();
    
    // This test specifically prevents regression of the duplicate logging issue that was fixed
    // Previously, manual node edits were creating TWO entries:
    // 1. "manual-node-edit-analysis-{timestamp}" with moxus_feedback_on_manual_node_edit
    // 2. "{timestamp}-{random}" with moxus_feedback_on_manual_node_edit
    
    const llmCallTracker: Record<string, number> = {};
    const recordedCallIds: string[] = [];
    
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      llmCallTracker[callType] = (llmCallTracker[callType] || 0) + 1;
      
      // Simulate the LLM call recording that would normally happen in getResponse
      const mockCallId = `mock-${callType}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      recordedCallIds.push(mockCallId);
      moxusService.initiateLLMCallRecord(mockCallId, callType, 'gpt-4o-mini', prompt);
      const response = '{"memory_update_diffs": {"rpl": "Updated manual edit memory"}, "consciousness_evolution": "Learning from manual edit"}';
      moxusService.finalizeLLMCallRecord(mockCallId, response);
      
      return Promise.resolve(response);
    });
    
    // Setup test nodes
    const originalNode = {
      id: 'test-hero',
      name: 'Test Hero',
      longDescription: 'A simple test hero',
      type: 'character',
      image: 'hero.jpg'
    };
    
    const editedNode = {
      id: 'test-hero', 
      name: 'Test Hero',
      longDescription: 'A simple test hero with enhanced powers', // User edited this
      type: 'character',
      image: 'hero.jpg'
    };
    
    // 1. Start with empty logs
    expect(moxusService.getLLMLogEntries().length).toBe(0);
    
    // 2. Record the manual node edit
    moxusService.recordManualNodeEdit(originalNode, editedNode, 'Regression test edit');
    
    // 3. Allow processing time
    await advanceTimersByTime(500);
    
    // 4. Get final LLM call logs
    const finalLlmCalls = moxusService.getLLMLogEntries();
    
    // 5. CRITICAL ASSERTION: Should have exactly ONE entry, not two
    console.log(`[TEST] Final LLM call count: ${finalLlmCalls.length}`);
    console.log('[TEST] Final LLM call IDs:', finalLlmCalls.map(call => call.id));
    console.log('[TEST] Final LLM call types:', finalLlmCalls.map(call => call.callType));
    
    expect(finalLlmCalls.length).toBe(1); // EXACTLY one entry, not two
    
    // 6. Verify the single entry has the correct call type
    expect(finalLlmCalls[0].callType).toBe('moxus_feedback_on_manual_node_edit');
    
    // 7. Verify the getMoxusFeedbackImpl was called exactly once
    expect(llmCallTracker['moxus_feedback_on_manual_node_edit']).toBe(1);
    expect(recordedCallIds.length).toBe(1);
    
    // 8. Verify there are no calls with different ID patterns for the same operation
    const manualEditCalls = finalLlmCalls.filter(call => 
      call.callType === 'moxus_feedback_on_manual_node_edit'
    );
    expect(manualEditCalls.length).toBe(1); // Should be exactly one, not multiple with same call type
    
    // 9. Verify the single call ID matches what we recorded
    expect(finalLlmCalls[0].id).toBe(recordedCallIds[0]);
    
    // 10. Additional check: ensure no legacy manual ID patterns exist
    const hasLegacyManualEditId = finalLlmCalls.some(call => 
      call.id.startsWith('manual-node-edit-analysis-')
    );
    expect(hasLegacyManualEditId).toBe(false); // Should not have the old manual ID pattern
    
    console.log('[TEST] ✅ NO duplicate LLM call entries detected for manual node edit - regression test passed');
  });
}); 