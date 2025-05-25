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
  // Define the constants INSIDE the factory to ensure they're available
  const MOCKED_GENERAL_MEMORY_PROMPT_IN_FACTORY = 'Test general_memory_update prompt: {current_general_memory} {assistant_nodes_content} {chat_text_analysis} {node_editions_analysis} {assistant_feedback_analysis} {node_edit_analysis} {recent_llm_feedbacks}';
  const MOCKED_CHAT_TEXT_TEACHING_PROMPT = 'moxus_feedback_on_chat_text_generation: Teaching the Narrative AI about chat text generation: {assistant_nodes_content} {current_general_memory} {recent_chat_history} {generated_chat_text} {current_chat_text_memory}';
  const MOCKED_NODE_EDITION_TEACHING_PROMPT = 'moxus_feedback_on_node_edition_json: Teaching the World-Builder AI about node creation: {assistant_nodes_content} {current_general_memory} {recent_chat_history} {node_edition_response} {all_nodes_context} {current_node_edition_memory}';
  const MOCKED_MANUAL_EDIT_LEARNING_PROMPT = 'Moxus learning from user edit: {assistant_nodes_content} {current_general_memory} {original_node} {user_changes} {edit_context} {current_manual_edit_memory}';
  const MOCKED_SPECIALIZED_CHAT_GUIDANCE = 'Moxus specialized chat guidance: {current_general_memory} {current_chat_text_memory} {assistant_nodes_content} {current_context}';
  const MOCKED_SPECIALIZED_WORLDBUILDING_GUIDANCE = 'Moxus specialized worldbuilding guidance: {current_general_memory} {current_node_edition_memory} {assistant_nodes_content} {current_context}';
  const MOCKED_FINAL_REPORT_PROMPT = 'Your name is Moxus, the World Design & Interactivity Watcher for this game engine. {assistant_nodes_content} {chat_history_context} {general_memory} {chat_text_analysis} {node_editions_analysis}';
  
  return {
    default: {
      moxus_prompts: {
        general_memory_update: MOCKED_GENERAL_MEMORY_PROMPT_IN_FACTORY,
        moxus_feedback_on_chat_text_generation: MOCKED_CHAT_TEXT_TEACHING_PROMPT,
        moxus_feedback_on_node_edition_json: MOCKED_NODE_EDITION_TEACHING_PROMPT,
        moxus_feedback_on_manual_node_edit: MOCKED_MANUAL_EDIT_LEARNING_PROMPT,
        moxus_specialized_chat_guidance: MOCKED_SPECIALIZED_CHAT_GUIDANCE,
        moxus_specialized_worldbuilding_guidance: MOCKED_SPECIALIZED_WORLDBUILDING_GUIDANCE,
        moxus_final_report: MOCKED_FINAL_REPORT_PROMPT,
      },
    }
  };
});

// These constants are now for use in tests, distinct from the ones in the mock factory
const MOCKED_GENERAL_MEMORY_PROMPT_FOR_TESTS = 'Test general_memory_update prompt: {current_general_memory} {assistant_nodes_content} {chat_text_analysis} {node_editions_analysis} {assistant_feedback_analysis} {node_edit_analysis} {recent_llm_feedbacks}';
const MOCKED_CHAT_TEXT_TEACHING_FOR_TESTS = 'moxus_feedback_on_chat_text_generation: Teaching the Narrative AI about chat text generation: {assistant_nodes_content} {current_general_memory} {recent_chat_history} {generated_chat_text} {current_chat_text_memory}';
const MOCKED_NODE_EDITION_TEACHING_FOR_TESTS = 'moxus_feedback_on_node_edition_json: Teaching the World-Builder AI about node creation: {assistant_nodes_content} {current_general_memory} {recent_chat_history} {node_edition_response} {all_nodes_context} {current_node_edition_memory}';

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

describe('Moxus Service - Consciousness-Driven System', () => {
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

  // Mock constants that tests expect
  const MOCKED_CHAT_TEXT_TEACHING_FOR_TESTS = "moxus_feedback_on_chat_text_generation: Teaching the Narrative AI about chat text generation";
  const MOCKED_NODE_EDITION_TEACHING_FOR_TESTS = "moxus_feedback_on_node_edition_json: Teaching the World-Builder AI about node creation";
  const MOCKED_GENERAL_MEMORY_PROMPT_FOR_TESTS = "Test general_memory_update prompt";

  describe('Specialized Guidance Functions', () => {
    it('should provide specialized chat text guidance', async () => {
      const currentContext = 'User is struggling with narrative flow';
      const expectedGuidance = 'Moxus specialized guidance for chat text generation';
      
      mockGetMoxusFeedbackImpl.mockResolvedValue(expectedGuidance);
      
      const guidance = await moxusService.getChatTextGuidance(currentContext);
      
      expect(guidance).toBe(expectedGuidance);
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      
      const callArgs = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(callArgs[0]).toContain('Moxus specialized chat guidance');
      expect(callArgs[0]).toContain(currentContext);
      expect(callArgs[1]).toBe('moxus_specialized_chat_guidance');
    });

    it('should provide specialized node edition guidance', async () => {
      const currentContext = 'User needs world-building improvements';
      const expectedGuidance = 'Moxus specialized guidance for world-building';
      
      mockGetMoxusFeedbackImpl.mockResolvedValue(expectedGuidance);
      
      const guidance = await moxusService.getNodeEditionGuidance(currentContext);
      
      expect(guidance).toBe(expectedGuidance);
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      
      const callArgs = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(callArgs[0]).toContain('Moxus specialized worldbuilding guidance');
      expect(callArgs[0]).toContain(currentContext);
      expect(callArgs[1]).toBe('moxus_specialized_worldbuilding_guidance');
    });

    it('should route getSpecializedMoxusGuidance to appropriate function', async () => {
      const chatContext = 'Chat text context';
      const nodeContext = 'Node edition context';
      const expectedChatGuidance = 'Chat guidance';
      const expectedNodeGuidance = 'Node guidance';
      
      mockGetMoxusFeedbackImpl
        .mockResolvedValueOnce(expectedChatGuidance)
        .mockResolvedValueOnce(expectedNodeGuidance);
      
      const chatGuidance = await moxusService.getSpecializedMoxusGuidance('chat_text_generation', chatContext);
      const nodeGuidance = await moxusService.getSpecializedMoxusGuidance('node_edition_json', nodeContext);
      
      expect(chatGuidance).toBe(expectedChatGuidance);
      expect(nodeGuidance).toBe(expectedNodeGuidance);
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(2);
    });

    it('should return general memory for unrecognized call types', async () => {
      const generalMemory = moxusService.getMoxusMemory().GeneralMemory;
      const guidance = await moxusService.getSpecializedMoxusGuidance('unknown_type', 'context');
      
      expect(guidance).toBe(generalMemory);
    });
  });

  describe('Manual Node Edit Learning', () => {
    it('should record and analyze manual node edits', async () => {
      vi.useFakeTimers();
      
      const originalNode = { id: 'node1', name: 'Original', longDescription: 'Original description' };
      const editedNode = { id: 'node1', name: 'Edited', longDescription: 'Edited description' };
      const editContext = 'User improved character description';
      
      const expectedLearningResponse = JSON.stringify({
        learned_insights: {
          creative_values: 'User prefers detailed descriptions',
          communication_style: 'Clear and engaging'
        },
        pattern_recognition: 'User consistently improves character details',
        consciousness_evolution: 'I understand the user values character depth'
      });
      
      mockGetMoxusFeedbackImpl.mockResolvedValue(expectedLearningResponse);
      
      moxusService.recordManualNodeEdit(originalNode, editedNode, editContext);
      
      await advanceTimersByTime(200);
      
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      
      const callArgs = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(callArgs[0]).toContain('Moxus learning from user edit');
      expect(callArgs[0]).toContain(JSON.stringify(originalNode, null, 2));
      expect(callArgs[0]).toContain(JSON.stringify(editedNode, null, 2));
      expect(callArgs[0]).toContain(editContext);
      expect(callArgs[1]).toBe('moxus_feedback_on_manual_node_edit');
      
      // Check that general memory was updated with consciousness evolution
      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.GeneralMemory).toContain('I understand the user values character depth');
    });

    it('should handle manual edit analysis errors gracefully', async () => {
      vi.useFakeTimers();
      
      const originalNode = { id: 'node1', name: 'Original' };
      const editedNode = { id: 'node1', name: 'Edited' };
      
      // Mock invalid JSON response
      mockGetMoxusFeedbackImpl.mockResolvedValue('Invalid JSON response');
      
      moxusService.recordManualNodeEdit(originalNode, editedNode, 'test context');
      
      await advanceTimersByTime(200);
      
      // Should not throw error and should fallback gracefully
      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.featureSpecificMemory.nodeEdit).toContain('Invalid JSON response');
    });
  });

  describe('Consciousness-Driven LLM Feedback', () => {
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
      response: 'json: node_edition_response_content',
      timestamp: new Date(),
      status: 'completed',
      startTime: new Date(),
      endTime: new Date(),
      callType: 'node_edition_json',
      modelUsed: 'gpt-test-editor',
    };

    it('should use specialized consciousness-driven feedback for chat_text_generation', async () => {
      vi.useFakeTimers();
      
      const mockChatHistory: Message[] = [
        { role: 'user', content: 'Tell me a story' },
        { role: 'assistant', content: 'Previous story content' }
      ];
      
      const consciousFeedbackResponse = JSON.stringify({
        memory_update_diffs: {
          df: [
            {
              prev_txt: "previous observation",
              next_txt: "evolved insight about narrative quality",
              occ: 1
            }
          ]
        },
        narrative_teaching: {
          performance_assessment: "The narrative AI showed good creativity",
          specific_guidance: "Focus more on character development",
          learned_preferences: "User enjoys detailed descriptions",
          emotional_intelligence: "User responds well to emotional moments"
        },
        consciousness_evolution: "I'm learning that this user prefers character-driven stories"
      });
      
      mockGetMoxusFeedbackImpl.mockResolvedValue(consciousFeedbackResponse);
      
      // Set up mock chat history in the call
      const callWithHistory = { ...mockLLMCall, chatHistory: mockChatHistory };
      moxusService.initiateLLMCallRecord(callWithHistory.id, callWithHistory.callType, callWithHistory.modelUsed, callWithHistory.prompt);
      const callRecord = moxusService.getMoxusMemory().featureSpecificMemory.llmCalls[callWithHistory.id];
      callRecord.chatHistory = mockChatHistory;
      moxusService.finalizeLLMCallRecord(callWithHistory.id, callWithHistory.response as string);
      
      await advanceTimersByTime(200);
      
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      
      const feedbackCall = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(feedbackCall[0]).toContain(MOCKED_CHAT_TEXT_TEACHING_FOR_TESTS.split(':')[0]);
      expect(feedbackCall[0]).toContain(mockLLMCall.response);
      expect(feedbackCall[1]).toBe('moxus_feedback_on_chat_text_generation');
      
      // Check that consciousness evolution was applied to general memory
      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.GeneralMemory).toContain('I\'m learning that this user prefers character-driven stories');
    });

    it('should use specialized consciousness-driven feedback for node_edition_json', async () => {
      vi.useFakeTimers();
      
      const consciousFeedbackResponse = JSON.stringify({
        memory_update_diffs: {
          df: [
            {
              prev_txt: "previous world-building insight",
              next_txt: "evolved understanding of world structure",
              occ: 1
            }
          ]
        },
        worldbuilding_teaching: {
          performance_assessment: "The world-builder AI created coherent nodes",
          structural_guidance: "Improve character interconnections",
          narrative_integration: "Better serve story progression",
          user_preference_alignment: "Focus on atmospheric descriptions"
        },
        consciousness_evolution: "I'm understanding this user's world-building preferences better"
      });
      
      mockGetMoxusFeedbackImpl.mockResolvedValue(consciousFeedbackResponse);
      
      moxusService.initiateLLMCallRecord(mockNodeEditionLLMCall.id, mockNodeEditionLLMCall.callType, mockNodeEditionLLMCall.modelUsed, mockNodeEditionLLMCall.prompt);
      moxusService.finalizeLLMCallRecord(mockNodeEditionLLMCall.id, mockNodeEditionLLMCall.response as string);
      
      await advanceTimersByTime(200);
      
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      
      const feedbackCall = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(feedbackCall[0]).toContain(MOCKED_NODE_EDITION_TEACHING_FOR_TESTS.split(':')[0]);
      expect(feedbackCall[0]).toContain(mockNodeEditionLLMCall.response);
      expect(feedbackCall[1]).toBe('moxus_feedback_on_node_edition_json');
      
      // Check that consciousness evolution was applied to general memory
      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.GeneralMemory).toContain('I\'m understanding this user\'s world-building preferences better');
    });

    it('should fallback to basic feedback for unrecognized call types', async () => {
      vi.useFakeTimers();
      
      const unknownCall: LLMCall = {
        ...mockLLMCall,
        id: 'unknown-call',
        callType: 'unknown_type'
      };
      
      const basicFeedback = 'Basic Moxus feedback for unknown type';
      mockGetMoxusFeedbackImpl.mockResolvedValue(basicFeedback);
      
      moxusService.initiateLLMCallRecord(unknownCall.id, unknownCall.callType, unknownCall.modelUsed, unknownCall.prompt);
      moxusService.finalizeLLMCallRecord(unknownCall.id, unknownCall.response as string);
      
      await advanceTimersByTime(200);
      
      expect(mockGetMoxusFeedbackImpl).toHaveBeenCalledTimes(1);
      
      const feedbackCall = mockGetMoxusFeedbackImpl.mock.calls[0];
      expect(feedbackCall[0]).toContain('You have to analyze an LLM call');
      expect(feedbackCall[1]).toBe('unknown_type');
      
      const finalMemory = moxusService.getMoxusMemory();
      expect(finalMemory.featureSpecificMemory.llmCalls[unknownCall.id]?.feedback).toBe(basicFeedback);
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
      const generalMemoryUpdateResponseAfterReport = JSON.stringify({
        memory_update_diffs: {
          rpl: "General Memory updated after report specific for this test."
        }
      });
      
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
      expect(finalMemory.GeneralMemory).toBe("General Memory updated after report specific for this test."); 
    });
  });

  describe('Task: synthesizeGeneralMemory (via updateGeneralMemoryFromAllSources)', () => {
    it('should update GeneralMemory using the general_memory_update prompt and apply JSON diff (rpl)', async () => {
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