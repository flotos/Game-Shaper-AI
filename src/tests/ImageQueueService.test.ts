import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageQueueService } from '../services/ImageQueueService';
import { generateImage } from '../services/ImageService';
import { generateImagePrompt } from '../services/imageGenerationLLMService';
import type { Node } from '../models/Node';

// Mock dependencies
vi.mock('../services/ImageService', () => ({
  generateImage: vi.fn()
}));

vi.mock('../services/imageGenerationLLMService', () => ({
  generateImagePrompt: vi.fn()
}));

describe('ImageQueueService', () => {
  const mockNode: Node = {
    id: 'test-node-1',
    name: 'Test Node',
    longDescription: 'A test node description',
    image: 'placeholder.jpg',
    type: 'character',
    updateImage: true
  };

  const mockNodes: Node[] = [mockNode];
  const mockChatHistory: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset the queue by accessing private property (for testing only)
    (imageQueueService as any).queue = [];
    (imageQueueService as any).isProcessing = false;
    
    // Mock dependencies
    (generateImagePrompt as ReturnType<typeof vi.fn>).mockResolvedValue('Test prompt for image');
    (generateImage as ReturnType<typeof vi.fn>).mockResolvedValue('data:image/png;base64,mockImageData');
  });

  describe('addToQueue', () => {
    it('should add a node to the queue and start processing', async () => {
      vi.useFakeTimers();
      const updateNodeCallback = vi.fn();
      imageQueueService.setUpdateNodeCallback(updateNodeCallback);
      
      await imageQueueService.addToQueue(mockNode, mockNodes, mockChatHistory);
      
      // Allow processing to complete
      await vi.runAllTimersAsync();
      
      // Verify image prompt was generated
      expect(generateImagePrompt).toHaveBeenCalledWith(mockNode, mockNodes, mockChatHistory);
      
      // Verify image was generated
      expect(generateImage).toHaveBeenCalledWith('Test prompt for image', undefined, 'character');
      
      // Verify node was updated with new image
      expect(updateNodeCallback).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test-node-1',
        image: 'data:image/png;base64,mockImageData',
        updateImage: false
      }));
      
      vi.useRealTimers();
    });

    it('should skip processing if updateImage is false', async () => {
      const nodeWithoutUpdate: Node = {
        ...mockNode,
        updateImage: false
      };
      
      await imageQueueService.addToQueue(nodeWithoutUpdate, mockNodes, mockChatHistory);
      
      // Verify no processing happened
      expect(generateImagePrompt).not.toHaveBeenCalled();
      expect(generateImage).not.toHaveBeenCalled();
    });

    it('should handle errors in image prompt generation', async () => {
      (generateImagePrompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Prompt generation failed'));
      
      await imageQueueService.addToQueue(mockNode, mockNodes, mockChatHistory);
      
      // Verify error was handled
      expect(generateImage).not.toHaveBeenCalled();
    });
  });

  describe('addToQueueWithExistingPrompt', () => {
    it('should add a node with an existing prompt to the queue', async () => {
      vi.useFakeTimers();
      const updateNodeCallback = vi.fn();
      imageQueueService.setUpdateNodeCallback(updateNodeCallback);
      
      const existingPrompt = 'Existing image prompt';
      await imageQueueService.addToQueueWithExistingPrompt(mockNode, existingPrompt);
      
      // Allow processing to complete
      await vi.runAllTimersAsync();
      
      // Verify image prompt was NOT generated (we used existing)
      expect(generateImagePrompt).not.toHaveBeenCalled();
      
      // Verify image was generated with existing prompt
      expect(generateImage).toHaveBeenCalledWith(existingPrompt, undefined, 'character');
      
      // Verify node was updated with new image
      expect(updateNodeCallback).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test-node-1',
        image: 'data:image/png;base64,mockImageData',
        updateImage: false
      }));
      
      vi.useRealTimers();
    });

    it('should skip processing if updateImage is false', async () => {
      const nodeWithoutUpdate: Node = {
        ...mockNode,
        updateImage: false
      };
      
      await imageQueueService.addToQueueWithExistingPrompt(nodeWithoutUpdate, 'Test prompt');
      
      // Verify no processing happened
      expect(generateImage).not.toHaveBeenCalled();
    });
  });

  describe('processQueue', () => {
    it('should process multiple items in queue sequentially', async () => {
      vi.useFakeTimers();
      const updateNodeCallback = vi.fn();
      imageQueueService.setUpdateNodeCallback(updateNodeCallback);
      
      const node1: Node = { ...mockNode, id: 'node-1' };
      const node2: Node = { ...mockNode, id: 'node-2' };
      
      // Setup different responses for each node
      (generateImagePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('Prompt for node 1')
        .mockResolvedValueOnce('Prompt for node 2');
      
      (generateImage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('data:image/png;base64,image1')
        .mockResolvedValueOnce('data:image/png;base64,image2');
      
      // Add both nodes to the queue
      await imageQueueService.addToQueue(node1, mockNodes, mockChatHistory);
      await imageQueueService.addToQueue(node2, mockNodes, mockChatHistory);
      
      // Allow processing to complete for both nodes
      await vi.runAllTimersAsync();
      
      // Verify both nodes were processed
      expect(updateNodeCallback).toHaveBeenCalledTimes(2);
      expect(updateNodeCallback).toHaveBeenNthCalledWith(1, expect.objectContaining({
        id: 'node-1',
        image: 'data:image/png;base64,image1'
      }));
      expect(updateNodeCallback).toHaveBeenNthCalledWith(2, expect.objectContaining({
        id: 'node-2',
        image: 'data:image/png;base64,image2'
      }));
      
      vi.useRealTimers();
    });

    it('should handle errors during image generation', async () => {
      vi.useFakeTimers();
      const updateNodeCallback = vi.fn();
      imageQueueService.setUpdateNodeCallback(updateNodeCallback);
      
      // Setup error scenario
      (generateImage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Image generation failed'));
      
      await imageQueueService.addToQueue(mockNode, mockNodes, mockChatHistory);
      
      // Allow processing to complete
      await vi.runAllTimersAsync();
      
      // Verify error was handled and node was not updated
      expect(updateNodeCallback).not.toHaveBeenCalled();
      
      // Verify queue item was marked as failed
      const queueStatus = imageQueueService.getQueueStatus();
      expect(queueStatus[0].status).toBe('failed');
      
      vi.useRealTimers();
    });
  });

  describe('getQueueStatus', () => {
    it('should return the current status of all items in the queue', async () => {
      vi.useFakeTimers();
      // Add a node to the queue
      await imageQueueService.addToQueue(mockNode, mockNodes, mockChatHistory);
      
      // Check initial status
      let status = imageQueueService.getQueueStatus();
      expect(status.length).toBe(1);
      expect(status[0].nodeId).toBe('test-node-1');
      
      // Status might be 'pending' or 'processing' depending on timing
      expect(['pending', 'processing', 'completed'].includes(status[0].status)).toBe(true);
      
      // Allow processing to complete
      await vi.runAllTimersAsync();
      
      // Check updated status
      status = imageQueueService.getQueueStatus();
      expect(status[0].status).toBe('completed');
      
      vi.useRealTimers();
    });
  });
}); 