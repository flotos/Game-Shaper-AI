import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import { getResponse, formatPrompt, loadedPrompts } from './llmCore';

// This function was originally in LLMService.ts
function getTypeSpecificPromptAddition(nodeType: string | undefined): string {
  const typeKey = nodeType || 'default';
  // Ensure loadedPrompts and its nested properties are accessed safely
  const additions = loadedPrompts?.image_generation?.type_specific_additions;
  if (additions) {
    return additions[typeKey] || additions['default'] || '';
  }
  return ''; // Fallback if prompts aren't loaded or structured as expected
}

export const generateImagePrompt = async(node: Partial<Node>, allNodes: Node[], chatHistory: Message[] = []) => {
  console.log('LLM Call (ImageGenerationService): Generating image prompt for node:', node.id);
  const imageGenerationNodes = allNodes.filter(n => n.type === "image_generation");
  
  let contentPrompt = "";
  const typeSpecificAddition = getTypeSpecificPromptAddition(node.type);
  const allNodesContext = allNodes.reduce((acc, nodet) => {
    return acc + `
    ---
    name: ${nodet.name}
    rules: ${nodet.rules}
    `;
  }, "");
  const chatHistoryContext = chatHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n');

  if (imageGenerationNodes.length > 0) {
    const imageGenerationNodesContent = imageGenerationNodes.map(n => {
      let prompt = "";
      if (n.longDescription) prompt += n.longDescription + "\n";
      if (n.rules) prompt += n.rules + "\n";
      return prompt;
    }).join("\n");

    contentPrompt = formatPrompt(loadedPrompts.image_generation.base_prompt_with_instructions_node, {
      image_generation_nodes_content: imageGenerationNodesContent,
      node_name: node.name,
      node_long_description: node.longDescription,
      node_rules: node.rules,
      node_type: node.type,
      type_specific_prompt_addition: typeSpecificAddition,
      all_nodes_context: allNodesContext,
      chat_history_context: chatHistoryContext
    });
  } else {
    contentPrompt = formatPrompt(loadedPrompts.image_generation.base_prompt_default, {
      node_name: node.name,
      node_long_description: node.longDescription,
      node_rules: node.rules,
      node_type: node.type,
      type_specific_prompt_addition: typeSpecificAddition,
      all_nodes_context: allNodesContext,
      chat_history_context: chatHistoryContext
    });
  }

  const messages: Message[] = [
    { role: 'system', content: contentPrompt },
  ];

  // Skip Moxus feedback for image prompt generation, as per original logic
  return getResponse(messages, 'gpt-4o', undefined, false, undefined, { skipMoxusFeedback: true });
}; 