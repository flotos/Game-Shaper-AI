import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getResponse, loadedPrompts, formatPrompt, getLastFiveInteractions } from '../services/llmCore'; // Path to llmCore
import { 
  generateChatText,
  getRelevantNodes,
  generateActions,
  generateNodeEdition,
  generateNodesFromPrompt,
  sortNodesByRelevance,
  refocusStory,
  // generateUserInputResponse // Will be tested separately due to its compositional nature
} from '../services/nodeInteractionLLMService'; // Function to test
import { Message } from '../context/ChatContext'; // Type if needed
import { Node } from '../models/Node'; // Import Node type
import { LLMNodeEditionResponse } from '../models/nodeOperations';

// Mock the llmCore module
vi.mock('../services/llmCore', () => ({
  getResponse: vi.fn(),
  loadedPrompts: {
    node_operations: {
      get_relevant_nodes: 'Test prompt for get_relevant_nodes: {nodes_description} {string_history}',
      generate_chat_text: 'Test prompt for generate_chat_text: {user_input} {string_history} {nodes_description} {last_moxus_report_section}',
      generate_actions: 'Test prompt for generate_actions: {nodes_description} {formatted_chat_text} {last_moxus_report_section} {user_input}',
      generate_node_edition: 'Test prompt for generate_node_edition: {think_mode} {nodes_description} {formatted_chat_history} {last_moxus_report_section} {actions_list} {user_input}',
      generate_nodes_from_prompt: 'Test prompt for generate_nodes_from_prompt: {user_prompt} {moxus_context_string} {nodes_description}',
      sort_nodes_by_relevance: 'Test prompt for sort_nodes_by_relevance: {string_history} {last_moxus_report_section} {nodes_description}',
      refocus_story: 'Test prompt for refocus_story: {past_chat_history} {nodes_description}',
    },
    // moxus_prompts might be needed if MoxusService calls are part of the tested functions directly
    // and not mocked at a higher level. For now, assume direct llmCore.getResponse calls.
  },
  formatPrompt: vi.fn((template: string, replacements: Record<string, string | undefined>) => {
    let result = template;
    for (const key in replacements) {
      const value = replacements[key];
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
    }
    return result;
  }),
  getLastFiveInteractions: vi.fn((chatHistory: Message[]) => {
    const lastFive = chatHistory.slice(-5);
    return lastFive.filter(message => 
      message.role === "user" || 
      message.role === "assistant" || 
      message.role === "userMandatoryInstructions"
    );
  }),
}));

// Mock MoxusService as it's used for logging within processJsonResponse
// and some functions call it directly.
vi.mock('../services/MoxusService', () => ({
  moxusService: {
    initiateLLMCallRecord: vi.fn(),
    finalizeLLMCallRecord: vi.fn(),
    failLLMCallRecord: vi.fn(),
    getLLMCallsMemoryYAML: vi.fn().mockReturnValue('mocked_yaml_memory'),
    // Add other methods if they are called and need specific mock behavior
  }
}));


describe('Node Interaction LLM Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset getResponse to a default safe mock to avoid interference between test suites if one forgets to mock it.
    (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({ llmResult: '{}', callId: 'default-test-id' });
  });

  // Common mock data
  const mockUserInput = 'Test input';
  const mockChatHistory: Message[] = [{ role: 'user', content: 'Hello' }];
  const mockNodes: Node[] = [{
    id: '1',
    name: 'Node1',
    longDescription: 'A descriptive node',
    image: 'placeholder.jpg',
    type: 'story'
  }, {
    id: '2',
    name: 'Node2',
    longDescription: 'Another node',
    image: 'placeholder2.jpg',
    type: 'character'
  }, {
    id: '3',
    name: 'ImageGenNode',
    longDescription: 'An image gen node',
    image: 'placeholder3.jpg',
    type: 'image_generation' // This node type should be excluded from nodesDescription
  }];
  const mockDetailedNodeIds: String[] = ['1'];

  describe('getRelevantNodes', () => {
    const specificChatHistory: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'system', content: 'System message, should be ignored by stringHistory'}
    ];

    it('should call formatPrompt with correct template and replacements, then call getResponse', async () => {
      const mockRelevantNodeIds = ['1', '2'];
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: JSON.stringify({ relevantNodes: mockRelevantNodeIds }),
        callId: 'relevant-nodes-call-id'
      });

      // Expected replacements for formatPrompt based on the service function's logic
      const expectedStringHistory = 
        `user: Hello\n` +
        `assistant: Hi there!\n`;
      
      const expectedNodesDescription = 
        `\n    ---\n    id: 1\n    name: Node1\n    type: story\n    ` +
        `\n    ---\n    id: 2\n    name: Node2\n    type: character\n    `;

      await getRelevantNodes(mockUserInput, specificChatHistory, mockNodes);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).get_relevant_nodes, // Accessing mocked template
        {
          nodes_description: expectedNodesDescription,
          string_history: expectedStringHistory
        }
      );
      
      expect(getResponse).toHaveBeenCalledTimes(1);
      expect(getResponse).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({role: 'system'})]), // messages array, content is based on formatPrompt output
        "gpt-3.5-turbo",
        undefined,
        false,
        { type: 'json_object' },
        undefined,
        'node_relevance_check'
      );
      // The actual result parsing is already tested, focus here is on prompt generation
    });

    it('should throw an error if getResponse fails for getRelevantNodes', async () => {
      const mockError = new Error('LLM API Error for getRelevantNodes');
      (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
      await expect(getRelevantNodes(mockUserInput, mockChatHistory, mockNodes)).rejects.toThrow(mockError);
    });
  });

  describe('generateChatText', () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Mock stream response'));
        controller.close();
      }
    });
    const mockHttpResponse = new Response(mockStream);
    
    const chatHistoryForTextGen: Message[] = [
      {role: 'user', content: 'Old user message'},
      {role: 'assistant', content: 'Old assistant message'},
      {role: 'moxus', content: '**Moxus Report:** Follow these instructions.'},
      {role: 'user', content: mockUserInput} // mockUserInput is 'Test input'
    ];
    // getLastFiveInteractions is mocked to return chatHistory.slice(-5)
    // For this history, it will return all 4 messages.

    it('should call formatPrompt with correct template and replacements, then call getResponse', async () => {
      const mockLLMResponse = {
        streamResponse: mockHttpResponse,
        callId: 'test-call-id-chat'
      };
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue(mockLLMResponse);
      // (getLastFiveInteractions as ReturnType<typeof vi.fn>).mockImplementation(messages => messages.slice(-5)); // Removed, using global mock now

      // Expected replacements
      const expectedStringHistory = 
        `user: Old user message\n` +
        `assistant: Old assistant message\n` +
        // Moxus message is filtered out by the improved getLastFiveInteractions mock
        `user: ${mockUserInput}\n`;

      // mockNodes currently has 3 nodes, one is image_generation (excluded)
      // Node1: story, Node2: character
      const expectedNodesDescription = 
        `\n        id: 1\n        name: Node1\n        longDescription: A descriptive node\n        type: story\n        ` +
        `\n        id: 2\n        name: Node2\n        longDescription: Another node\n        type: character\n        `;

      const expectedLastMoxusReportSection = `
  ### Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  Follow these instructions.
  `;

      await generateChatText(mockUserInput, chatHistoryForTextGen, mockNodes, mockDetailedNodeIds);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).generate_chat_text,
        {
          nodes_description: expectedNodesDescription,
          string_history: expectedStringHistory,
          last_moxus_report_section: expectedLastMoxusReportSection,
          user_input: mockUserInput
        }
      );

      expect(getResponse).toHaveBeenCalledTimes(1);
      // getResponse call assertions remain the same as before
      expect(getResponse).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ role: 'system' })]), 
        'gpt-4o',
        undefined,
        true, 
        undefined,
        undefined,
        'chat_text_generation'
      );
    });

    it('should throw an error if getResponse fails for generateChatText', async () => {
      const mockError = new Error('LLM API Error for generateChatText');
      (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
      await expect(generateChatText(mockUserInput, mockChatHistory, mockNodes, mockDetailedNodeIds)).rejects.toThrow(mockError);
    });
  });

  describe('generateActions', () => {
    const historyForActions: Message[] = [
      {role: 'user', content: 'Earlier user message'},
      {role: 'assistant', content: 'Earlier assistant response containing the story'},
      {role: 'moxus', content: '**Moxus Report:** Actions should be limited.'},
      {role: 'user', content: mockUserInput} // mockUserInput is 'Test input'
    ];

    it('should call formatPrompt with correct replacements when chatText is Message[]', async () => {
      const mockActions = ['action1', 'action2'];
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: JSON.stringify({ actions: mockActions }),
        callId: 'actions-call-id'
      });

      // Expected replacements
      // getLastFiveInteractions (mocked) will filter historyForActions
      const expectedFormattedChatText = 
        `user: Earlier user message\n` +
        `assistant: Earlier assistant response containing the story\n` +
        `user: ${mockUserInput}\n`; // Moxus message filtered out

      const expectedNodesDescription = 
        `\n      id: 1\n      name: Node1\n      longDescription: A descriptive node\n      type: story\n      ` +
        `\n      id: 2\n      name: Node2\n      longDescription: Another node\n      type: character\n      `; // image_generation node excluded
      
      const expectedLastMoxusReportSection = `
  ## Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  Actions should be limited.
  `;

      await generateActions(historyForActions, mockNodes, mockUserInput);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).generate_actions,
        {
          nodes_description: expectedNodesDescription,
          formatted_chat_text: expectedFormattedChatText,
          last_moxus_report_section: expectedLastMoxusReportSection,
          user_input: mockUserInput
        }
      );
      expect(getResponse).toHaveBeenCalledTimes(1); // Other getResponse assertions remain
    });

    it('should call formatPrompt with correct replacements when chatText is a string', async () => {
      const mockActions = ['action3', 'action4'];
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: JSON.stringify({ actions: mockActions }),
        callId: 'actions-call-id-string'
      });

      const plainStringChatText = "This is the story text provided as a string.";
      
      // Expected replacements
      const expectedNodesDescription = 
        `\n      id: 1\n      name: Node1\n      longDescription: A descriptive node\n      type: story\n      ` +
        `\n      id: 2\n      name: Node2\n      longDescription: Another node\n      type: character\n      `;

      await generateActions(plainStringChatText, mockNodes, mockUserInput);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).generate_actions,
        {
          nodes_description: expectedNodesDescription,
          formatted_chat_text: plainStringChatText, // Directly uses the string
          last_moxus_report_section: '', // No moxus report if chatText is a string
          user_input: mockUserInput
        }
      );
      expect(getResponse).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if getResponse fails for generateActions', async () => {
      const mockError = new Error('LLM API Error for generateActions');
      (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
      await expect(generateActions(historyForActions, mockNodes, mockUserInput)).rejects.toThrow(mockError);
    });
  });

  describe('generateNodeEdition', () => {
    const chatHistoryForEdition: Message[] = [
      {role: 'user', content: 'A user interaction'},
      {role: 'moxus', content: '**Moxus Report:** Consider node X.'},
      {role: 'assistant', content: 'Okay, I will consider node X.'}
    ];
    const mockActionsForEdition = ['action_A', 'action_B'];
    const nodesForEditionTest: Node[] = [
      ...mockNodes, // Includes story, character, image_generation (filtered by default)
      { id: '4', name: 'SystemNode', longDescription: 'system desc', image: 'sys.png', type: 'system' }, // Filtered
      { id: '5', name: 'GameRuleNode', longDescription: 'rule desc', image: 'rule.png', type: 'Game Rule' } // Filtered
    ];

    it('should correctly parse complex LLM YAML response for node editions', async () => {
      // This is what we expect processJsonResponse to return after parsing the YAML and adding callId
      const mockExpectedParsedResponse: LLMNodeEditionResponse = {
        callId: 'edition-complex-call-id',
        n_nodes: [
          { id: 'new1', name: 'New Node Alpha', type: 'event', longDescription: 'Alpha event description', image:'alpha.png' },
          { id: 'new2', name: 'New Node Beta', type: 'character', longDescription: 'Beta character intro', image:'beta.png' }
        ],
        u_nodes: { 
          '1': { // Existing Node ID '1' from mockNodes
            name: { rpl: 'Updated Node1 Name' }, 
            longDescription: { 
              df: [ 
                { prev_txt: 'descriptive', next_txt: 'extensively descriptive' },
                { prev_txt: 'node', next_txt: 'entity' }
              ] 
            },
            type: {rpl: 'quest_item'},
            img_upd: true // Signal image regeneration for this node
          },
          '2': { // Existing Node ID '2' from mockNodes
            longDescription: { rpl: 'Completely new long description for Node 2.' }
          }
        },
        d_nodes: ['delete_id_1', 'delete_id_2']
      };

      // This is the raw YAML string we mock the LLM to return
      const mockLlmYamlOutput = `
n_nodes:
  - id: new1
    name: New Node Alpha
    type: event
    longDescription: Alpha event description
    image: alpha.png
  - id: new2
    name: New Node Beta
    type: character
    longDescription: Beta character intro
    image: beta.png
u_nodes:
  "1": # Corresponds to mockNodes[0]
    name:
      rpl: Updated Node1 Name
    longDescription:
      df:
        - prev_txt: descriptive
          next_txt: extensively descriptive
        - prev_txt: node
          next_txt: entity
    type:
      rpl: quest_item
    img_upd: true
  "2": # Corresponds to mockNodes[1]
    longDescription:
      rpl: Completely new long description for Node 2.
d_nodes:
  - delete_id_1
  - delete_id_2
`;

      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: mockLlmYamlOutput,
        callId: mockExpectedParsedResponse.callId // This callId is passed through by processJsonResponse
      });

      // Call the function under test
      const result = await generateNodeEdition(chatHistoryForEdition, mockActionsForEdition, nodesForEditionTest, mockUserInput, true); // isUserInteraction = true for /no_think

      // Assertions for prompt generation (already covered, but good to keep)
      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).generate_node_edition,
        expect.objectContaining({ think_mode: '/no_think' })
      );
      expect(getResponse).toHaveBeenCalledTimes(1);

      // Assertions for the parsed response structure
      expect(result.callId).toBe(mockExpectedParsedResponse.callId);
      expect(result.n_nodes).toEqual(mockExpectedParsedResponse.n_nodes);
      expect(result.u_nodes).toEqual(mockExpectedParsedResponse.u_nodes);
      expect(result.d_nodes).toEqual(mockExpectedParsedResponse.d_nodes);
    });
    
    it('should use /think for think_mode when isUserInteraction is false', async () => {
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: `u_nodes:\n  "1":\n    name: { rpl: "Updated Node1" }`,
        callId: 'edition-call-id-user-false'
      });

      // Only checking the think_mode difference here, other params assumed similar to above for brevity
      await generateNodeEdition(chatHistoryForEdition, mockActionsForEdition, nodesForEditionTest, mockUserInput, false); // isUserInteraction = false

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).generate_node_edition,
        expect.objectContaining({ // Check only a subset of properties
          think_mode: '/think' 
        })
      );
    });

    it('should throw an error if getResponse fails for generateNodeEdition', async () => {
        const mockError = new Error('LLM API Error for generateNodeEdition');
        (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
        await expect(generateNodeEdition(chatHistoryForEdition, mockActionsForEdition, nodesForEditionTest, mockUserInput, false)).rejects.toThrow(mockError);
    });
  });

  describe('generateNodesFromPrompt', () => {
    const userPromptForNodeGen = "Create a happy little tree node.";
    const moxusMemoryInputForNodeGen = {
      general: "Sky is blue.",
      chatText: "User likes trees.",
      nodeEdition: "No recent editions."
    };
    const moxusPersonalityForNodeGen = "Helpful assistant.";

    it('should call formatPrompt with correct replacements, then getResponse', async () => {
      const mockNewNodesData = { merge: [{ id: 'tree1', name: 'Happy Tree', type: 'flora', longDescription:'A very happy tree', image:'tree.png' }], delete: [] };
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: JSON.stringify(mockNewNodesData),
        callId: 'nodes-prompt-call-id'
      });

      // Expected replacements
      let expectedMoxusContextString = "\n\n# MOXUS CONTEXT";
      expectedMoxusContextString += `\n\n## Moxus Personality:\n${moxusPersonalityForNodeGen}`;
      expectedMoxusContextString += `\n\n## Moxus General Memory:\n${moxusMemoryInputForNodeGen.general}`;
      expectedMoxusContextString += `\n\n## Moxus Chat Text Analysis:\n${moxusMemoryInputForNodeGen.chatText}`;
      expectedMoxusContextString += `\n\n## Moxus Node Editions Analysis:\n${moxusMemoryInputForNodeGen.nodeEdition}`;

      const expectedNodesDescription = 
        `\n    id: 1\n    name: Node1\n    longDescription: A descriptive node\n    type: story\n    ` +
        `\n    id: 2\n    name: Node2\n    longDescription: Another node\n    type: character\n    `; // System & image_generation nodes filtered out by the function

      await generateNodesFromPrompt(userPromptForNodeGen, mockNodes, moxusMemoryInputForNodeGen, moxusPersonalityForNodeGen);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).generate_nodes_from_prompt,
        {
          user_prompt: userPromptForNodeGen,
          moxus_context_string: expectedMoxusContextString,
          nodes_description: expectedNodesDescription
        }
      );
      expect(getResponse).toHaveBeenCalledTimes(1); // Other getResponse assertions remain
    });

    it('should handle undefined moxusMemoryInput and moxusPersonality', async () => {
        const mockNewNodesData = { merge: [{ id: 'tree2', name: 'Lonely Tree', type: 'flora', longDescription:'A lonely tree', image:'tree2.png' }], delete: [] };
        (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
          llmResult: JSON.stringify(mockNewNodesData),
          callId: 'nodes-prompt-call-id-no-moxus'
        });
  
        await generateNodesFromPrompt(userPromptForNodeGen, mockNodes, undefined, undefined);
  
        expect(formatPrompt).toHaveBeenCalledTimes(1);
        expect(formatPrompt).toHaveBeenCalledWith(
          (loadedPrompts.node_operations as any).generate_nodes_from_prompt,
          expect.objectContaining({
            moxus_context_string: "" // Should be empty if no moxus input
          })
        );
      });

    it('should throw an error if getResponse fails for generateNodesFromPrompt', async () => {
        const mockError = new Error('LLM API Error for generateNodesFromPrompt');
        (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
        await expect(generateNodesFromPrompt(userPromptForNodeGen, mockNodes, moxusMemoryInputForNodeGen, moxusPersonalityForNodeGen)).rejects.toThrow(mockError);
    });
  });

  describe('sortNodesByRelevance', () => {
    const historyForSort: Message[] = [
      {role: 'user', content: 'What should I focus on?'},
      {role: 'moxus', content: '**Moxus Report:** Node2 is important.'},
      {role: 'assistant', content: 'Let me check relevant nodes.'}
    ];

    it('should call formatPrompt with correct replacements, then getResponse', async () => {
      const mockSortedIds = ['2', '1']; // Mock node2 is more relevant
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: JSON.stringify({ sortedIds: mockSortedIds }),
        callId: 'sort-nodes-call-id'
      });

      // Expected replacements
      const expectedStringHistory = 
        `user: What should I focus on?\n` +
        // moxus message filtered out by getLastFiveInteractions
        `assistant: Let me check relevant nodes.\n`;

      const expectedNodesDescription = 
        `\n      id: 1\n      name: Node1\n      longDescription: A descriptive node\n      type: story\n      ` +
        `\n      id: 2\n      name: Node2\n      longDescription: Another node\n      type: character\n      `; // image_generation node (id:3) is filtered out.
      
      const expectedLastMoxusReportSection = `
  ## Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
  Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
  the story and provides VITAL guidance to maintain consistency and quality in the game world.
  ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.
  
  Node2 is important.
  `;

      await sortNodesByRelevance(mockNodes, historyForSort);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).sort_nodes_by_relevance,
        {
          string_history: expectedStringHistory,
          last_moxus_report_section: expectedLastMoxusReportSection,
          nodes_description: expectedNodesDescription
        }
      );
      expect(getResponse).toHaveBeenCalledTimes(1); // Other getResponse assertions remain
    });

    it('should throw an error if getResponse fails for sortNodesByRelevance', async () => {
        const mockError = new Error('LLM API Error for sortNodesByRelevance');
        (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
        await expect(sortNodesByRelevance(mockNodes, historyForSort)).rejects.toThrow(mockError);
    });
  });

  describe('refocusStory', () => {
    const historyForRefocus: Message[] = [
      {role: 'user', content: 'User says something'},
      {role: 'assistant', content: 'Assistant responds'},
      {role: 'system', content: 'System hint - ignored for past_chat_history'},
      {role: 'moxus', content: 'Moxus thoughts - ignored for past_chat_history'}
    ];

    it('should call formatPrompt with correct replacements, then getResponse and return result', async () => {
      const mockRefocusText = "This is the refocused story direction.";
      (getResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
        llmResult: mockRefocusText,
        callId: 'refocus-call-id'
      });

      // Expected replacements
      const expectedPastChatHistory = 
        `user: User says something\n` +
        `assistant: Assistant responds\n`;
      
      const expectedNodesDescription = 
        `\n    ---\n    id: 1\n    name: Node1\n    longDescription: A descriptive node\n    type: story\n    ` +
        `\n    ---\n    id: 2\n    name: Node2\n    longDescription: Another node\n    type: character\n    `; // image_generation node (id:3) is filtered out by the function

      await refocusStory(historyForRefocus, mockNodes);

      expect(formatPrompt).toHaveBeenCalledTimes(1);
      expect(formatPrompt).toHaveBeenCalledWith(
        (loadedPrompts.node_operations as any).refocus_story,
        {
          past_chat_history: expectedPastChatHistory,
          nodes_description: expectedNodesDescription
        }
      );
      expect(getResponse).toHaveBeenCalledTimes(1); // Other getResponse assertions remain
    });

    it('should throw an error if getResponse fails for refocusStory', async () => {
        const mockError = new Error('LLM API Error for refocusStory');
        (getResponse as ReturnType<typeof vi.fn>).mockRejectedValue(mockError);
        await expect(refocusStory(historyForRefocus, mockNodes)).rejects.toThrow(mockError);
    });
  });

  // Add more describe blocks for other functions like generateActions, generateNodeEdition, etc.
}); 