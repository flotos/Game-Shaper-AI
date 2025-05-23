import { describe, it, expect, vi, beforeEach } from 'vitest';
import { regenerateSingleNode } from '../services/twineImportLLMService';
import { Node } from '../models/Node';

// Create a mock implementation of the handleRegenerateNode function in AssistantOverlay
// This represents the core logic without the React component UI
async function mockHandleRegenerateNode(
  nodeId: string,
  nodes: Node[],
  originalLLMResponse: any, 
  prompt: string
): Promise<any> {
  try {
    // Get the node to regenerate (either from merge or original nodes)
    const nodeToRegenerate = originalLLMResponse.merge?.find((n: any) => n.id === nodeId) || 
                            nodes.find(n => n.id === nodeId);
    
    if (!nodeToRegenerate) {
      throw new Error('Node not found for regeneration');
    }
    
    // Create a minimal extractedData object for the regenerateSingleNode function
    const dummyExtractedData = { 
      chunks: [[]] 
    };
    
    // Call regenerateSingleNode from the twine import service
    const regeneratedNodeData = await regenerateSingleNode(
      nodeId,
      nodeToRegenerate,
      dummyExtractedData,
      nodes,
      'merge_story', // Always use merge mode in assistant
      prompt,
      nodeToRegenerate // Pass as the recently generated version
    );

    // Simulate updating preview state
    const newLLMResponse = { ...originalLLMResponse };
    
    // Update either in merge array or add to it if not present
    if (newLLMResponse.merge) {
      const existingIndex = newLLMResponse.merge.findIndex((n: any) => n.id === nodeId);
      if (existingIndex >= 0) {
        newLLMResponse.merge[existingIndex] = { 
          ...newLLMResponse.merge[existingIndex], 
          ...regeneratedNodeData 
        };
      } else {
        newLLMResponse.merge.push({ id: nodeId, ...regeneratedNodeData });
      }
    } else {
      newLLMResponse.merge = [{ id: nodeId, ...regeneratedNodeData }];
    }
    
    return newLLMResponse;
  } catch (err) {
    throw err;
  }
}

// Mock the regenerateSingleNode function
vi.mock('../services/twineImportLLMService', () => ({
  regenerateSingleNode: vi.fn()
}));

describe('AssistantOverlay - HandleRegenerateNode Integration', () => {
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
  
  it('should call regenerateSingleNode and update the LLM response correctly', async () => {
    const mockNodes: Node[] = [
      { 
        id: 'node1', 
        name: 'Test Node 1', 
        longDescription: 'This is test node 1', 
        image: 'image1.jpg', 
        type: 'character'
      }
    ];
    
    const originalLLMResponse = {
      merge: [
        { 
          id: 'node1', 
          name: 'Updated Node 1', 
          longDescription: 'Updated description for node 1', 
          type: 'character',
          updateImage: false
        }
      ]
    };
    
    const prompt = 'Make the story more exciting';
    
    // Call our simulated handleRegenerateNode
    const result = await mockHandleRegenerateNode('node1', mockNodes, originalLLMResponse, prompt);
    
    // Verify regenerateSingleNode was called with correct params
    expect(regenerateSingleNode).toHaveBeenCalledWith(
      'node1',
      expect.objectContaining({ id: 'node1' }),
      { chunks: [[]] },
      mockNodes,
      'merge_story',
      prompt,
      expect.objectContaining({ id: 'node1' })
    );
    
    // Verify the response is updated correctly
    expect(result).toEqual({
      merge: [
        {
          id: 'node1',
          name: 'Regenerated Node 1',
          longDescription: 'This is a regenerated description',
          type: 'character',
          updateImage: true
        }
      ]
    });
  });
  
  it('should add node to merge array if not already present', async () => {
    const mockNodes: Node[] = [
      { 
        id: 'node1', 
        name: 'Test Node 1', 
        longDescription: 'This is test node 1', 
        image: 'image1.jpg', 
        type: 'character'
      },
      { 
        id: 'node2', 
        name: 'Test Node 2', 
        longDescription: 'This is test node 2', 
        image: 'image2.jpg', 
        type: 'location'
      }
    ];
    
    const originalLLMResponse = {
      merge: [
        { 
          id: 'node1', 
          name: 'Updated Node 1', 
          longDescription: 'Updated description for node 1', 
          type: 'character',
          updateImage: false
        }
      ]
    };
    
    // Mock regenerateSingleNode to return node2
    (regenerateSingleNode as any).mockResolvedValueOnce({
      id: 'node2',
      name: 'Regenerated Node 2',
      longDescription: 'This is a regenerated description for node 2',
      type: 'location',
      updateImage: true
    });
    
    const prompt = 'Make the story more exciting';
    
    // Call our simulated handleRegenerateNode with node2
    const result = await mockHandleRegenerateNode('node2', mockNodes, originalLLMResponse, prompt);
    
    // Verify the merge array now has both nodes
    expect(result.merge).toHaveLength(2);
    expect(result.merge[0].id).toBe('node1');
    expect(result.merge[1].id).toBe('node2');
    expect(result.merge[1].name).toBe('Regenerated Node 2');
  });
  
  it('should create merge array if not present', async () => {
    const mockNodes: Node[] = [
      { 
        id: 'node1', 
        name: 'Test Node 1', 
        longDescription: 'This is test node 1', 
        image: 'image1.jpg', 
        type: 'character'
      }
    ];
    
    // LLM response without merge array
    const originalLLMResponse = {
      newNodes: []
    };
    
    const prompt = 'Make the story more exciting';
    
    // Call our simulated handleRegenerateNode
    const result = await mockHandleRegenerateNode('node1', mockNodes, originalLLMResponse, prompt);
    
    // Verify a merge array was created with regenerated node
    expect(result.merge).toBeDefined();
    expect(result.merge).toHaveLength(1);
    expect(result.merge[0].id).toBe('node1');
    expect(result.merge[0].name).toBe('Regenerated Node 1');
    expect(result.newNodes).toEqual([]);  // Original properties preserved
  });
  
  it('should handle errors and propagate them', async () => {
    const mockNodes: Node[] = [
      { 
        id: 'node1', 
        name: 'Test Node 1', 
        longDescription: 'This is test node 1', 
        image: 'image1.jpg', 
        type: 'character'
      }
    ];
    
    const originalLLMResponse = {
      merge: [
        { 
          id: 'node1', 
          name: 'Updated Node 1', 
          longDescription: 'Updated description for node 1', 
          type: 'character',
          updateImage: false
        }
      ]
    };
    
    // Make regenerateSingleNode fail
    const mockError = new Error('Failed to regenerate node');
    (regenerateSingleNode as any).mockRejectedValueOnce(mockError);
    
    const prompt = 'Make the story more exciting';
    
    // Check that the error is properly propagated
    await expect(
      mockHandleRegenerateNode('node1', mockNodes, originalLLMResponse, prompt)
    ).rejects.toThrow('Failed to regenerate node');
  });
  
  it('should throw an error if node is not found', async () => {
    const mockNodes: Node[] = [
      { 
        id: 'node1', 
        name: 'Test Node 1', 
        longDescription: 'This is test node 1', 
        image: 'image1.jpg', 
        type: 'character'
      }
    ];
    
    const originalLLMResponse = {
      merge: []
    };
    
    const prompt = 'Make the story more exciting';
    
    // Check that an error is thrown for non-existent node
    await expect(
      mockHandleRegenerateNode('nonexistent', mockNodes, originalLLMResponse, prompt)
    ).rejects.toThrow('Node not found for regeneration');
  });
}); 