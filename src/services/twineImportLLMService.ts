import { Node } from '../models/Node';
import { Message } from '../context/ChatContext'; // Message may not be directly used, but good for consistency if types evolve
import { getResponse, formatPrompt, loadedPrompts } from './llmCore';
import { safeJsonParse } from '../utils/jsonUtils';

// Interfaces specific to Twine data extraction
export interface ExtractedElement {
  type: string;
  name: string;
  content: string;
}

export interface ExtractedData {
  chunks: ExtractedElement[][];
  failedChunks?: number; // Optional: if you want to track this from extractDataFromTwine
}

export const extractDataFromTwine = async (
  content: string,
  dataExtractionInstructions?: string,
  extractionCount: number = 1,
  onProgress?: (completed: number) => void
): Promise<ExtractedData> => {
  console.log('LLM Call (TwineImportService): Extracting data from Twine content');
  
  const totalLength = content.length;
  const chunkSize = Math.ceil(totalLength / extractionCount);
  const chunks: string[] = [];
  
  for (let i = 0; i < extractionCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalLength);
    chunks.push(content.slice(start, end));
  }

  const processChunk = async (chunk: string, index: number, retryCount: number = 0): Promise<ExtractedElement[]> => {
    const extractionPrompt = formatPrompt(loadedPrompts.twine_import.data_extraction, {
      additional_instructions: dataExtractionInstructions || '',
      twine_content: chunk
    });

    const extractionMessagesInternal: Message[] = [
      { role: 'system', content: extractionPrompt },
    ];

    try {
      const result = await getResponse(extractionMessagesInternal, 'gpt-4o', undefined, false, { type: 'json_object' });
      const parsedResult = typeof result === 'string' ? safeJsonParse(result) : result;
      
      if (!parsedResult.elements || !Array.isArray(parsedResult.elements)) {
        throw new Error('Invalid response structure: missing or invalid elements array');
      }

      if (onProgress) {
        onProgress(index + 1);
      }

      return parsedResult.elements;
    } catch (error) {
      console.error(`Error processing chunk ${index + 1}:`, error);
      if (retryCount === 0) {
        console.log(`Retrying chunk ${index + 1}...`);
        return processChunk(chunk, index, retryCount + 1);
      }
      console.error(`Failed to process chunk ${index + 1} after retry:`, error);
      return [];
    }
  };

  const extractionResults = await Promise.all(
    chunks.map((chunk, index) => processChunk(chunk, index))
  );

  const failedChunksCount = extractionResults.filter(result => result.length === 0).length;
  
  const combinedExtractedData: ExtractedData = {
    chunks: extractionResults,
    failedChunks: failedChunksCount
  };

  if (failedChunksCount > 0) {
    console.warn(`${failedChunksCount} out of ${extractionCount} chunks failed to process. The extraction will continue with the successful chunks.`);
  }

  return combinedExtractedData;
};

export const generateNodesFromExtractedData = async (
  extractedData: ExtractedData,
  nodes: Node[],
  mode: 'new_game' | 'merge_story',
  nodeGenerationInstructions?: string
): Promise<any> => { // Consider defining a more specific return type than any
  console.log('LLM Call (TwineImportService): Generating nodes from extracted data in mode:', mode);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "system") return acc;
    return acc + `\n    id: ${node.id}\n    name: ${node.name}\n    longDescription: ${node.longDescription}\n    type: ${node.type}\n    `;
  }, "");

  const promptTemplateKey = mode === 'new_game' ? 
    loadedPrompts.twine_import.node_generation_new_game : 
    loadedPrompts.twine_import.node_generation_merge;

  const generationPrompt = formatPrompt(promptTemplateKey, {
    additional_instructions: nodeGenerationInstructions || '',
    extracted_data: JSON.stringify(extractedData.chunks, null, 2), // Assuming we only need chunks here
    nodes_description: nodesDescription
  });

  const generationMessagesInternal: Message[] = [
    { role: 'system', content: generationPrompt },
  ];

  const response = await getResponse(generationMessagesInternal, 'gpt-4o', undefined, false, { type: 'json_object' });
  
  try {
    const parsedResponse = typeof response === 'string' ? safeJsonParse(response) : response;
    if (!parsedResponse.new || !Array.isArray(parsedResponse.new)) {
      throw new Error('Invalid response structure: missing or invalid new array');
    }
    if (mode === 'new_game') {
      parsedResponse.delete = nodes.map(node => node.id);
    } else if (mode === 'merge_story') {
      if (!parsedResponse.update || !Array.isArray(parsedResponse.update)) {
        throw new Error('Invalid response structure: missing or invalid update array in merge mode');
      }
      if (!parsedResponse.delete) parsedResponse.delete = [];
      if (parsedResponse.update) {
        const existingNodeIds = new Set(nodes.map(node => node.id));
        const validUpdates: any[] = [];
        const newNodesFromUpdate = [...parsedResponse.new]; // Start with new nodes from LLM
        for (const update of parsedResponse.update) {
          if (existingNodeIds.has(update.id)) {
            validUpdates.push(update);
          } else {
            const existingNode = nodes.find(n => n.id === update.id);
            if (existingNode) newNodesFromUpdate.push({ ...existingNode, ...update });
          }
        }
        parsedResponse.update = validUpdates;
        parsedResponse.new = newNodesFromUpdate;
      }
    }
    parsedResponse.new.forEach((node: any) => {
      node.updateImage = node.updateImage ?? false;
      const missingFields: string[] = [];
      if (!node.id) missingFields.push('id');
      if (!node.name) missingFields.push('name');
      if (!node.longDescription) missingFields.push('longDescription');
      if (!node.type) missingFields.push('type');
      if (missingFields.length > 0) {
        throw new Error(`Invalid node structure: missing required fields in node ${node.id || 'unknown'}: ${missingFields.join(', ')}`);
      }
    });
    if (parsedResponse.update) {
      parsedResponse.update.forEach((node: any) => {
        node.updateImage = node.updateImage ?? false;
        if (!node.id) throw new Error('Invalid update node: missing id field');
        if (!node.longDescription && node.updateImage === undefined) {
          throw new Error(`Invalid update node ${node.id}: must have at least one of longDescription, or updateImage`);
        }
      });
    }
    return parsedResponse;
  } catch (error) {
    console.error('Error parsing Twine import response:', error, 'Response content:', response);
    throw new Error('Failed to parse Twine import response as JSON.');
  }
};

export const regenerateSingleNode = async (
  nodeId: string,
  existingNode: Partial<Node>,
  extractedData: ExtractedData, // Use the full ExtractedData for context
  nodes: Node[],
  _mode: 'new_game' | 'merge_story', // mode might not be strictly necessary here but kept for consistency
  nodeGenerationInstructions?: string,
  recentlyGeneratedNode?: Partial<Node>
): Promise<Partial<Node>> => { // Return type could be more specific
  console.log('LLM Call (TwineImportService): Regenerating single node:', nodeId);
  
  const nodesDescription = nodes.reduce((acc, node) => {
    if (node.type === "system") return acc;
    return acc + `\n    -\n    id: ${node.id}\n    name: ${node.name}\n    longDescription: ${node.longDescription}\n    type: ${node.type}\n    `;
  }, "");

  const recentlyGeneratedNodeDetails = recentlyGeneratedNode ? 
    `id: ${recentlyGeneratedNode.id}\nname: ${recentlyGeneratedNode.name}\nlongDescription: ${recentlyGeneratedNode.longDescription}\ntype: ${recentlyGeneratedNode.type}`
    : 'No recently generated node provided';

  const focusedPrompt = formatPrompt(loadedPrompts.twine_import.regenerate_single_node, {
    node_generation_instructions: nodeGenerationInstructions || '',
    existing_node_id: existingNode.id || '',
    existing_node_name: existingNode.name || '',
    existing_node_long_description: existingNode.longDescription || '',
    existing_node_type: existingNode.type || '',
    recently_generated_node_details: recentlyGeneratedNodeDetails,
    extracted_data: JSON.stringify(extractedData.chunks, null, 2), // Use chunks for prompt
    nodes_description: nodesDescription,
    node_id_to_regenerate: nodeId
  });

  const messagesInternal: Message[] = [
    { role: 'system', content: focusedPrompt },
  ];

  const response = await getResponse(messagesInternal, 'gpt-4o', undefined, false, { type: 'json_object' });
  
  try {
    // Handle response wrapped in llmResult
    let parsedResponse;
    if (typeof response === 'object' && response !== null && 'llmResult' in response && typeof response.llmResult === 'string') {
      parsedResponse = safeJsonParse(response.llmResult);
    } else {
      parsedResponse = typeof response === 'string' ? safeJsonParse(response) : response;
    }
    
    if ((!parsedResponse.new || !Array.isArray(parsedResponse.new)) && 
        (!parsedResponse.update || !Array.isArray(parsedResponse.update))) {
      throw new Error('Invalid response structure: missing or invalid arrays');
    }
    const updatedNodeData = parsedResponse.new?.find((n: Partial<Node>) => n.id === nodeId) || 
                           parsedResponse.update?.find((n: { id: string; }) => n.id === nodeId);
    if (!updatedNodeData) throw new Error('Node not found in response');
    
    updatedNodeData.updateImage = updatedNodeData.updateImage ?? false;
    
    return updatedNodeData;
  } catch (error) {
    console.error('Error parsing node regeneration response:', error, 'Response content:', response);
    throw new Error('Failed to parse node regeneration response as JSON');
  }
};

export const generateNodesFromTwine = async (
  content: string,
  nodes: Node[],
  mode: 'new_game' | 'merge_story',
  dataExtractionInstructions?: string,
  nodeGenerationInstructions?: string,
  extractionCount: number = 1
): Promise<any> => { // Consider a specific return type
  const extractedData = await extractDataFromTwine(content, dataExtractionInstructions, extractionCount);
  // Pass the full extractedData object, including failedChunks if present
  return generateNodesFromExtractedData(extractedData, nodes, mode, nodeGenerationInstructions);
}; 