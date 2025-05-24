import { describe, it, expect, vi, beforeEach } from 'vitest';
import { regenerateSingleNode } from '../services/twineImportLLMService';
import { Node } from '../models/Node';

// Mock external dependencies, not the function we're testing
vi.mock('../services/llmCore', () => ({
  getResponse: vi.fn(),
  loadedPrompts: {
    twine_import: {
      regenerate_single_node: 'Test prompt: {node_generation_instructions} {existing_node_id} {existing_node_name} {existing_node_long_description} {existing_node_type} {recently_generated_node_details} {extracted_data} {nodes_description}'
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

import { getResponse, formatPrompt } from '../services/llmCore';

describe('Regenerate Node Service - Real Logic Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('should generate new node data (n_nodes response format)', async () => {
    const mockResponse = JSON.stringify({
      n_nodes: [{
        id: 'node1',
        name: 'Regenerated Node 1',
        longDescription: 'This is a regenerated description',
        type: 'character',
        updateImage: true
      }]
    });

    (getResponse as any).mockResolvedValue(mockResponse);

    const result = await regenerateSingleNode(
      'node1',
      mockNodes,
      [{ type: 'passage', name: 'Start', content: 'Sample content' }],
      'Make the story more exciting',
      'Previously generated node data'
    );

    expect(formatPrompt).toHaveBeenCalledWith(
      expect.stringContaining('Test prompt:'),
      expect.objectContaining({
        node_generation_instructions: 'Make the story more exciting',
        existing_node_id: 'node1',
        existing_node_name: 'Test Node 1',
        existing_node_long_description: 'This is test node 1',
        existing_node_type: 'character',
        recently_generated_node_details: 'Previously generated node data'
      })
    );

    expect(getResponse).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'system' })]),
      'gpt-4o',
      undefined,
      false,
      { type: 'json_object' },
      undefined,
      'single_node_regeneration'
    );

    expect(result).toEqual({
      id: 'node1',
      name: 'Regenerated Node 1',
      longDescription: 'This is a regenerated description',
      type: 'character',
      updateImage: true
    });
  });

  it('should handle node updates (u_nodes response format)', async () => {
    const mockResponse = JSON.stringify({
      u_nodes: {
        'node1': {
          longDescription: { rpl: 'Updated description via replacement' },
          img_upd: true
        }
      }
    });

    (getResponse as any).mockResolvedValue(mockResponse);

    const result = await regenerateSingleNode(
      'node1',
      mockNodes,
      [],
      'Update the description',
      'Previous node data'
    );

    expect(result).toEqual({
      id: 'node1',
      name: 'Test Node 1', // Original name preserved
      longDescription: 'Updated description via replacement', // Updated via rpl
      type: 'character', // Original type preserved
      image: 'image1.jpg', // Original image preserved
      updateImage: true // Set from img_upd
    });
  });

  it('should throw error for non-existent node', async () => {
    await expect(regenerateSingleNode(
      'nonexistent',
      mockNodes,
      [],
      'Test prompt',
      'Test details'
    )).rejects.toThrow('Node with id nonexistent not found');

    expect(getResponse).not.toHaveBeenCalled();
  });

  it('should handle prompt size constraints', async () => {
    // Create very long extracted data to trigger size limit
    const longExtractedData = Array(1000).fill({
      type: 'passage',
      name: 'Very long passage',
      content: 'Very long content that repeats '.repeat(100)
    });

    const mockResponse = JSON.stringify({
      n_nodes: [{
        id: 'node1',
        name: 'Generated Node',
        longDescription: 'Generated description',
        type: 'character'
      }]
    });

    (getResponse as any).mockResolvedValue(mockResponse);

    await regenerateSingleNode(
      'node1',
      mockNodes,
      longExtractedData,
      'Test prompt',
      'Test details'
    );

    // Should have been called twice - once with full prompt (too long), then with trimmed
    expect(formatPrompt).toHaveBeenCalledTimes(2);
  });

  it('should handle API errors', async () => {
    const mockError = new Error('API request failed');
    (getResponse as any).mockRejectedValue(mockError);

    await expect(regenerateSingleNode(
      'node1',
      mockNodes,
      [],
      'Test prompt',
      'Test details'
    )).rejects.toThrow('API request failed');
  });

  it('should handle malformed JSON responses', async () => {
    (getResponse as any).mockResolvedValue('Invalid JSON response');

    await expect(regenerateSingleNode(
      'node1',
      mockNodes,
      [],
      'Test prompt',
      'Test details'
    )).rejects.toThrow('Failed to parse JSON response');
  });

  it('should handle invalid response structure (missing required fields)', async () => {
    const mockResponse = JSON.stringify({
      invalid_field: 'data'
    });

    (getResponse as any).mockResolvedValue(mockResponse);

    await expect(regenerateSingleNode(
      'node1',
      mockNodes,
      [],
      'Test prompt',
      'Test details'
    )).rejects.toThrow('Invalid response structure');
  });

  it('should handle response with node not found in result', async () => {
    const mockResponse = JSON.stringify({
      n_nodes: [{
        id: 'different_node',
        name: 'Wrong Node',
        longDescription: 'Wrong description',
        type: 'character'
      }]
    });

    (getResponse as any).mockResolvedValue(mockResponse);

    await expect(regenerateSingleNode(
      'node1',
      mockNodes,
      [],
      'Test prompt',
      'Test details'
    )).rejects.toThrow('No valid node data found for node node1');
  });

  it('should clean JSON response with markdown formatting', async () => {
    const mockResponse = '```json\n' + JSON.stringify({
      n_nodes: [{
        id: 'node1',
        name: 'Clean Node',
        longDescription: 'Cleaned description',
        type: 'character'
      }]
    }) + '\n```';

    (getResponse as any).mockResolvedValue(mockResponse);

    const result = await regenerateSingleNode(
      'node1',
      mockNodes,
      [],
      'Test prompt',
      'Test details'
    );

    expect(result.name).toBe('Clean Node');
  });
}); 