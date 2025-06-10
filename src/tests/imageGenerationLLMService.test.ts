import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getResponse, loadedPrompts, formatPrompt } from '../services/llmCore';
import { generateImagePrompt } from '../services/imageGenerationLLMService';
import type { Message } from '../context/ChatContext';
import type { Node } from '../models/Node';

// Mock the llmCore module
vi.mock('../services/llmCore', () => ({
  getResponse: vi.fn(),
  loadedPrompts: {
    image_generation: {
      base_prompt_with_instructions_node: 'Test prompt with instructions: {image_generation_nodes_content} {node_name} {node_long_description} {node_type} {type_specific_prompt_addition} {all_nodes_context} {chat_history_context}',
      base_prompt_default: 'Test default prompt: {node_name} {node_long_description} {node_type} {type_specific_prompt_addition} {all_nodes_context} {chat_history_context}',
      type_specific_additions: {
        'character': 'Additional instructions for character',
        'location': 'Additional instructions for location',
        'default': 'Default additional instructions'
      }
    }
  },
  formatPrompt: vi.fn((template: string, replacements: Record<string, string | undefined>) => {
    let result = template;
    for (const key in replacements) {
      const value = replacements[key];
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
    }
    return result;
  })
}));

// Mock MoxusService
vi.mock('../services/MoxusService', () => ({
  moxusService: {
    initiateLLMCallRecord: vi.fn(),
    finalizeLLMCallRecord: vi.fn(),
    failLLMCallRecord: vi.fn(),
    getLLMLogEntries: vi.fn().mockReturnValue([])
  }
}));

describe('Image Generation LLM Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({ 
      llmResult: 'A test image prompt description', 
      callId: 'test-image-prompt-id' 
    });
  });

  // Common mock data
  const mockNode: Partial<Node> = {
    id: 'test-node-1',
    name: 'Test Character',
    longDescription: 'This is a test character with distinctive features',
    image: 'placeholder.jpg',
    type: 'character'
  };

  const mockAllNodes: Node[] = [
    {
      id: 'test-node-1',
      name: 'Test Character',
      longDescription: 'This is a test character with distinctive features',
      image: 'placeholder.jpg',
      type: 'character'
    },
    {
      id: 'test-node-2',
      name: 'Forest Location',
      longDescription: 'A dense forest with tall trees',
      image: 'forest.jpg',
      type: 'location'
    }
  ];

  const mockChatHistory: Message[] = [
    { role: 'user', content: 'Create an adventurer character' },
    { role: 'assistant', content: 'I created a brave adventurer with a sword' }
  ];

  describe('generateImagePrompt', () => {
    it('should use base_prompt_default when no image_generation nodes exist', async () => {
      await generateImagePrompt(mockNode, mockAllNodes, mockChatHistory);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        loadedPrompts.image_generation.base_prompt_default,
        expect.objectContaining({
          node_name: mockNode.name,
          node_type: mockNode.type,
          node_long_description: mockNode.longDescription,
          type_specific_prompt_addition: 'Additional instructions for character',
          all_nodes_context: expect.stringContaining('Test Character'),
          chat_history_context: expect.stringContaining('Create an adventurer character')
        })
      );
    });

    it('should use base_prompt_with_instructions_node when image_generation nodes exist', async () => {
      const nodesWithImageGen = [
        ...mockAllNodes,
        {
          id: 'img-gen-1',
          name: 'Image Generator',
          longDescription: 'Special image generation instructions',
          image: 'none.jpg',
          type: 'image_generation'
        }
      ];

      await generateImagePrompt(mockNode, nodesWithImageGen, mockChatHistory);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        loadedPrompts.image_generation.base_prompt_with_instructions_node,
        expect.objectContaining({
          image_generation_nodes_content: expect.stringContaining('Special image generation instructions'),
          node_name: mockNode.name,
          node_type: mockNode.type
        })
      );
    });

    it('should call getResponse with correct parameters', async () => {
      await generateImagePrompt(mockNode, mockAllNodes, mockChatHistory);

      expect(getResponse).toHaveBeenCalledTimes(1);
      expect(getResponse).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ role: 'system' })]),
        undefined,
        undefined,
        false,
        undefined,
        { skipMoxusFeedback: true },
        'image_prompt_generation'
      );
    });

    it('should return the LLM result string', async () => {
      const result = await generateImagePrompt(mockNode, mockAllNodes, mockChatHistory);
      expect(result).toBe('A test image prompt description');
    });

    it('should handle errors and call failLLMCallRecord', async () => {
      const mockError = new Error('LLM API Error for image prompt generation');
      (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
      
      const result = await generateImagePrompt(mockNode, mockAllNodes, mockChatHistory);
      expect(result).toBe('');
    });

    it('should handle empty chat history', async () => {
      await generateImagePrompt(mockNode, mockAllNodes, []);

      expect(formatPrompt).toHaveBeenCalledWith(
        loadedPrompts.image_generation.base_prompt_default,
        expect.objectContaining({
          chat_history_context: ''
        })
      );
    });
  });
}); 