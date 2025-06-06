import { describe, it, expect } from 'vitest';
import { loadedPrompts, PromptsConfig, formatPrompt } from '../services/llmCore';

// Import the actual YAML to compare with the interface
const ActualPromptsYaml = loadedPrompts;

describe('LLM Core - Interface and YAML Validation', () => {
  describe('PromptsConfig Interface Validation', () => {
    it('should validate that all interface sections exist in the YAML', () => {
      // Validate top-level sections
      expect(ActualPromptsYaml).toHaveProperty('moxus_prompts');
      expect(ActualPromptsYaml).toHaveProperty('twine_import');
      expect(ActualPromptsYaml).toHaveProperty('image_generation');
      expect(ActualPromptsYaml).toHaveProperty('node_operations');
      expect(ActualPromptsYaml).toHaveProperty('utils');
      
      // Validate all sections are objects
      expect(typeof ActualPromptsYaml.moxus_prompts).toBe('object');
      expect(typeof ActualPromptsYaml.twine_import).toBe('object');
      expect(typeof ActualPromptsYaml.image_generation).toBe('object');
      expect(typeof ActualPromptsYaml.node_operations).toBe('object');
      expect(typeof ActualPromptsYaml.utils).toBe('object');
    });

    it('should validate all moxus_prompts interface properties exist in YAML', () => {
      const expectedMoxusPrompts = [
        'moxus_feedback_on_chat_text_generation',
        'moxus_feedback_on_node_edition_json',
        'moxus_feedback_on_manual_node_edit',
        'moxus_feedback_on_assistant_feedback',
        
        'general_memory_update'
      ];

      expectedMoxusPrompts.forEach(promptKey => {
        expect(ActualPromptsYaml.moxus_prompts).toHaveProperty(promptKey);
        expect(typeof ActualPromptsYaml.moxus_prompts[promptKey as keyof typeof ActualPromptsYaml.moxus_prompts]).toBe('string');
        expect((ActualPromptsYaml.moxus_prompts[promptKey as keyof typeof ActualPromptsYaml.moxus_prompts] as string).length).toBeGreaterThan(0);
      });
    });

    it('should validate all twine_import interface properties exist in YAML', () => {
      const expectedTwineImportPrompts = [
        'data_extraction',
        'node_generation_new_game',
        'node_generation_merge',
        'regenerate_single_node'
      ];

      expectedTwineImportPrompts.forEach(promptKey => {
        expect(ActualPromptsYaml.twine_import).toHaveProperty(promptKey);
        expect(typeof ActualPromptsYaml.twine_import[promptKey as keyof typeof ActualPromptsYaml.twine_import]).toBe('string');
        expect((ActualPromptsYaml.twine_import[promptKey as keyof typeof ActualPromptsYaml.twine_import] as string).length).toBeGreaterThan(0);
      });
    });

    it('should validate all image_generation interface properties exist in YAML', () => {
      const expectedImageGenerationPrompts = [
        'base_prompt_with_instructions_node',
        'base_prompt_default',
        'type_specific_additions'
      ];

      expectedImageGenerationPrompts.forEach(promptKey => {
        expect(ActualPromptsYaml.image_generation).toHaveProperty(promptKey);
        if (promptKey === 'type_specific_additions') {
          expect(typeof ActualPromptsYaml.image_generation[promptKey]).toBe('object');
        } else {
          expect(typeof ActualPromptsYaml.image_generation[promptKey as keyof typeof ActualPromptsYaml.image_generation]).toBe('string');
          expect((ActualPromptsYaml.image_generation[promptKey as keyof typeof ActualPromptsYaml.image_generation] as string).length).toBeGreaterThan(0);
        }
      });
    });

    it('should validate all node_operations interface properties exist in YAML', () => {
      const expectedNodeOperationPrompts = [
        'get_relevant_nodes',
        'generate_chat_text',
        'generate_actions',
        'generate_node_edition',
        'generate_nodes_from_prompt',
        'sort_nodes_by_relevance',
        'refocus_story'
      ];

      expectedNodeOperationPrompts.forEach(promptKey => {
        expect(ActualPromptsYaml.node_operations).toHaveProperty(promptKey);
        expect(typeof ActualPromptsYaml.node_operations[promptKey as keyof typeof ActualPromptsYaml.node_operations]).toBe('string');
        expect((ActualPromptsYaml.node_operations[promptKey as keyof typeof ActualPromptsYaml.node_operations] as string).length).toBeGreaterThan(0);
      });
    });

    it('should validate all utils interface properties exist in YAML', () => {
      const expectedUtilsPrompts = [
        'diffPrompt',
        'moxus_feedback_system_message'
      ];

      expectedUtilsPrompts.forEach(promptKey => {
        expect(ActualPromptsYaml.utils).toHaveProperty(promptKey);
        expect(typeof ActualPromptsYaml.utils[promptKey as keyof typeof ActualPromptsYaml.utils]).toBe('string');
        expect((ActualPromptsYaml.utils[promptKey as keyof typeof ActualPromptsYaml.utils] as string).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Critical Placeholder Validation', () => {
    it('should validate key placeholders exist in moxus_feedback_system_message', () => {
      const systemMessage = ActualPromptsYaml.utils.moxus_feedback_system_message;
      const requiredPlaceholders = [
        '{call_type}',
        '{moxus_specialized_guidance}'
      ];

      requiredPlaceholders.forEach(placeholder => {
        expect(systemMessage).toContain(placeholder);
      });
    });

    it('should validate key placeholders exist in node operation prompts', () => {
      const promptPlaceholderMap = {
        get_relevant_nodes: ['{utils.wrappers.nodes_description}', '{utils.wrappers.string_history}'],
        generate_chat_text: ['{utils.wrappers.user_input}', '{utils.wrappers.string_history}', '{utils.wrappers.nodes_description}', '{utils.wrappers.last_moxus_report_section}'],
        generate_actions: ['{utils.wrappers.nodes_description}', '{utils.wrappers.formatted_chat_text}', '{utils.wrappers.user_input}', '{utils.wrappers.last_moxus_report_section}'],
        generate_node_edition: ['{think_mode}', '{utils.wrappers.nodes_description}', '{utils.wrappers.formatted_chat_history}', '{utils.wrappers.user_input}', '{utils.wrappers.last_moxus_report_section}'],
        generate_nodes_from_prompt: ['{utils.wrappers.user_prompt}', '{utils.wrappers.nodes_description}', '{utils.wrappers.moxus_context_string}'],
        sort_nodes_by_relevance: ['{utils.wrappers.string_history}', '{utils.wrappers.nodes_description}', '{utils.wrappers.last_moxus_report_section}'],
        refocus_story: ['{utils.wrappers.past_chat_history}', '{utils.wrappers.nodes_description}']
      };

      Object.entries(promptPlaceholderMap).forEach(([promptKey, placeholders]) => {
        const prompt = ActualPromptsYaml.node_operations[promptKey as keyof typeof ActualPromptsYaml.node_operations];
        placeholders.forEach(placeholder => {
          expect(prompt).toContain(placeholder);
        });
      });
    });

    it('should validate key placeholders exist in moxus consciousness prompts', () => {
      const moxusPromptPlaceholderMap = {
        moxus_feedback_on_chat_text_generation: [
          '{utils.wrappers.assistant_nodes_content}',
          '{utils.wrappers.current_general_memory}',
          '{utils.wrappers.string_history}',
          '{utils.wrappers.generated_chat_text}',
          '{utils.wrappers.current_chat_text_memory}'
        ],
        moxus_feedback_on_node_edition_json: [
          '{utils.wrappers.assistant_nodes_content}',
          '{utils.wrappers.current_general_memory}',
          '{utils.wrappers.string_history}',
          '{utils.wrappers.node_edition_response}',
          '{utils.wrappers.all_nodes_context}',
          '{utils.wrappers.current_node_edition_memory}'
        ],
        general_memory_update: [
          '{utils.wrappers.assistant_nodes_content}',
          '{utils.wrappers.current_general_memory}',
          '{utils.wrappers.chat_text_analysis}',
          '{utils.wrappers.node_editions_analysis}',
          '{utils.wrappers.node_edit_analysis}',
          '{utils.wrappers.assistant_feedback_analysis}'
        ],
        moxus_feedback_on_manual_node_edit: [
          '{utils.wrappers.assistant_nodes_content}',
          '{utils.wrappers.current_general_memory}',
          '{utils.wrappers.current_manual_edit_memory}',
          '{utils.wrappers.original_node}',
          '{utils.wrappers.user_changes}',
          '{utils.wrappers.edit_context}'
        ],
        moxus_feedback_on_assistant_feedback: [
          '{utils.wrappers.assistant_nodes_content}',
          '{utils.wrappers.current_general_memory}',
          '{utils.wrappers.user_query}',
          '{utils.wrappers.assistant_result}',
          '{utils.wrappers.current_assistant_feedback_memory}'
        ]
      };

      Object.entries(moxusPromptPlaceholderMap).forEach(([promptKey, placeholders]) => {
        const prompt = ActualPromptsYaml.moxus_prompts[promptKey as keyof typeof ActualPromptsYaml.moxus_prompts];
        placeholders.forEach(placeholder => {
          expect(prompt).toContain(placeholder);
        });
      });
    });

    it('should validate image generation prompts have required placeholders', () => {
      const basePromptDefault = ActualPromptsYaml.image_generation.base_prompt_default;
      const basePromptWithInstructions = ActualPromptsYaml.image_generation.base_prompt_with_instructions_node;

      const requiredImagePlaceholders = [
        '{node_name}',
        '{node_long_description}',
        '{node_type}',
        '{all_nodes_context}',
        '{chat_history_context}'
      ];

      requiredImagePlaceholders.forEach(placeholder => {
        expect(basePromptDefault).toContain(placeholder);
        expect(basePromptWithInstructions).toContain(placeholder);
      });
    });
  });

  describe('FormatPrompt Function Validation', () => {
    it('should correctly replace placeholders in prompts', () => {
      const testPrompt = 'Hello {name}, welcome to {place}. Today is {day}.';
      const replacements = {
        name: 'Alice',
        place: 'Wonderland',
        day: 'Monday'
      };

      const result = formatPrompt(testPrompt, replacements);
      
      expect(result).toBe('Hello Alice, welcome to Wonderland. Today is Monday.');
      expect(result).not.toContain('{');
      expect(result).not.toContain('}');
    });

    it('should handle undefined replacements gracefully', () => {
      const testPrompt = 'Hello {name}, you have {count} messages.';
      const replacements = {
        name: 'Bob',
        count: undefined
      };

      const result = formatPrompt(testPrompt, replacements);
      
      expect(result).toBe('Hello Bob, you have  messages.');
      expect(result).not.toContain('{count}');
    });

    it('should handle multiple occurrences of the same placeholder', () => {
      const testPrompt = '{greeting} {name}! How are you today, {name}?';
      const replacements = {
        greeting: 'Hello',
        name: 'Charlie'
      };

      const result = formatPrompt(testPrompt, replacements);
      
      expect(result).toBe('Hello Charlie! How are you today, Charlie?');
      expect(result).not.toContain('{name}');
    });

    it('should work with actual prompts from the YAML', () => {
      // Test with a real prompt that has placeholders
      const relevantNodesPrompt = ActualPromptsYaml.node_operations.get_relevant_nodes;
      const replacements = {
        nodes_description: 'Test nodes',
        string_history: 'Test history'
      };

      const result = formatPrompt(relevantNodesPrompt, replacements);
      
      expect(result).toContain('Test nodes');
      expect(result).toContain('Test history');
      expect(result).not.toContain('{utils.wrappers.nodes_description}');
      expect(result).not.toContain('{utils.wrappers.string_history}');
    });

    it('should correctly process utils.wrappers placeholders with new format', () => {
      // Test that wrapper placeholders are correctly expanded and then replaced
      const testPrompt = 'Start {utils.wrappers.nodes_description} End';
      const replacements = {
        nodes_description: 'Test game state content'
      };

      const result = formatPrompt(testPrompt, replacements);
      
      // Should contain the wrapper structure with content name from YAML
      expect(result).toContain('## Current Game State:');
      expect(result).toContain('---- Start of current game state');
      expect(result).toContain('Test game state content');
      expect(result).toContain('---- End of current game state');
      
      // Should not contain the original wrapper placeholder
      expect(result).not.toContain('{utils.wrappers.nodes_description}');
      
      // Should not contain the content placeholder after replacement
      expect(result).not.toContain('{nodes_description}');
    });

    it('should validate wrapper format is key-value pairs', () => {
      // Verify that wrappers are now simple key-value pairs
      expect(typeof ActualPromptsYaml.utils.wrappers).toBe('object');
      
      // Check a few specific wrappers to ensure they're strings (content names)
      expect(typeof ActualPromptsYaml.utils.wrappers.nodes_description).toBe('string');
      expect(typeof ActualPromptsYaml.utils.wrappers.string_history).toBe('string');
      expect(typeof ActualPromptsYaml.utils.wrappers.user_input).toBe('string');
      
      // Verify the content names are meaningful
      expect(ActualPromptsYaml.utils.wrappers.nodes_description).toBe('Current Game State');
      expect(ActualPromptsYaml.utils.wrappers.string_history).toBe('Recent Chat History');
      expect(ActualPromptsYaml.utils.wrappers.user_input).toBe('User Input');
    });

    it('should correctly process utils.diffPrompt placeholders', () => {
      // Test that utils.diffPrompt placeholders are correctly replaced
      const testPrompt = 'Instructions: {utils.diffPrompt}';
      const replacements = {};

      const result = formatPrompt(testPrompt, replacements);
      
      // Should contain the actual diffPrompt content
      expect(result).toContain('## Diff Format Instructions');
      expect(result).toContain('### For complete replacement:');
      expect(result).toContain('### For targeted updates:');
      
      // Should not contain the original placeholder
      expect(result).not.toContain('{utils.diffPrompt}');
    });
  });

  describe('YAML Structure Integrity', () => {
    it('should not have any null or empty string prompts', () => {
      const allowedEmptyPaths = [
        'image_generation.type_specific_additions.default'
      ];
      
      const checkObject = (obj: any, path: string = '') => {
        Object.entries(obj).forEach(([key, value]) => {
          const currentPath = path ? `${path}.${key}` : key;
          
          if (typeof value === 'string') {
            // Allow specific paths to be empty (like default fallbacks)
            if (!allowedEmptyPaths.includes(currentPath)) {
              expect(value.trim().length, `Empty prompt at ${currentPath}`).toBeGreaterThan(0);
            }
            expect(value, `Null string at ${currentPath}`).not.toBe('null');
            expect(value, `Undefined string at ${currentPath}`).not.toBe('undefined');
          } else if (typeof value === 'object' && value !== null) {
            checkObject(value, currentPath);
          }
        });
      };

      checkObject(ActualPromptsYaml);
    });

    it('should validate that critical prompts contain expected sections', () => {
      // Check that key prompts have expected structure indicators
      const chatTextPrompt = ActualPromptsYaml.moxus_prompts.moxus_feedback_on_chat_text_generation;
      expect(chatTextPrompt).toContain('# Moxus:');
      expect(chatTextPrompt).toContain('## Your Role:');
      
      const nodeEditionPrompt = ActualPromptsYaml.node_operations.generate_node_edition;
      expect(nodeEditionPrompt).toContain('# TASK:');
      expect(nodeEditionPrompt).toContain('Return only the JSON object');
      
      const systemMessage = ActualPromptsYaml.utils.moxus_feedback_system_message;
      expect(systemMessage).toContain('# Moxus Creative Mentorship');
      expect(systemMessage).toContain('## Integration Instructions:');
    });
  });

  describe('Backwards Compatibility Check', () => {
    it('should maintain compatibility with existing code usage patterns', () => {
      // Test that the fix doesn't break existing access patterns used in the codebase
      
      // This should work (the fix I implemented)
      expect(() => {
        const systemMessage = ActualPromptsYaml.utils.moxus_feedback_system_message;
        formatPrompt(systemMessage, { moxus_llm_calls_memory_yaml: 'test' });
      }).not.toThrow();
      
      // Node operations should still work
      expect(() => {
        const chatPrompt = ActualPromptsYaml.node_operations.generate_chat_text;
        formatPrompt(chatPrompt, { user_input: 'test', nodes_description: 'test' });
      }).not.toThrow();
      
      // Moxus prompts should work
      expect(() => {
        const feedbackPrompt = ActualPromptsYaml.moxus_prompts.moxus_feedback_on_chat_text_generation;
        formatPrompt(feedbackPrompt, { assistant_nodes_content: 'test' });
      }).not.toThrow();
    });
  });
}); 