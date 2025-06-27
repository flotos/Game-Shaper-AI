import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { moxusService, setMoxusFeedbackImpl } from '../services/MoxusService';
import { Message } from '../context/ChatContext';

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

describe('Advanced Node Generation - Moxus Exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    
    mockGetMoxusFeedbackImpl.mockResolvedValue('Should not be called for advanced node generation');
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
  });

  it('should not trigger Moxus feedback for advanced_node_planning calls', () => {
    moxusService.initiateLLMCallRecord('test-planning', 'advanced_node_planning', 'gpt-4', 'Planning prompt');
    moxusService.finalizeLLMCallRecord('test-planning', 'Planning response');
    
    expect(moxusService.getPendingTaskCount()).toBe(0);
    expect(mockGetMoxusFeedbackImpl).not.toHaveBeenCalled();
  });

  it('should not trigger Moxus feedback for advanced_node_content_generation calls', () => {
    moxusService.initiateLLMCallRecord('test-generation', 'advanced_node_content_generation', 'gpt-4', 'Generation prompt');
    moxusService.finalizeLLMCallRecord('test-generation', 'Generation response');
    
    expect(moxusService.getPendingTaskCount()).toBe(0);
    expect(mockGetMoxusFeedbackImpl).not.toHaveBeenCalled();
  });

  it('should not trigger Moxus feedback for advanced_node_validation calls', () => {
    moxusService.initiateLLMCallRecord('test-validation', 'advanced_node_validation', 'gpt-4', 'Validation prompt');
    moxusService.finalizeLLMCallRecord('test-validation', 'Validation response');
    
    expect(moxusService.getPendingTaskCount()).toBe(0);
    expect(mockGetMoxusFeedbackImpl).not.toHaveBeenCalled();
  });

  it('should still trigger Moxus feedback for regular chat_text_generation calls', () => {
    moxusService.initiateLLMCallRecord('test-chat', 'chat_text_generation', 'gpt-4', 'Chat prompt');
    moxusService.finalizeLLMCallRecord('test-chat', 'Chat response');
    
    expect(moxusService.getPendingTaskCount()).toBe(1);
  });

  it('should still trigger Moxus feedback for regular node_edition_json calls', () => {
    moxusService.initiateLLMCallRecord('test-node-edit', 'node_edition_json', 'gpt-4', 'Node edit prompt');
    moxusService.finalizeLLMCallRecord('test-node-edit', 'Node edit response');
    
    expect(moxusService.getPendingTaskCount()).toBe(1);
  });
}); 