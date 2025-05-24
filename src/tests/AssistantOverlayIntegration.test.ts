import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getResponse, formatPrompt } from '../services/llmCore';
import { regenerateSingleNode } from '../services/twineImportLLMService';
import { Node } from '../models/Node';

// Mock external dependencies to test real integration logic
vi.mock('../services/llmCore', () => ({
  getResponse: vi.fn(),
  loadedPrompts: {
    twine_import: {
      regenerate_single_node: 'Test regeneration prompt: {node_generation_instructions} {existing_node_id}'
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

describe('Assistant Overlay Integration - Real Logic Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNodes: Node[] = [
    { 
      id: 'node1', 
      name: 'Hero Character', 
      longDescription: 'A brave hero with sword', 
      image: 'hero.jpg', 
      type: 'character'
    },
    {
      id: 'node2',
      name: 'Dark Forest',
      longDescription: 'A mysterious forest location',
      image: 'forest.jpg',
      type: 'location'
    }
  ];

  describe('Node Regeneration Integration', () => {
    it('should successfully regenerate a node with user instructions', async () => {
      const mockLLMResponse = JSON.stringify({
        n_nodes: [{
          id: 'node1',
          name: 'Enhanced Hero Character',
          longDescription: 'A brave hero with magical sword and enhanced abilities',
          type: 'character',
          updateImage: true
        }]
      });

      (getResponse as any).mockResolvedValue(mockLLMResponse);

      const result = await regenerateSingleNode(
        'node1',
        mockNodes,
        [], // Empty extracted data as would be used in AssistantOverlay
        'Make the character more magical and powerful',
        JSON.stringify(mockNodes.find(n => n.id === 'node1'))
      );

      expect(formatPrompt).toHaveBeenCalledWith(
        expect.stringContaining('Test regeneration prompt:'),
        expect.objectContaining({
          node_generation_instructions: 'Make the character more magical and powerful',
          existing_node_id: 'node1'
        })
      );

      expect(result).toEqual({
        id: 'node1',
        name: 'Enhanced Hero Character',
        longDescription: 'A brave hero with magical sword and enhanced abilities',
        type: 'character',
        updateImage: true
      });
    });

    it('should handle regeneration with node updates instead of new nodes', async () => {
      const mockLLMResponse = JSON.stringify({
        u_nodes: {
          'node2': {
            longDescription: { rpl: 'A dark, enchanted forest filled with magical creatures' },
            img_upd: true
          }
        }
      });

      (getResponse as any).mockResolvedValue(mockLLMResponse);

      const result = await regenerateSingleNode(
        'node2',
        mockNodes,
        [],
        'Add magical elements to the forest',
        JSON.stringify(mockNodes.find(n => n.id === 'node2'))
      );

      expect(result).toEqual({
        id: 'node2',
        name: 'Dark Forest', // Original name preserved
        longDescription: 'A dark, enchanted forest filled with magical creatures', // Updated
        type: 'location', // Original type preserved
        image: 'forest.jpg', // Original image preserved
        updateImage: true // From img_upd
      });
    });

    it('should handle errors in node regeneration gracefully', async () => {
      const mockError = new Error('LLM API rate limit exceeded');
      (getResponse as any).mockRejectedValue(mockError);

      await expect(regenerateSingleNode(
        'node1',
        mockNodes,
        [],
        'Test instruction',
        JSON.stringify(mockNodes.find(n => n.id === 'node1'))
      )).rejects.toThrow('LLM API rate limit exceeded');
    });

    it('should validate node existence before regeneration', async () => {
      await expect(regenerateSingleNode(
        'nonexistent',
        mockNodes,
        [],
        'Test instruction',
        'Test details'
      )).rejects.toThrow('Node with id nonexistent not found');

      expect(getResponse).not.toHaveBeenCalled();
    });
  });

  describe('Preview State Management Simulation', () => {
    it('should simulate proper merge array updates', () => {
      // Simulate the logic that would happen in AssistantOverlay when updating preview state
      const originalLLMResponse = {
        newNodes: [],
        merge: [
          { 
            id: 'node1', 
            name: 'Original Merged Node', 
            longDescription: 'Original description', 
            type: 'character'
          }
        ]
      };

      const regeneratedNodeData = {
        id: 'node1',
        name: 'Updated Merged Node',
        longDescription: 'Updated description via regeneration',
        type: 'character',
        updateImage: true
      };

      // Simulate the state update logic
      const newLLMResponse = { ...originalLLMResponse };
      const newMerge = [...(newLLMResponse.merge || [])];
      const nodeIndex = newMerge.findIndex((n: any) => n.id === 'node1');
      
      if (nodeIndex !== -1) {
        newMerge[nodeIndex] = regeneratedNodeData;
      } else {
        newMerge.push(regeneratedNodeData);
      }
      
      newLLMResponse.merge = newMerge;

      expect(newLLMResponse.merge).toHaveLength(1);
      expect(newLLMResponse.merge[0]).toEqual(regeneratedNodeData);
      expect(newLLMResponse.newNodes).toEqual([]); // Original structure preserved
    });

    it('should add new nodes to merge array when not present', () => {
      const originalLLMResponse = {
        newNodes: [],
        merge: [] as any[]
      };

      const regeneratedNodeData = {
        id: 'node2',
        name: 'New Regenerated Node',
        longDescription: 'Newly regenerated description',
        type: 'location',
        updateImage: false
      };

      // Simulate adding to empty merge array
      const newLLMResponse = { ...originalLLMResponse };
      const newMerge = [...(newLLMResponse.merge || [])];
      const nodeIndex = newMerge.findIndex((n: any) => n.id === 'node2');
      
      if (nodeIndex === -1) {
        newMerge.push(regeneratedNodeData);
      }
      
      newLLMResponse.merge = newMerge;

      expect(newLLMResponse.merge).toHaveLength(1);
      expect(newLLMResponse.merge[0]).toEqual(regeneratedNodeData);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle malformed LLM responses', async () => {
      (getResponse as any).mockResolvedValue('Invalid JSON');

      await expect(regenerateSingleNode(
        'node1',
        mockNodes,
        [],
        'Test instruction',
        'Test details'
      )).rejects.toThrow('Failed to parse JSON response');
    });

    it('should handle empty LLM responses', async () => {
      (getResponse as any).mockResolvedValue(JSON.stringify({}));

      await expect(regenerateSingleNode(
        'node1',
        mockNodes,
        [],
        'Test instruction',
        'Test details'
      )).rejects.toThrow('Invalid response structure');
    });

    it('should handle response with wrong node ID', async () => {
      const mockLLMResponse = JSON.stringify({
        n_nodes: [{
          id: 'wrong_id',
          name: 'Wrong Node',
          longDescription: 'Wrong description',
          type: 'character'
        }]
      });

      (getResponse as any).mockResolvedValue(mockLLMResponse);

      await expect(regenerateSingleNode(
        'node1',
        mockNodes,
        [],
        'Test instruction',
        'Test details'
      )).rejects.toThrow('No valid node data found for node node1');
    });
  });

  describe('Prompt Construction Integration', () => {
    it('should include all necessary context in prompt', async () => {
      const mockLLMResponse = JSON.stringify({
        n_nodes: [{
          id: 'node1',
          name: 'Test Node',
          longDescription: 'Test description',
          type: 'character'
        }]
      });

      (getResponse as any).mockResolvedValue(mockLLMResponse);

      await regenerateSingleNode(
        'node1',
        mockNodes,
        [],
        'Detailed regeneration instructions',
        'Recently generated node details'
      );

      expect(formatPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          node_generation_instructions: 'Detailed regeneration instructions',
          existing_node_id: 'node1',
          existing_node_name: 'Hero Character',
          existing_node_long_description: 'A brave hero with sword',
          existing_node_type: 'character',
          recently_generated_node_details: 'Recently generated node details'
        })
      );
    });

    it('should include nodes description for context', async () => {
      const mockLLMResponse = JSON.stringify({
        n_nodes: [{
          id: 'node1',
          name: 'Test Node',
          longDescription: 'Test description',
          type: 'character'
        }]
      });

      (getResponse as any).mockResolvedValue(mockLLMResponse);

      await regenerateSingleNode(
        'node1',
        mockNodes,
        [],
        'Test instruction',
        'Test details'
      );

      const formatPromptCall = (formatPrompt as any).mock.calls[0];
      expect(formatPromptCall[1].nodes_description).toContain('node1: Hero Character');
      expect(formatPromptCall[1].nodes_description).toContain('node2: Dark Forest');
    });
  });
}); 