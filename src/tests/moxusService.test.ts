import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { moxusService, setMoxusFeedbackImpl } from '../services/MoxusService';
import type { LLMCall } from '../services/MoxusService';
import type { Node } from '../models/Node';
import type { Message } from '../context/ChatContext';
// import ActualAllPromptsYaml from '../prompts-instruct.yaml'; // Not strictly needed for runtime if fully mocked

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

// Mock '../prompts-instruct.yaml'
vi.mock('../prompts-instruct.yaml', () => {
  // Define the constant INSIDE the factory to ensure it's available
  const MOCKED_GENERAL_MEMORY_PROMPT_IN_FACTORY = 'Test general_memory_update prompt: {current_general_memory} {assistant_nodes_content} {chat_text_analysis} {node_editions_analysis} {assistant_feedback_analysis} {node_edit_analysis} {recent_llm_feedbacks}';
  return {
    default: {
      moxus_prompts: {
        general_memory_update: MOCKED_GENERAL_MEMORY_PROMPT_IN_FACTORY,
      },
    }
  };
});

// This constant is now for use in tests, distinct from the one in the mock factory
const MOCKED_GENERAL_MEMORY_PROMPT_FOR_TESTS = 'Test general_memory_update prompt: {current_general_memory} {assistant_nodes_content} {chat_text_analysis} {node_editions_analysis} {assistant_feedback_analysis} {node_edit_analysis} {recent_llm_feedbacks}';

// Mock '../services/llmCore' for getChatHistoryForMoxus
vi.mock('../services/llmCore', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    // Mock getChatHistoryForMoxus to return an array of Message objects
    getChatHistoryForMoxus: vi.fn((chatHistory: Message[], numTurns: number): Message[] => {
      return chatHistory.slice(-numTurns).filter(msg => msg.role === 'user' || msg.role === 'assistant');
    }),
  };
});


// Global mocks for Moxus dependencies
const mockGetMoxusFeedbackImpl = vi.fn();
const mockGetNodesCallback = vi.fn();
const mockAddMessageCallback = vi.fn();
const mockGetChatHistoryCallback = vi.fn();

describe('Moxus Service LLM Calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    
    mockGetMoxusFeedbackImpl.mockResolvedValue('Default Moxus LLM Response from global beforeEach');
    mockGetNodesCallback.mockReturnValue([]);
    mockGetChatHistoryCallback.mockReturnValue([]);

    setMoxusFeedbackImpl(mockGetMoxusFeedbackImpl);
    moxusService.initialize(
      mockGetNodesCallback,
      mockAddMessageCallback,
      mockGetChatHistoryCallback
    );
    (moxusService as any).hasNodeEditionFeedbackCompletedForReport = false;
    (moxusService as any).hasChatTextFeedbackCompletedForReport = false;
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
  
  const DEFAULT_ASSISTANT_NODES_CONTENT = "(No 'assistant' type nodes found)";
  const DEFAULT_CHAT_TEXT_ANALYSIS_HEADER = "# Chat Text Analysis";
  const DEFAULT_NODE_EDITIONS_ANALYSIS_HEADER = "# Node Editions Analysis";
  const INITIAL_NODE_EDITION_MEMORY_CONTENT = '# Node Editions Analysis\n\n*This document analyzes changes to game nodes over time and their impact on the game world.*';

  describe('Task: llmCallFeedback (via handleMemoryUpdate)', () => {
    const mockLLMCall: LLMCall = {
      id: 'call-123',
      prompt: 'Original prompt content for chat text',
      response: 'Original response content for chat text',
      timestamp: new Date(),
      status: 'completed',
      startTime: new Date(),
      endTime: new Date(),
      callType: 'chat_text_generation',
      modelUsed: 'gpt-test',
    };

    const mockNodeEditionLLMCall: LLMCall = {
      id: 'call-node-edition-456',
      prompt: 'Node edition prompt content',
      response: 'yaml: node_edition_response_content',
      timestamp: new Date(),
      status: 'completed',
      startTime: new Date(),
      endTime: new Date(),
      callType: 'node_edition_yaml',
      modelUsed: 'gpt-test-editor',
    };

    it('should generate feedback for a chat_text_generation call and update chatText memory', async () => {
      vi.useFakeTimers();
      const expectedFeedback = 'Moxus feedback for chat text.';
      const updatedChatTextMemory = `# Chat Text Analysis

*This document analyzes narrative quality and coherence in the generated story text.*`;
      mockGetMoxusFeedbackImpl
        .mockResolvedValueOnce(expectedFeedback)
        .mockResolvedValueOnce(updatedChatTextMemory);

      moxusService.initiateLLMCallRecord(mockLLMCall.id, mockLLMCall.callType, mockLLMCall.modelUsed, mockLLMCall.prompt);
      moxusService.finalizeLLMCallRecord(mockLLMCall.id, mockLLMCall.response as string);
      
      await advanceTimersByTime(200); 

      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(2);

      const feedbackCall = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(feedbackCall[0]).toMatch(/^\s*# Task\s*You have to analyze an LLM call\./);
      expect(feedbackCall[0]).toEqual(expect.stringContaining(mockLLMCall.prompt));
      expect(feedbackCall[0]).toEqual(expect.stringContaining(mockLLMCall.response as string));
      expect(feedbackCall[0]).toEqual(expect.stringContaining(DEFAULT_ASSISTANT_NODES_CONTENT));
      expect(feedbackCall[1]).toBe(mockLLMCall.callType);
      
      const memoryAfterFirstCall = moxusService.getMoxusMemory();
      const loggedCall = memoryAfterFirstCall.featureSpecificMemory.llmCalls[mockLLMCall.id];
      expect(loggedCall?.feedback).toBe(expectedFeedback);

      const chatTextMemoryUpdateCall = mockGetMoxusFeedbackImpl.mock.calls[1];
      expect(chatTextMemoryUpdateCall[0]).toEqual(expect.stringContaining('Your name is Moxus, the World Design & Interactivity Watcher'));
      expect(chatTextMemoryUpdateCall[0]).toEqual(expect.stringContaining(DEFAULT_CHAT_TEXT_ANALYSIS_HEADER)); 
      expect(chatTextMemoryUpdateCall[0]).toEqual(expect.stringContaining(`Task Type: chatTextFeedback`));
      expect(chatTextMemoryUpdateCall[0]).toEqual(expect.stringContaining(mockLLMCall.id)); 
      expect(chatTextMemoryUpdateCall[1]).toBe('INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback');

      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.featureSpecificMemory.chatText).toEqual(expect.stringContaining('# Chat Text Analysis'));
      expect(finalMemory.featureSpecificMemory.chatText).toEqual(expect.stringContaining('*This document analyzes narrative quality and coherence in the generated story text.*'));
    });

    it('should generate feedback for a node_edition_yaml call and update nodeEdition memory', async () => {
      vi.useFakeTimers();
      const expectedFeedback = 'Moxus feedback for node edition.';
      const updatedNodeEditionMemory = `# Node Editions Analysis

*This document analyzes changes to game nodes over time and their impact on the game world.*`;
      mockGetMoxusFeedbackImpl
        .mockResolvedValueOnce(expectedFeedback)
        .mockResolvedValueOnce(updatedNodeEditionMemory);

      moxusService.initiateLLMCallRecord(mockNodeEditionLLMCall.id, mockNodeEditionLLMCall.callType, mockNodeEditionLLMCall.modelUsed, mockNodeEditionLLMCall.prompt);
      moxusService.finalizeLLMCallRecord(mockNodeEditionLLMCall.id, mockNodeEditionLLMCall.response as string);
      
      await advanceTimersByTime(200);
      
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(2);

      const feedbackCall = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(feedbackCall[0]).toEqual(expect.stringContaining('You have to analyze an LLM call.'));
      expect(feedbackCall[0]).toEqual(expect.stringContaining(mockNodeEditionLLMCall.prompt));
      expect(feedbackCall[0]).toEqual(expect.stringContaining(mockNodeEditionLLMCall.response as string));
      expect(feedbackCall[1]).toBe(mockNodeEditionLLMCall.callType);

      const memoryAfterFirstCall = moxusService.getMoxusMemory();
      const loggedCall = memoryAfterFirstCall.featureSpecificMemory.llmCalls[mockNodeEditionLLMCall.id];
      expect(loggedCall?.feedback).toBe(expectedFeedback);
      
      const nodeEditionMemoryUpdateCall = mockGetMoxusFeedbackImpl.mock.calls[1];
      expect(nodeEditionMemoryUpdateCall[0]).toEqual(expect.stringContaining('Your name is Moxus, the World Design & Interactivity Watcher'));
      expect(nodeEditionMemoryUpdateCall[0]).toEqual(expect.stringContaining(DEFAULT_NODE_EDITIONS_ANALYSIS_HEADER));
      expect(nodeEditionMemoryUpdateCall[0]).toEqual(expect.stringContaining(`Task Type: llmCallFeedback`)); 
      expect(nodeEditionMemoryUpdateCall[0]).toEqual(expect.stringContaining(mockNodeEditionLLMCall.id));
      expect(nodeEditionMemoryUpdateCall[1]).toBe('INTERNAL_MEMORY_UPDATE_FOR_node_edition');

      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.featureSpecificMemory.nodeEdition).toEqual(expect.stringContaining('# Node Editions Analysis'));
      expect(finalMemory.featureSpecificMemory.nodeEdition).toEqual(expect.stringContaining('*This document analyzes changes to game nodes over time and their impact on the game world.*'));
    });
    
    it('should skip feedback for specified call types like image_prompt_generation', async () => {
      vi.useFakeTimers();
      const imagePromptCall: LLMCall = { ...mockLLMCall, id: 'img-prompt-call', callType: 'image_prompt_generation' };
      
      // Ensure flags are definitely false before this specific test path that should not trigger final report
      (moxusService as any).hasNodeEditionFeedbackCompletedForReport = false;
      (moxusService as any).hasChatTextFeedbackCompletedForReport = false;
      // Also ensure no lingering tasks from other tests trigger anything by resetting task queue if possible
      // moxusService.resetMemory(); //This also resets LLM call log, so be careful.
      // For this test, specifically ensure no LLM calls are made by Moxus.
      mockGetMoxusFeedbackImpl.mockReset(); 
      mockGetMoxusFeedbackImpl.mockResolvedValue('This response should not be used as no call is expected');

      moxusService.initiateLLMCallRecord(imagePromptCall.id, imagePromptCall.callType, imagePromptCall.modelUsed, imagePromptCall.prompt);
      moxusService.finalizeLLMCallRecord(imagePromptCall.id, imagePromptCall.response as string);

      await advanceTimersByTime(200); // Allow any potential tasks (like llmCallFeedback for image_prompt_generation) to process
      
      // Check if any tasks were processed that made an LLM call.
      expect(mockGetMoxusFeedbackImpl).not.toHaveBeenCalled();
      const memory = moxusService.getMoxusMemory();
      expect(memory.featureSpecificMemory.llmCalls[imagePromptCall.id]?.feedback).toBeUndefined();
    });
  });

  describe('Task: finalReport (via handleFinalReport)', () => {
    const mockChatHistoryForReport: Message[] = [{ role: 'user', content: 'Tell me a story.' }];
    const expectedFormattedChatStringForReport = "user: Tell me a story."; 
    
    it('should generate a final report, send it to chat, and queue a GeneralMemory update', async () => {
      vi.useFakeTimers();
      mockGetChatHistoryCallback.mockReturnValue(mockChatHistoryForReport); 

      const initialChatTextMemory = "Some chat text analysis.";
      const initialNodeEditionMemory = "Some node edition analysis.";
      const initialGeneralMemory = "Initial General Memory.";

      moxusService.getMoxusMemory().featureSpecificMemory.chatText = initialChatTextMemory;
      moxusService.getMoxusMemory().featureSpecificMemory.nodeEdition = initialNodeEditionMemory;
      moxusService.getMoxusMemory().GeneralMemory = initialGeneralMemory;

      (moxusService as any).hasNodeEditionFeedbackCompletedForReport = true;
      (moxusService as any).hasChatTextFeedbackCompletedForReport = true;   
      
      const expectedReport = "This is the final Moxus report.";
      const generalMemoryUpdateResponseAfterReport = "General Memory updated after report specific for this test.";
      
      mockGetMoxusFeedbackImpl.mockReset();
      mockGetMoxusFeedbackImpl
        .mockResolvedValueOnce(expectedReport)
        .mockResolvedValueOnce(generalMemoryUpdateResponseAfterReport);

      moxusService.addTask('finalReport', { reason: "Test trigger" }, mockChatHistoryForReport);

      // Wait for first task to complete (finalReport)
      await advanceTimersByTime(500);
      
      // Wait for the second task to be added to the queue and processed
      await advanceTimersByTime(100);
      
      // Process the second task (GeneralMemory update)
      await advanceTimersByTime(500);
      
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(2);

      const reportCall = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(reportCall[0]).toEqual(expect.stringContaining('Your name is Moxus, the World Design & Interactivity Watcher'));
      expect(reportCall[0]).toEqual(expect.stringContaining(initialGeneralMemory));
      expect(reportCall[0]).toEqual(expect.stringContaining(initialChatTextMemory));
      expect(reportCall[0]).toEqual(expect.stringContaining(initialNodeEditionMemory));
      expect(reportCall[0]).toEqual(expect.stringContaining(DEFAULT_ASSISTANT_NODES_CONTENT));
      expect(reportCall[0]).toEqual(expect.stringContaining(expectedFormattedChatStringForReport)); 
      expect(reportCall[1]).toBe('INTERNAL_FINAL_REPORT_GENERATION_STEP');

      expect(mockAddMessageCallback).toHaveBeenCalledWith({
        role: 'moxus',
        content: expect.stringContaining(expectedReport),
      });

      const gmUpdateCall = mockGetMoxusFeedbackImpl.mock.calls[1];
      expect(gmUpdateCall[0]).toEqual(expect.stringContaining(MOCKED_GENERAL_MEMORY_PROMPT_FOR_TESTS.split('{')[0]));
      expect(gmUpdateCall[0]).toEqual(expect.stringContaining(initialGeneralMemory)); 
      expect(gmUpdateCall[0]).toEqual(expect.stringContaining(initialChatTextMemory)); 
      expect(gmUpdateCall[1]).toBe('INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory');

      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.GeneralMemory).toBe(generalMemoryUpdateResponseAfterReport); 
    });
  });

  describe('Task: synthesizeGeneralMemory (via updateGeneralMemoryFromAllSources)', () => {
    it('should update GeneralMemory using the general_memory_update prompt and apply YAML diff (rpl)', async () => {
      vi.useFakeTimers();
      const initialGeneralMemory = "# Moxus Game Analysis\n\n*This document contains general observations and analysis...*";
      moxusService.getMoxusMemory().GeneralMemory = initialGeneralMemory;
      moxusService.getMoxusMemory().featureSpecificMemory.chatText = "Chat analysis for GM.";
      moxusService.getMoxusMemory().featureSpecificMemory.nodeEdition = "Node edition analysis for GM.";
      
      const newGeneralMemoryContent = "Completely new general memory via rpl for this test.";
      const mockJsonResponse = JSON.stringify({
        memory_update_diffs: {
          rpl: newGeneralMemoryContent
        }
      });
      
      mockGetMoxusFeedbackImpl.mockReset();
      mockGetMoxusFeedbackImpl.mockResolvedValueOnce(mockJsonResponse);

      moxusService.addTask('synthesizeGeneralMemory', { reason: "Test GM rpl update" });
      await advanceTimersByTime(200);

      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      const callArgs = mockGetMoxusFeedbackImpl.mock.calls[0];
      const promptUsed = callArgs[0];

      expect(promptUsed).toEqual(expect.stringContaining(MOCKED_GENERAL_MEMORY_PROMPT_FOR_TESTS.split('{')[0])); 
      expect(promptUsed).toEqual(expect.stringContaining(initialGeneralMemory.substring(0,20))); 
      expect(promptUsed).toEqual(expect.stringContaining("Chat analysis for GM.")); 
      expect(promptUsed).toEqual(expect.stringContaining("Node edition analysis for GM.")); 
      expect(promptUsed).toEqual(expect.stringContaining(DEFAULT_ASSISTANT_NODES_CONTENT)); 
      expect(callArgs[1]).toBe('INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory');

      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.GeneralMemory).toBe(newGeneralMemoryContent);
    });

    it('should update GeneralMemory using applyDiffs for df instructions', async () => {
      vi.useFakeTimers();
      const initialGeneralMemory = "Line one.\nLine two with old text.\nLine three.";
      moxusService.getMoxusMemory().GeneralMemory = initialGeneralMemory;
      
      const mockJsonResponse = JSON.stringify({
        memory_update_diffs: {
          df: [
            { prev_txt: "old text", next_txt: "new replacement text" },
            { prev_txt: "Line one.", next_txt: "Updated line one." }
          ]
        }
      });
      mockGetMoxusFeedbackImpl.mockReset();
      mockGetMoxusFeedbackImpl.mockResolvedValueOnce(mockJsonResponse);

      moxusService.addTask('synthesizeGeneralMemory', { reason: "Test GM df update" });
      await advanceTimersByTime(200);

      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      
      const finalMemory = moxusService.getMoxusMemory();
      const expectedGeneralMemory = "Updated line one.\nLine two with new replacement text.\nLine three.";
      expect(finalMemory.GeneralMemory).toBe(expectedGeneralMemory);
    });

    it('should use getChatResetMemoryUpdatePrompt when reason is chat_reset_event', async () => {
      vi.useFakeTimers();
      const initialGeneralMemory = "Some existing GM content.";
      moxusService.getMoxusMemory().GeneralMemory = initialGeneralMemory;
      const previousChatHistoryString = "user: Old message\nassistant: Old response"; 
      const eventDetails = { id: 'evt-1', prompt: 'User clicked reset', response: 'Chat cleared' };
      
      const updatedMemoryFromChatReset = "General memory updated after chat reset analysis.";
      mockGetMoxusFeedbackImpl.mockReset();
      mockGetMoxusFeedbackImpl.mockResolvedValueOnce(updatedMemoryFromChatReset);

      moxusService.addTask('synthesizeGeneralMemory', { 
        reason: "chat_reset_event", 
        eventDetails, 
        previousChatHistoryString 
      });
      await advanceTimersByTime(200);

      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      const callArgs = mockGetMoxusFeedbackImpl.mock.calls[0];
      const promptUsed = callArgs[0];

      expect(promptUsed).toEqual(expect.stringContaining('You are tasked with updating your GeneralMemory document because a "Chat Reset" event has just occurred.'));
      expect(promptUsed).toEqual(expect.stringContaining(previousChatHistoryString));
      expect(promptUsed).toEqual(expect.stringContaining(initialGeneralMemory));
      expect(promptUsed).toEqual(expect.stringContaining(DEFAULT_ASSISTANT_NODES_CONTENT));
      expect(callArgs[1]).toBe('INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory');

      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.GeneralMemory).toBe(updatedMemoryFromChatReset);
    });
  });
}); 