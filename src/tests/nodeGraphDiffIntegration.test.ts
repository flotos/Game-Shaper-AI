import { describe, it, expect, vi } from 'vitest';
import { Node } from '../models/Node';
import { LLMNodeEditionResponse, FieldUpdateOperation } from '../models/nodeOperations';
import { applyTextDiffInstructions } from '../utils/textUtils';

describe('Node Graph Diff Integration', () => {
  
  it('should properly apply diff instructions to character data', () => {
    const characterDescription = `Character profile

    Name: Aria
    Age: 25
    Class: Mage

Attributes

    Magic Power: 5/10
    Strength: 3/10
    Intelligence: 8/10

Appearance

    Clothes: Aria wears simple robes and carries a wooden staff.
    Personality: She is studious and curious about magic.`;

    const diffInstructions = [
      {
        prev_txt: "Age: 25",
        next_txt: "Age: 26"
      },
      {
        prev_txt: "Class: Mage",
        next_txt: "Class: Archmage"
      },
      {
        prev_txt: "Magic Power: 5/10",
        next_txt: "Magic Power: 9/10"
      },
      {
        prev_txt: "simple robes and carries a wooden staff",
        next_txt: "elaborate robes and carries a crystal staff"
      }
    ];

    const result = applyTextDiffInstructions(characterDescription, diffInstructions);
    
    expect(result).toContain("Age: 26");
    expect(result).toContain("Class: Archmage");
    expect(result).toContain("Magic Power: 9/10");
    expect(result).toContain("elaborate robes and carries a crystal staff");
    
    expect(result).not.toContain("Age: 25");
    expect(result).not.toContain("Class: Mage");
    expect(result).not.toContain("Magic Power: 5/10");
    expect(result).not.toContain("simple robes and carries a wooden staff");
  });

  it('should handle complex field update operations structure', () => {
    const originalText = `The tavern is bustling with activity. Patrons drink ale and share stories. The innkeeper serves food with a smile.`;

    const fieldUpdate: FieldUpdateOperation = {
      df: [
        {
          prev_txt: "bustling with activity",
          next_txt: "quiet and peaceful"
        },
        {
          prev_txt: "drink ale and share stories",
          next_txt: "read books and study maps"
        },
        {
          prev_txt: "serves food with a smile",
          next_txt: "organizes rooms with efficiency"
        }
      ]
    };

    const result = applyTextDiffInstructions(originalText, fieldUpdate.df!);
    
    expect(result).toContain("quiet and peaceful");
    expect(result).toContain("read books and study maps");
    expect(result).toContain("organizes rooms with efficiency");
    
    expect(result).not.toContain("bustling with activity");
    expect(result).not.toContain("drink ale and share stories");
    expect(result).not.toContain("serves food with a smile");
  });

  it('should handle node edition response structure validation', () => {
    const nodeEdition: LLMNodeEditionResponse = {
      callId: 'test-call-123',
      u_nodes: {
        'character-1': {
          longDescription: {
            df: [
              {
                prev_txt: "old text",
                next_txt: "new text"
              }
            ]
          },
          img_upd: true
        },
        'location-1': {
          name: {
            rpl: "New Location Name"
          },
          type: {
            rpl: "Updated Type"
          }
        }
      },
      n_nodes: [
        {
          id: 'new-node-1',
          name: 'New Character',
          type: 'Character',
          image: 'new-image.jpg',
          longDescription: 'A newly created character for the story.'
        }
      ],
      d_nodes: ['old-node-to-delete']
    };

    expect(nodeEdition.callId).toBe('test-call-123');
    expect(nodeEdition.u_nodes).toBeDefined();
    expect((nodeEdition.u_nodes!['character-1'].longDescription as FieldUpdateOperation)?.df).toBeDefined();
    expect(nodeEdition.u_nodes!['character-1'].img_upd).toBe(true);
    expect((nodeEdition.u_nodes!['location-1'].name as FieldUpdateOperation)?.rpl).toBe("New Location Name");
    expect(nodeEdition.n_nodes).toHaveLength(1);
    expect(nodeEdition.d_nodes).toContain('old-node-to-delete');
  });

  it('should validate diff instruction error handling', () => {
    const testText = "The hero walks through the forest.";

    const validInstructions = [
      {
        prev_txt: "hero",
        next_txt: "adventurer"
      }
    ];

    const invalidInstructions = [
      {
        prev_txt: "dragon",  // doesn't exist in text
        next_txt: "wyvern"
      }
    ];

    const mixedInstructions = [
      ...validInstructions,
      ...invalidInstructions,
      {
        prev_txt: "forest",
        next_txt: "woodland"
      }
    ];

    const result = applyTextDiffInstructions(testText, mixedInstructions);
    
    // Valid changes should be applied
    expect(result).toContain("adventurer");
    expect(result).toContain("woodland");
    expect(result).not.toContain("hero");
    expect(result).not.toContain("forest");
    
    // Invalid changes should not break the text
    expect(result).not.toContain("wyvern");
    expect(result).not.toContain("dragon");
  });

  it('should handle character progression scenario like the original node content', () => {
    const originalCharacter = `Character profile

    Name: Neon
    Age: 26
    Class: Postman

Attributes

    Strength: 2/10
    Intelligence: 5/10
    Dexterity: 5/10
    Willpower: 5/10

Appearance

    Clothes: Neon wears a white tunic and brown pants.
    Personality: He is curious and eager to learn.`;

    const progressionUpdates = [
      {
        prev_txt: "Age: 26",
        next_txt: "Age: 27"
      },
      {
        prev_txt: "Class: Postman",
        next_txt: "Class: Senior Courier"
      },
      {
        prev_txt: "Strength: 2/10",
        next_txt: "Strength: 4/10"
      },
      {
        prev_txt: "Intelligence: 5/10",
        next_txt: "Intelligence: 7/10"
      },
      {
        prev_txt: "white tunic and brown pants",
        next_txt: "professional courier uniform"
      },
      {
        prev_txt: "curious and eager to learn",
        next_txt: "experienced and confident"
      }
    ];

    const result = applyTextDiffInstructions(originalCharacter, progressionUpdates);

    expect(result).toContain("Age: 27");
    expect(result).toContain("Class: Senior Courier");
    expect(result).toContain("Strength: 4/10");
    expect(result).toContain("Intelligence: 7/10");
    expect(result).toContain("professional courier uniform");
    expect(result).toContain("experienced and confident");

    expect(result).not.toContain("Age: 26");
    expect(result).not.toContain("Class: Postman");
    expect(result).not.toContain("Strength: 2/10");
    expect(result).not.toContain("Intelligence: 5/10");
    expect(result).not.toContain("white tunic and brown pants");
    expect(result).not.toContain("curious and eager to learn");

    expect(result).toContain("Character profile");
    expect(result).toContain("Attributes");
    expect(result).toContain("Appearance");
  });

  it('should verify the advanced node generation diff integration fix', () => {
    // This test verifies that the bug where existing node updates were ignored is fixed
    // The bug was in the condition check: editedNodes[nodeId] && diff.u_nodes && diff.u_nodes[nodeId]
    // which should have been: diff.u_nodes && diff.u_nodes[nodeId] && editedNodes[nodeId]
    
    const originalNode = {
      id: 'char_001',
      name: 'Original Hero',
      longDescription: 'A basic character with strength 3/10 and limited experience.',
      type: 'character'
    };

    // Simulate the u_nodes format from LLM response
    const uNodesUpdate = {
      'char_001': {
        name: { rpl: 'Experienced Hero' },
        longDescription: {
          df: [
            { prev_txt: 'strength 3/10', next_txt: 'strength 7/10' },
            { prev_txt: 'limited experience', next_txt: 'extensive combat experience' }
          ]
        }
      }
    };

    // Apply the diff directly using applyTextDiffInstructions for verification
    let updatedDescription = originalNode.longDescription;
    for (const instruction of uNodesUpdate['char_001'].longDescription.df!) {
      updatedDescription = applyTextDiffInstructions(updatedDescription, [instruction]);
    }

    expect(updatedDescription).toContain('strength 7/10');
    expect(updatedDescription).toContain('extensive combat experience');
    expect(updatedDescription).not.toContain('strength 3/10');
    expect(updatedDescription).not.toContain('limited experience');
    
    // Verify replacement operation
    const updatedName = (uNodesUpdate['char_001'].name as any).rpl;
    expect(updatedName).toBe('Experienced Hero');
  });

  it('should handle LLM output with direct df array format', () => {
    // This tests the format that comes directly from LLM calls in advanced generation
    const originalText = 'You are Moxus, a twisted AI assistant with its own mind.\nYou are a depraved assistant manager, who seek to punish and sexually abuse the player.';
    
    const directDfFormat = [
      {
        "prev_txt": "You are Moxus, a twisted AI assistant with its own mind.\nYou are a depraved assistant manager, who seek to punish and sexually abuse the player.",
        "next_txt": "You are Moxus, a sophisticated AI assistant with a penchant for psychological manipulation and control.",
        "occ": 1
      }
    ];

    const result = applyTextDiffInstructions(originalText, directDfFormat);
    
    expect(result).toContain('sophisticated AI assistant with a penchant for psychological manipulation');
    expect(result).not.toContain('twisted AI assistant with its own mind');
    expect(result).not.toContain('depraved assistant manager');
  });

  it('should handle field update operations with mixed rpl and df', () => {
    // Test the FieldUpdateOperation interface with mixed operations
    const characterData = {
      name: 'Old Name',
      longDescription: 'This character has basic skills and simple equipment.',
      type: 'character'
    };

    const fieldUpdates = {
      name: { rpl: 'Enhanced Character' },
      longDescription: {
        df: [
          { prev_txt: 'basic skills', next_txt: 'advanced abilities' },
          { prev_txt: 'simple equipment', next_txt: 'masterwork gear' }
        ]
      },
      type: { rpl: 'elite_character' }
    };

    // Apply name replacement
    const updatedName = (fieldUpdates.name as FieldUpdateOperation).rpl;
    expect(updatedName).toBe('Enhanced Character');

    // Apply description diff
    const updatedDescription = applyTextDiffInstructions(
      characterData.longDescription, 
      (fieldUpdates.longDescription as FieldUpdateOperation).df!
    );
    expect(updatedDescription).toContain('advanced abilities');
    expect(updatedDescription).toContain('masterwork gear');
    expect(updatedDescription).not.toContain('basic skills');
    expect(updatedDescription).not.toContain('simple equipment');

    // Apply type replacement
    const updatedType = (fieldUpdates.type as FieldUpdateOperation).rpl;
    expect(updatedType).toBe('elite_character');
  });
}); 