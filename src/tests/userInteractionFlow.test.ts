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

  it('should process a complete chain of LLM calls after a user interaction', async () => {
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
        name: 'Fantasy World',
        longDescription: 'A magical realm',
        type: 'location',
        image: 'world.jpg'
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
      { role: 'user', content: 'Tell me a story about a hero' },
      { role: 'assistant', content: 'Once upon a time...' },
      { role: 'user', content: 'What happens next?' }
    ];
    
    mockGetNodesCallback.mockReturnValue(mockNodes);
    mockGetChatHistoryCallback.mockReturnValue(mockChatHistory);
    
    // Setup different responses for each stage of the process
    mockGetMoxusFeedbackImpl.mockReset();
    mockGetMoxusFeedbackImpl.mockImplementation((prompt, callType) => {
      console.log(`[TEST] MockGetMoxusFeedback called with callType: ${callType}`);
      return Promise.resolve('Moxus feedback response');
    });
    
    // STEP 1: First LLM call - Chat text generation
    const chatTextCallId = 'flow-chat-text-123';
    moxusService.initiateLLMCallRecord(
      chatTextCallId,
      'chat_text_generation',
      'gpt-4o',
      'Generate a response to the user question about what happens next'
    );
    
    // Add chat history to the LLM call
    moxusService.getMoxusMemory().featureSpecificMemory.llmCalls[chatTextCallId].chatHistory = mockChatHistory;
    
    // Finalize the chat text call
    moxusService.finalizeLLMCallRecord(
      chatTextCallId,
      'The hero ventured into the dark forest, where ancient secrets awaited...'
    );
    
    // Allow time for feedback task to be queued and processed
    await advanceTimersByTime(300);
    
    // STEP 2: Second LLM call - Node edition based on the new narrative
    const nodeEditionCallId = 'flow-node-edition-456';
    moxusService.initiateLLMCallRecord(
      nodeEditionCallId,
      'node_edition_yaml',
      'gpt-4o',
      'Update nodes based on the hero entering the forest'
    );
    
    // Finalize the node edition call
    moxusService.finalizeLLMCallRecord(
      nodeEditionCallId,
      `
n_nodes:
  - id: forest1
    name: Dark Forest
    type: location
    longDescription: An ancient forest filled with mysteries and secrets.
    image: forest.jpg
u_nodes:
  "char1":
    longDescription:
      df:
        - prev_txt: "A brave hero"
          next_txt: "A brave hero exploring the ancient forest"
`
    );
    
    // Allow time for feedback and memory updates
    await advanceTimersByTime(300);
    
    // STEP 3: Manually trigger a final report
    console.log('[TEST] About to add finalReport task');
    moxusService.addTask('finalReport', { reason: "Test-driven final report" }, mockChatHistory);
    
    // Allow more time for the final report and general memory update
    console.log('[TEST] Advancing time for final report processing');
    await advanceTimersByTime(300);
    await advanceTimersByTime(300);
    
    // VERIFY THE COMPLETE FLOW
    console.log('[TEST] Starting verification');
    
    // 1. Verify all LLM calls were recorded
    const llmCalls = moxusService.getLLMLogEntries();
    expect(llmCalls.length).toBe(2);
    expect(llmCalls.some(call => call.id === chatTextCallId)).toBe(true);
    expect(llmCalls.some(call => call.id === nodeEditionCallId)).toBe(true);
    
    // 2. Verify feedback was generated for both calls
    const chatTextCall = llmCalls.find(call => call.id === chatTextCallId);
    const nodeEditionCall = llmCalls.find(call => call.id === nodeEditionCallId);
    expect(chatTextCall?.feedback).toBeTruthy();
    expect(nodeEditionCall?.feedback).toBeTruthy();
    
    // 3. Verify memory was updated in all areas
    const memory = moxusService.getMoxusMemory();
    expect(memory.featureSpecificMemory.chatText).toBeTruthy();
    expect(memory.featureSpecificMemory.nodeEdition).toBeTruthy();
    expect(memory.GeneralMemory).toBeTruthy();
    
    // 4. Verify that a Moxus report was sent to chat
    expect(mockAddMessageCallback).toHaveBeenCalledWith(expect.objectContaining({
      role: 'moxus',
      content: expect.any(String)
    }));
    
    // 5. Verify a reasonable number of LLM calls were made by Moxus
    const callCount = mockGetMoxusFeedbackImpl.mock.calls.length;
    console.log(`[TEST] mockGetMoxusFeedbackImpl was called ${callCount} times`);
    mockGetMoxusFeedbackImpl.mock.calls.forEach((call, index) => {
      console.log(`[TEST] Call ${index + 1} callType: ${call[1]}`);
    });
    
    // We expect at least 4 calls (chat feedback, node feedback, chat memory, final report)
    expect(callCount).toBeGreaterThanOrEqual(4);
    // The general memory update and node edition memory update might happen in different order
    expect(callCount).toBeLessThanOrEqual(6);
  });
}); 