import { describe, it, expect } from 'vitest';
import { applyTextDiffInstructions } from '../utils/textUtils';
import { TextDiffInstruction } from '../models/nodeOperations';

describe('Text Diff Instructions Validation', () => {
  
  const sampleCharacterDescription = `Character profile

    Name: Neon
    Age: 26
    Class: Postman

Attributes

    Magical Exposure: 10/10 (enchanted letters give him a blue glow)
    Strength: 2/10
    Intelligence: 5/10
    Dexterity: 5/10
    Willpower: 5/10

Appearance

    Clothes: Neon wears a linen white tunic along with brown loose pants.
    Hairstyle: Medium-length brown hair, straight.
    Global impression: His postal uniform changes color based on message urgency. He carries a sentient bag that whispers routes.

Mental & Personality Traits:

Neon is a curious apprentice postman eager to learn on his routes but struggles staying still during rigorous tasks.`;

  describe('Basic diff operations', () => {
    it('should replace simple text fragments', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "Medium-length brown hair, straight.",
          next_txt: "Medium-length brown hair with silver streaks, wavy."
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      expect(result).toContain("Medium-length brown hair with silver streaks, wavy.");
      expect(result).not.toContain("Medium-length brown hair, straight.");
    });

    it('should delete text when next_txt is empty', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "Age: 26\n    ",
          next_txt: ""
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      expect(result).not.toContain("Age: 26");
    });

    it('should append text when prev_txt is empty', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "",
          next_txt: "\n\nEquipment:\n    Enchanted Messenger Bag: A sentient leather satchel."
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      expect(result).toContain("Equipment:");
      expect(result).toContain("Enchanted Messenger Bag:");
    });
  });

  describe('Complex diff operations', () => {
    it('should handle multiple sequential edits', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "Strength: 2/10",
          next_txt: "Strength: 3/10"
        },
        {
          prev_txt: "Intelligence: 5/10",
          next_txt: "Intelligence: 7/10"
        },
        {
          prev_txt: "Dexterity: 5/10",
          next_txt: "Dexterity: 8/10"
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      expect(result).toContain("Strength: 3/10");
      expect(result).toContain("Intelligence: 7/10");
      expect(result).toContain("Dexterity: 8/10");
      expect(result).not.toContain("Strength: 2/10");
      expect(result).not.toContain("Intelligence: 5/10");
      expect(result).not.toContain("Dexterity: 5/10");
    });

    it('should handle occurrence-specific replacements', () => {
      const textWithDuplicates = "The cat sat on the mat. The cat was happy. The cat purred.";
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "The cat",
          next_txt: "The magical cat",
          occ: 2
        }
      ];

      const result = applyTextDiffInstructions(textWithDuplicates, instructions);
      expect(result).toBe("The cat sat on the mat. The magical cat was happy. The cat purred.");
    });

    it('should handle long text replacements', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "His postal uniform changes color based on message urgency. He carries a sentient bag that whispers routes.",
          next_txt: "His uniform bears the Royal Mail Service seal. The fabric adapts to weather and his bag organizes deliveries automatically."
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      expect(result).toContain("His uniform bears the Royal Mail Service seal.");
      expect(result).toContain("fabric adapts to weather");
      expect(result).not.toContain("changes color based on message urgency");
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty instructions array', () => {
      const result = applyTextDiffInstructions(sampleCharacterDescription, []);
      expect(result).toBe(sampleCharacterDescription);
    });

    it('should handle null/undefined instructions', () => {
      const result1 = applyTextDiffInstructions(sampleCharacterDescription, null as any);
      const result2 = applyTextDiffInstructions(sampleCharacterDescription, undefined as any);
      expect(result1).toBe(sampleCharacterDescription);
      expect(result2).toBe(sampleCharacterDescription);
    });

    it('should handle non-existent text to replace', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "This text does not exist in the source",
          next_txt: "This replacement won't happen"
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      expect(result).toBe(sampleCharacterDescription);
      expect(result).not.toContain("This replacement won't happen");
    });

    it('should handle occurrence number higher than available matches', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "Neon",
          next_txt: "Neo",
          occ: 10 // There aren't 10 occurrences
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      // Should remain unchanged since the 10th occurrence doesn't exist
      expect(result).toBe(sampleCharacterDescription);
    });

    it('should handle special characters and formatting', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "    Magical Exposure: 10/10",
          next_txt: "    Magical Exposure: 8/10"
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      expect(result).toContain("Magical Exposure: 8/10");
      expect(result).not.toContain("Magical Exposure: 10/10");
    });
  });

  describe('Real-world scenario simulation', () => {
    it('should handle a complex character progression update', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "Age: 26",
          next_txt: "Age: 27"
        },
        {
          prev_txt: "Class: Postman",
          next_txt: "Class: Senior Courier"
        },
        {
          prev_txt: "enchanted letters give him a blue glow",
          next_txt: "years of magical exposure have made him a conduit for arcane energy"
        },
        {
          prev_txt: "linen white tunic along with brown loose pants",
          next_txt: "reinforced courier's jacket with protective enchantments"
        },
        {
          prev_txt: "struggles staying still during rigorous tasks.",
          next_txt: "struggles staying still during rigorous tasks, though his promotion gave him confidence."
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      
      expect(result).toContain("Age: 27");
      expect(result).toContain("Class: Senior Courier");
      expect(result).toContain("conduit for arcane energy");
      expect(result).toContain("reinforced courier's jacket");
      expect(result).toContain("promotion gave him confidence");
      
      expect(result).not.toContain("Age: 26");
      expect(result).not.toContain("Class: Postman");
      expect(result).not.toContain("linen white tunic");
    });

    it('should maintain text integrity after multiple operations', () => {
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "Neon",
          next_txt: "Neo",
          occ: 1
        },
        {
          prev_txt: "postman",
          next_txt: "messenger"
        }
      ];

      const result = applyTextDiffInstructions(sampleCharacterDescription, instructions);
      
      // Check that the structure is maintained
      expect(result).toContain("Character profile");
      expect(result).toContain("Attributes");
      expect(result).toContain("Appearance");
      expect(result).toContain("Mental & Personality Traits:");
      
      // Check that specific changes were made
      expect(result).toContain("Name: Neo"); // First Neon changed to Neo in the name field
      expect(result).toContain("apprentice messenger"); // postman -> messenger
      
      // Verify that only the first occurrence of "Neon" was changed
      const neonOccurrences = (result.match(/Neon/g) || []).length;
      const originalNeonOccurrences = (sampleCharacterDescription.match(/Neon/g) || []).length;
      expect(neonOccurrences).toBe(originalNeonOccurrences - 1); // One less "Neon" after replacement
    });
  });

  describe('Performance and robustness', () => {
    it('should handle large text efficiently', () => {
      const largeText = sampleCharacterDescription.repeat(100);
      const instructions: TextDiffInstruction[] = [
        {
          prev_txt: "Class: Postman",
          next_txt: "Class: Arcane Messenger"
        }
      ];

      const startTime = performance.now();
      const result = applyTextDiffInstructions(largeText, instructions);
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(100); // Should complete in under 100ms
      expect(result).toContain("Class: Arcane Messenger");
    });

    it('should handle many small edits', () => {
      const manyInstructions: TextDiffInstruction[] = Array.from({ length: 20 }, (_, i) => ({
        prev_txt: `${i}/10`,
        next_txt: `${i + 1}/10`
      }));

      // This shouldn't crash or hang
      const result = applyTextDiffInstructions(sampleCharacterDescription, manyInstructions);
      expect(typeof result).toBe('string');
    });
  });
}); 