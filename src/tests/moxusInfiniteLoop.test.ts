import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { moxusService, setMoxusFeedbackImpl } from '../services/MoxusService';
import { Message } from '../context/ChatContext';

// Mock localStorage for test environment
const localStorageMock = {
  clear: vi.fn(),
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  length: 0,
  key: vi.fn()
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

const mockGetMoxusFeedbackImpl = vi.fn();
const mockGetNodesCallback = vi.fn();
const mockAddMessageCallback = vi.fn();
const mockGetChatHistoryCallback = vi.fn();

describe('Moxus Service - Infinite Loop Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    
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

  it('should prevent infinite loop when node_creation_from_prompt generates feedback that analyzes its own output', async () => {
    vi.useFakeTimers();
    
    // Track all LLM calls made by callType
    const llmCallTracker: Record<string, number> = {};
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      llmCallTracker[callType] = (llmCallTracker[callType] || 0) + 1;
      
      // Simulate the actual problem: the feedback prompt contains the original prompt
      // which is what was causing the infinite loop
      if (callType === 'node_creation_from_prompt') {
        // This would be the feedback analyzing the node_creation_from_prompt call
        // In the real scenario, this feedback call would have the same callType as the original
        return Promise.resolve('Analysis of the node creation from prompt call');
      }
      
      return Promise.resolve('Moxus feedback response for ' + callType);
    });
    
    // STEP 1: Record a node_creation_from_prompt call (this is what the Assistant feature does)
    const assistantCallId = 'assistant-node-creation-123';
    moxusService.initiateLLMCallRecord(
      assistantCallId,
      'node_creation_from_prompt',
      'gpt-4',
      'Create new nodes based on user prompt'
    );
    
    moxusService.finalizeLLMCallRecord(
      assistantCallId,
      JSON.stringify({
        n_nodes: [{
          id: 'new-hero',
          name: 'Enhanced Hero',
          longDescription: 'A powerful hero with enhanced abilities',
          type: 'character',
          updateImage: true
        }]
      })
    );
    
    // STEP 2: Allow time for feedback processing
    await advanceTimersByTime(200);
    
    // STEP 3: Allow more time for any cascading feedback loops
    await advanceTimersByTime(200);
    await advanceTimersByTime(200);
    await advanceTimersByTime(200);
    
    // STEP 4: Verify the system does not get stuck in an infinite loop
    console.log('[TEST] LLM call tracker:', llmCallTracker);
    
    // FIXED: node_creation_from_prompt should NOT generate any feedback to prevent infinite loops
    expect(llmCallTracker['node_creation_from_prompt']).toBeUndefined(); // Should not be called for feedback
    
    // Verify total calls is reasonable (should be 0 now that we skip feedback)
    const totalMoxusCallCount = mockGetMoxusFeedbackImpl.mock.calls.length;
    expect(totalMoxusCallCount).toBe(0); // Should be 0 since we skip node_creation_from_prompt feedback
    
    // Verify the LLM call log only contains the original call, no feedback calls
    const llmCalls = moxusService.getLLMLogEntries();
    expect(llmCalls.length).toBe(1); // Only the original node_creation_from_prompt call
    expect(llmCalls[0].callType).toBe('node_creation_from_prompt');
    expect(llmCalls[0].feedback).toBeUndefined(); // No feedback should be generated
    
    console.log('[TEST] ✅ Infinite loop prevention test passed - node_creation_from_prompt feedback completely skipped');
  });
  
  it('should properly skip feedback for node_creation_from_prompt calls to prevent infinite recursion', async () => {
    vi.useFakeTimers();
    
    // Track feedback calls
    const feedbackCallTypes: string[] = [];
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      feedbackCallTypes.push(callType);
      return Promise.resolve('Feedback for ' + callType);
    });
    
    // Record a node_creation_from_prompt call
    moxusService.initiateLLMCallRecord(
      'test-node-creation',
      'node_creation_from_prompt',
      'gpt-4',
      'Test prompt'
    );
    
    moxusService.finalizeLLMCallRecord(
      'test-node-creation',
      'Test response'
    );
    
    // Allow processing
    await advanceTimersByTime(300);
    
    // EXPECTATION: node_creation_from_prompt should be in the skip list to prevent infinite loops
    // If this test fails, it means node_creation_from_prompt is generating feedback, which is the bug
    expect(feedbackCallTypes).toHaveLength(0); // No feedback should be generated
    
    // Verify no pending tasks remain
    expect(moxusService.getPendingTaskCount()).toBe(0);
    
    console.log('[TEST] ✅ node_creation_from_prompt properly skipped feedback generation');
  });
}); 