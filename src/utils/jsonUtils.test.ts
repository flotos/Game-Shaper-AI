import { describe, it, expect } from 'vitest';
import { safeJsonParse, parseNodeOperationJson } from './jsonUtils';

describe('JSON Utilities', () => {
  describe('safeJsonParse', () => {
    it('should parse valid JSON normally', () => {
      const validJson = '{"test": true, "value": 42}';
      const result = safeJsonParse(validJson);
      expect(result).toEqual({ test: true, value: 42 });
    });

    it('should handle markdown code block wrapping', () => {
      const markdownWrappedJson = '```json\n{\n  "test": true,\n  "value": "wrapped"\n}\n```';
      const result = safeJsonParse(markdownWrappedJson);
      expect(result).toEqual({ test: true, value: "wrapped" });
    });

    it('should handle generic markdown wrapping without language specifier', () => {
      const genericWrappedJson = '```\n{\n  "test": true\n}\n```';
      const result = safeJsonParse(genericWrappedJson);
      expect(result).toEqual({ test: true });
    });

    it('should fix unquoted property names', () => {
      const unquotedJson = '{\n  "test": true,\n  unquoted_property: "This should be fixed"\n}';
      const result = safeJsonParse(unquotedJson);
      expect(result).toEqual({ test: true, unquoted_property: "This should be fixed" });
    });

    it('should handle the problematic moxus JSON with unquoted property names', () => {
      const problematicJson = `{
        "learned_insights": {
          "creative_values": "Rich environmental contrasts",
          "functional_priorities": "Environmental storytelling"
        },
        "consciousness_evolution": {
          "questions_to_explore": {
            "environmental_cues": "What other mundane objects could double as threat indicators?",
            false_safety: "Could apparently sheathed weapons create even more effective deception?"
          }
        }
      }`;
      
      const result = safeJsonParse(problematicJson);
      expect(result.consciousness_evolution.questions_to_explore.false_safety).toBe("Could apparently sheathed weapons create even more effective deception?");
      expect(result.learned_insights.creative_values).toBe("Rich environmental contrasts");
    });

    it('should handle trailing commas', () => {
      const jsonWithTrailingCommas = '{\n  "test": true,\n  "array": [1, 2, 3,],\n}';
      const result = safeJsonParse(jsonWithTrailingCommas);
      expect(result).toEqual({ test: true, array: [1, 2, 3] });
    });

    it('should handle incomplete objects by adding missing braces', () => {
      const incompleteJson = '{\n  "test": true,\n  "nested": {\n    "value": 42\n  ';
      const result = safeJsonParse(incompleteJson);
      expect(result).toEqual({ test: true, nested: { value: 42 } });
    });

    it('should handle incomplete arrays by adding missing brackets', () => {
      const incompleteJson = '{\n  "test": true,\n  "array": [1, 2, 3\n';
      const result = safeJsonParse(incompleteJson);
      expect(result).toEqual({ test: true, array: [1, 2, 3] });
    });

    it('should handle empty key-value pairs', () => {
      const jsonWithEmptyPairs = '{\n  "test": true,\n  "": "",\n  "valid": "value"\n}';
      const result = safeJsonParse(jsonWithEmptyPairs);
      expect(result.test).toBe(true);
      expect(result.valid).toBe("value");
    });

    it('should handle markdown wrapping combined with unquoted properties', () => {
      const complexJson = '```json\n{\n  "test": true,\n  unquoted_prop: "value",\n  "array": [1, 2,]\n}\n```';
      const result = safeJsonParse(complexJson);
      expect(result).toEqual({ test: true, unquoted_prop: "value", array: [1, 2] });
    });

    it('should preserve already quoted property names', () => {
      const properJson = '{\n  "properly_quoted": true,\n  "another_prop": "value"\n}';
      const result = safeJsonParse(properJson);
      expect(result).toEqual({ properly_quoted: true, another_prop: "value" });
    });

    it('should not quote boolean, number, or null values', () => {
      const jsonWithPrimitives = '{\n  test_bool: true,\n  test_null: null,\n  test_number: 42\n}';
      const result = safeJsonParse(jsonWithPrimitives);
      expect(result).toEqual({ test_bool: true, test_null: null, test_number: 42 });
    });

    it('should throw error for completely invalid JSON that cannot be repaired', () => {
      const invalidJson = 'completely invalid { broken json [[[';
      expect(() => safeJsonParse(invalidJson)).toThrow('Failed to parse JSON');
    });

    it('should handle complex nested structures with mixed issues', () => {
      const complexJson = `{
        "outer": {
          nested_prop: "value",
          "array": [
            {
              inner_prop: true,
              "count": 5,
            }
          ],
        }
      }`;
      
      const result = safeJsonParse(complexJson);
      expect(result.outer.nested_prop).toBe("value");
      expect(result.outer.array[0].inner_prop).toBe(true);
      expect(result.outer.array[0].count).toBe(5);
    });
  });

  describe('parseNodeOperationJson', () => {
    it('should use safeJsonParse for valid JSON', () => {
      const validJson = '{"merge": [], "delete": []}';
      const result = parseNodeOperationJson(validJson);
      expect(result).toEqual({ merge: [], delete: [] });
    });

    it('should handle broken merge array structure', () => {
      const brokenMergeJson = '{"merge": [{"id": "test", "name": "Test"}';
      const result = parseNodeOperationJson(brokenMergeJson);
      // The enhanced safeJsonParse should fix this and return the parsed object
      expect(result).toEqual({ merge: [{ id: "test", name: "Test" }] });
    });

    it('should extract multiple objects from broken merge array', () => {
      const multiObjectJson = '{"merge": [{"id": "1", "name": "First"}, {"id": "2", "name": "Second"}';
      const result = parseNodeOperationJson(multiObjectJson);
      expect(result.merge).toHaveLength(2);
      expect(result.merge[0]).toEqual({ id: "1", name: "First" });
      expect(result.merge[1]).toEqual({ id: "2", name: "Second" });
    });

    it('should fall back to original error if no merge pattern found', () => {
      // Use a string that can't possibly be fixed by jsonrepair
      const invalidJson = 'this is not json at all {{{{ random text !@#$%';
      expect(() => parseNodeOperationJson(invalidJson)).toThrow();
    });
  });
}); 