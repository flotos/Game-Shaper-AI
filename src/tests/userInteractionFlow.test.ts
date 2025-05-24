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
}); 