import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getResponse, loadedPrompts, formatPrompt } from '../services/llmCore';
import { extractDataFromTwine, generateNodesFromExtractedData, generateNodesFromTwine } from '../services/twineImportLLMService';
import { moxusService } from '../services/MoxusService';
import type { Node } from '../models/Node';

// Mock the llmCore module
vi.mock('../services/llmCore', () => ({
  getResponse: vi.fn(),
  loadedPrompts: {
    twine_import: {
      data_extraction: 'Test prompt for data extraction: {additional_instructions} {twine_content}',
      node_generation_new_game: 'Test prompt for node generation (new game): {additional_instructions} {extracted_data} {nodes_description}',
      node_generation_merge: 'Test prompt for node generation (merge): {additional_instructions} {extracted_data} {nodes_description}',
      regenerate_single_node: 'Test prompt for regenerating a node: {node_generation_instructions} {existing_node_id} {node_id_to_regenerate}'
    }
  },
  formatPrompt: vi.fn((template: string, replacements: Record<string, string | undefined>) => {
    let result = template;
    for (const key in replacements) {
      const value = replacements[key];
      if (value) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
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

describe('Twine Import LLM Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractDataFromTwine', () => {
    it('should process a single chunk of Twine content', async () => {
      const mockTwineContent = '<html><tw-storydata>Sample Twine content</tw-storydata></html>';
      const mockExtractedElements = [
        { type: 'passage', name: 'Start', content: 'Sample content' }
      ];

      // Mock successful response with properly formatted elements
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        JSON.stringify({ elements: mockExtractedElements })
      );

      const result = await extractDataFromTwine(mockTwineContent);

      expect(formatPrompt).toHaveBeenCalledWith(
        loadedPrompts.twine_import.data_extraction,
        {
          additional_instructions: '',
          twine_content: mockTwineContent
        }
      );

      expect(getResponse).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ role: 'system' })]),
        undefined,
        undefined,
        false,
        { type: 'json_object' }
      );

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toEqual(mockExtractedElements);
      expect(result.failedChunks).toBe(0);
    });

    it('should process multiple chunks if extractionCount > 1', async () => {
      const mockTwineContent = 'Part 1 Part 2 Part 3';
      
      // Important: we need to make sure each mock call is properly structured
      // and each call gets a unique response for chunks
      (getResponse as ReturnType<typeof vi.fn>)
        .mockImplementation((messages, model, temperature, stream, responseFormat, options) => {
          // Get the content from the message to determine which chunk we're processing
          const content = messages[0].content as string;
          
          if (content.includes('Part 1')) {
            return Promise.resolve(
              JSON.stringify({ elements: [{ type: 'passage', name: 'Chunk1', content: 'Content1' }] })
            );
          } else if (content.includes('Part 2')) {
            return Promise.resolve(
              JSON.stringify({ elements: [{ type: 'passage', name: 'Chunk2', content: 'Content2' }] })
            );
          } else {
            return Promise.resolve(
              JSON.stringify({ elements: [{ type: 'passage', name: 'Chunk3', content: 'Content3' }] })
            );
          }
        });

      const result = await extractDataFromTwine(mockTwineContent, undefined, 3);

      expect(getResponse).toHaveBeenCalledTimes(3);
      expect(result.chunks).toHaveLength(3);
      expect(result.chunks[0][0].name).toBe('Chunk1');
      expect(result.chunks[1][0].name).toBe('Chunk2');
      expect(result.chunks[2][0].name).toBe('Chunk3');
    });

    it('should handle errors and retry failed chunks once', async () => {
      const mockTwineContent = 'Test content';
      
      // First call fails, retry succeeds
      (getResponse as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce(
          JSON.stringify({ elements: [{ type: 'passage', name: 'Retried', content: 'Retried content' }] })
        );

      const result = await extractDataFromTwine(mockTwineContent);

      expect(getResponse).toHaveBeenCalledTimes(2); // Initial call + retry
      // Check that the retry worked
      expect(result.chunks[0][0]?.name).toBe('Retried');
      expect(result.failedChunks).toBe(0);
    });

    it('should track failed chunks if retry also fails', async () => {
      const mockTwineContent = 'Test content';
      
      (getResponse as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('First API Error'))
        .mockRejectedValueOnce(new Error('Retry API Error'));

      const result = await extractDataFromTwine(mockTwineContent);

      expect(getResponse).toHaveBeenCalledTimes(2); // Initial call + retry
      expect(result.chunks[0]).toEqual([]);
      expect(result.failedChunks).toBe(1);
    });
  });

  describe('generateNodesFromExtractedData', () => {
    const mockExtractedData = [
      { type: 'passage', name: 'Start', content: 'Starting point' },
      { type: 'passage', name: 'Forest', content: 'Dense forest area' }
    ];

    const mockExistingNodes: Node[] = [
      {
        id: 'existing1',
        name: 'Existing Node',
        longDescription: 'An existing node',
        image: 'existing.jpg',
        type: 'character'
      }
    ];

    it('should generate nodes in new_game mode', async () => {
      const mockResponseObj = {
        n_nodes: [
          {
            id: 'start1',
            name: 'Start Location',
            longDescription: 'Starting area from Twine',
            type: 'location',
            image: 'start.jpg',
            updateImage: false
          },
          {
            id: 'forest1',
            name: 'Forest Location',
            longDescription: 'Forest area from Twine',
            type: 'location',
            image: 'forest.jpg',
            updateImage: false
          }
        ]
      };
      
      // Return JSON string as the service expects
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(mockResponseObj)
      );

      const result = await generateNodesFromExtractedData(mockExtractedData, mockExistingNodes, '', 'new_game');

      expect(formatPrompt).toHaveBeenCalledWith(
        loadedPrompts.twine_import.node_generation_new_game,
        expect.objectContaining({
          additional_instructions: '',
          extracted_data: expect.stringContaining('Start'),
          nodes_description: expect.stringContaining('Existing Node')
        })
      );

      expect(getResponse).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ role: 'system' })]),
        undefined,
        undefined,
        false,
        { type: 'json_object' },
        undefined,
        'node_generation'
      );

      expect(result.new).toHaveLength(2);
      expect(result.delete).toEqual(['existing1']);
    });

    it('should generate nodes in merge_story mode', async () => {
      const mockResponseObj = {
        n_nodes: [
          {
            id: 'forest1',
            name: 'Forest Location',
            longDescription: 'Forest area from Twine',
            type: 'location',
            image: 'forest.jpg'
          }
        ],
        u_nodes: {
          'existing1': {
            longDescription: { rpl: 'Updated description for existing node' },
            img_upd: true
          }
        }
      };

      // Return JSON string
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify(mockResponseObj)
      );

      const result = await generateNodesFromExtractedData(mockExtractedData, mockExistingNodes, '', 'merge');

      expect(formatPrompt).toHaveBeenCalledWith(
        loadedPrompts.twine_import.node_generation_merge,
        expect.objectContaining({
          extracted_data: expect.stringContaining('Start')
        })
      );

      expect(result.new).toHaveLength(1);
      // Note: The service doesn't actually return update array, only new and delete
      expect(result.delete).toBeUndefined(); // merge mode doesn't set delete
    });

    it('should throw an error for invalid response structures', async () => {
      // Return an invalid object structure that's missing the required 'n_nodes' array
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ invalid: 'structure' }) // Missing 'n_nodes' array
      );

      await expect(generateNodesFromExtractedData(mockExtractedData, mockExistingNodes, '', 'new_game'))
        .rejects.toThrow(/Invalid response structure/); // Use regex to match part of the message
    });
  });

  describe('generateNodesFromTwine', () => {
    const mockTwineContent = '<html><tw-storydata>Sample Twine content</tw-storydata></html>';
    const mockExistingNodes: Node[] = [
      {
        id: 'existing1',
        name: 'Existing Node',
        longDescription: 'An existing node',
        image: 'existing.jpg',
        type: 'character'
      }
    ];

    it('should extract data and generate nodes in one operation', async () => {
      // Mock for extractDataFromTwine - it splits content into 3 chunks by default
      const mockExtractedElements = [
        { type: 'passage', name: 'Start', content: 'Sample content' }
      ];
      
      const mockGeneratedNodes = {
        n_nodes: [
          {
            id: 'start1',
            name: 'Start Location',
            longDescription: 'Starting area from Twine',
            type: 'location',
            image: 'start.jpg'
          }
        ]
      };

      (getResponse as ReturnType<typeof vi.fn>)
        // First 3 calls for extractDataFromTwine (3 chunks)
        .mockResolvedValueOnce(
          JSON.stringify({ elements: mockExtractedElements })
        )
        .mockResolvedValueOnce(
          JSON.stringify({ elements: [] }) // Second chunk empty
        )
        .mockResolvedValueOnce(
          JSON.stringify({ elements: [] }) // Third chunk empty
        )
        // Fourth call for generateNodesFromExtractedData
        .mockResolvedValueOnce(
          JSON.stringify(mockGeneratedNodes)
        );

      const result = await generateNodesFromTwine(
        mockTwineContent, 
        mockExistingNodes, 
        'merge_story',
        'Extract passages carefully',
        'Generate detailed nodes'
      );

      // Verify both function chains were called with expected parameters
      expect(getResponse).toHaveBeenCalledTimes(4); // 3 for extraction + 1 for generation
      
      // Check final result
      expect(result.new).toHaveLength(1);
      expect(result.new[0].name).toBe('Start Location');
    });

    it('should handle errors during the process', async () => {
      // Mock 3 chunks for extraction, then fail on generation
      (getResponse as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(
          JSON.stringify({ elements: [{ type: 'passage', name: 'Start', content: 'Content' }] })
        )
        .mockResolvedValueOnce(
          JSON.stringify({ elements: [] }) // Second chunk empty
        )
        .mockResolvedValueOnce(
          JSON.stringify({ elements: [] }) // Third chunk empty
        )
        .mockRejectedValueOnce(new Error('Generation error'));

      await expect(generateNodesFromTwine(
        mockTwineContent, 
        mockExistingNodes, 
        'new_game'
      )).rejects.toThrow('Generation error');
    });
  });
}); 