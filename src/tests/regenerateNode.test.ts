import { describe, it, expect, vi, beforeEach } from 'vitest';
import { regenerateSingleNode } from '../services/twineImportLLMService';
import { Node } from '../models/Node';

// Mock the regenerateSingleNode function
vi.mock('../services/twineImportLLMService', () => ({
  regenerateSingleNode: vi.fn()
}));

describe('Regenerate Node Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock returns
    (regenerateSingleNode as any).mockResolvedValue({
      id: 'node1',
      name: 'Regenerated Node 1',
      longDescription: 'This is a regenerated description',
      type: 'character',
      updateImage: true
    });
  });
  
  it('should properly regenerate a node with correct parameters', async () => {
    const mockNodes: Node[] = [
      { 
        id: 'node1', 
        name: 'Test Node 1', 
        longDescription: 'This is test node 1', 
        image: 'image1.jpg', 
        type: 'character'
      }
    ];
    
    const nodeToRegenerate = {
      id: 'node1',
      name: 'Updated Node 1',
      longDescription: 'Updated description for node 1',
      type: 'character'
    };
    
    const nodeGenerationInstructions = 'Make the story more exciting';
    
    const result = await regenerateSingleNode(
      'node1',
      nodeToRegenerate,
      { chunks: [[]] },
      mockNodes,
      'merge_story',
      nodeGenerationInstructions,
      nodeToRegenerate
    );
    
    // Verify the regenerateSingleNode function was called with the right parameters
    expect(regenerateSingleNode).toHaveBeenCalledWith(
      'node1',
      nodeToRegenerate,
      { chunks: [[]] },
      mockNodes,
      'merge_story',
      nodeGenerationInstructions,
      nodeToRegenerate
    );
    
    // Verify the result matches what we expect
    expect(result).toEqual({
      id: 'node1',
      name: 'Regenerated Node 1',
      longDescription: 'This is a regenerated description',
      type: 'character',
      updateImage: true
    });
  });
  
  it('should handle errors during regeneration', async () => {
    // Make regenerateSingleNode fail
    const mockError = new Error('Failed to regenerate node');
    (regenerateSingleNode as any).mockRejectedValueOnce(mockError);
    
    const nodeToRegenerate = {
      id: 'node1',
      name: 'Updated Node 1', 
      longDescription: 'Updated description for node 1',
      type: 'character'
    };
    
    // Check that the error is properly propagated
    await expect(regenerateSingleNode(
      'node1',
      nodeToRegenerate,
      { chunks: [[]] },
      [],
      'merge_story',
      'Make the story more exciting',
      nodeToRegenerate
    )).rejects.toThrow('Failed to regenerate node');
  });
}); 