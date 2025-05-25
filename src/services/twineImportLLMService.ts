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
  extractedData: ExtractedElement[],
  nodes: Node[],
  additionalInstructions: string = '',
  mode: 'new_game' | 'merge' = 'new_game'
): Promise<any> => {
  const MAX_PROMPT_SIZE = 200000;
  const nodesDescription = nodes.slice(0, 200).map(node => {
    const description = `${node.id}: ${node.name} - ${node.longDescription}`.substring(0, 500);
    return description;
  }).join('\n');

  const formatExtractedData = (data: ExtractedElement[]): string => {
    return data.map(element => `${element.type}: ${element.name}\n${element.content}`).join('\n\n');
  };

  const extractedDataString = formatExtractedData(extractedData);
  const extractedDataInfo = `${extractedData.length} elements extracted from story`;

  console.log('[TwineImportService] generateNodesFromExtractedData starting with:', {
    mode,
    extractedDataLength: extractedData.length,
    nodesCount: nodes.length,
    extractedDataInfo
  });

  const templateKey = mode === 'new_game' ? 'node_generation_new_game' : 'node_generation_merge';
  const promptTemplate = loadedPrompts.twine_import[templateKey];

  let fullPrompt = formatPrompt(promptTemplate, {
    additional_instructions: additionalInstructions,
    extracted_data: extractedDataString,
    nodes_description: nodesDescription
  });

  if (fullPrompt.length > MAX_PROMPT_SIZE) {
    const limitedData = extractedData.slice(0, Math.floor(extractedData.length * 0.7));
    const limitedDataString = formatExtractedData(limitedData);
    fullPrompt = formatPrompt(promptTemplate, {
      additional_instructions: additionalInstructions,
      extracted_data: limitedDataString,
      nodes_description: nodesDescription
    });
    console.log('[TwineImportService] Trimmed prompt due to size constraints');
  }

  const messages: Message[] = [{ role: 'system', content: fullPrompt }];
  
  let response: any;
  try {
    response = await getResponse(messages, "gpt-4o", undefined, false, { type: 'json_object' }, undefined, 'node_generation');
  } catch (error) {
    console.error('[TwineImportService] generateNodesFromExtractedData: getResponse failed.', error);
    throw error;
  }
  
  try {
    const jsonString = typeof response === 'string' ? response : (response as any).llmResult;
    const cleanedJsonString = jsonString.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    const parsedFromJson = safeJsonParse(cleanedJsonString);
    
    if (!parsedFromJson.n_nodes || !Array.isArray(parsedFromJson.n_nodes)) {
      throw new Error('Invalid response structure: missing or invalid n_nodes array');
    }
    
    const result: any = {};
    
    result.new = parsedFromJson.n_nodes;
    
    if (mode === 'new_game') {
      result.delete = nodes.map(node => node.id);
    }
    
    return result;
  } catch (error) {
    console.error('[TwineImportService] Error parsing JSON response:', error);
    throw new Error(`Failed to parse JSON response: ${error}`);
  }
};

export const regenerateSingleNode = async (
  nodeId: string,
  nodes: Node[],
  extractedData: ExtractedElement[],
  nodeGenerationInstructions: string,
  recentlyGeneratedNodeDetails: string
): Promise<any> => {
  const existingNode = nodes.find(n => n.id === nodeId);
  if (!existingNode) {
    throw new Error(`Node with id ${nodeId} not found`);
  }

  const MAX_PROMPT_SIZE = 150000;
  const nodesDescription = nodes.slice(0, 150).map(node => {
    const description = `${node.id}: ${node.name} - ${node.longDescription}`.substring(0, 500);
    return description;
  }).join('\n');

  const formatExtractedData = (data: ExtractedElement[]): string => {
    return data.map(element => `${element.type}: ${element.name}\n${element.content}`).join('\n\n');
  };

  const extractedDataString = formatExtractedData(extractedData);

  const promptTemplate = loadedPrompts.twine_import.regenerate_single_node;

  let fullPrompt = formatPrompt(promptTemplate, {
    node_generation_instructions: nodeGenerationInstructions,
    existing_node_id: existingNode.id,
    existing_node_name: existingNode.name,
    existing_node_long_description: existingNode.longDescription,
    existing_node_type: existingNode.type,
    recently_generated_node_details: recentlyGeneratedNodeDetails,
    extracted_data: extractedDataString,
    nodes_description: nodesDescription
  });

  if (fullPrompt.length > MAX_PROMPT_SIZE) {
    const limitedData = extractedData.slice(0, Math.floor(extractedData.length * 0.7));
    const limitedDataString = formatExtractedData(limitedData);
    fullPrompt = formatPrompt(promptTemplate, {
      node_generation_instructions: nodeGenerationInstructions,
      existing_node_id: existingNode.id,
      existing_node_name: existingNode.name,
      existing_node_long_description: existingNode.longDescription,
      existing_node_type: existingNode.type,
      recently_generated_node_details: recentlyGeneratedNodeDetails,
      extracted_data: limitedDataString,
      nodes_description: nodesDescription
    });
    console.log('[TwineImportService] Trimmed prompt due to size constraints');
  }

  const messages: Message[] = [{ role: 'system', content: fullPrompt }];
  
  let response: any;
  try {
    response = await getResponse(messages, "gpt-4o", undefined, false, { type: 'json_object' }, undefined, 'single_node_regeneration');
  } catch (error) {
    console.error('[TwineImportService] regenerateSingleNode: getResponse failed.', error);
    throw error;
  }
  
  try {
    const jsonString = typeof response === 'string' ? response : (response as any).llmResult;
    const cleanedJsonString = jsonString.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    const parsedFromJson = safeJsonParse(cleanedJsonString);
    
    if ((!parsedFromJson.n_nodes || !Array.isArray(parsedFromJson.n_nodes)) && 
        (!parsedFromJson.u_nodes || typeof parsedFromJson.u_nodes !== 'object')) {
      throw new Error('Invalid response structure: missing or invalid n_nodes array or u_nodes object');
    }
    
    let updatedNodeData = parsedFromJson.n_nodes?.find((n: Partial<Node>) => n.id === nodeId);
    
    if (!updatedNodeData && parsedFromJson.u_nodes && nodeId in parsedFromJson.u_nodes) {
      const existingNodeData = existingNode;
      const updates = parsedFromJson.u_nodes[nodeId];
      
      updatedNodeData = { ...existingNodeData };
      
      for (const [field, operation] of Object.entries(updates)) {
        if (field === 'img_upd') {
          updatedNodeData.updateImage = operation as boolean;
          continue;
        }
        
        if (typeof operation === 'object' && operation !== null) {
          if ('rpl' in operation) {
            (updatedNodeData as any)[field] = operation.rpl;
          }
        }
      }
    }
    
    if (!updatedNodeData) {
      throw new Error(`No valid node data found for node ${nodeId} in the response`);
    }
    
    return updatedNodeData;
  } catch (error) {
    console.error('[TwineImportService] Error parsing JSON response:', error);
    throw new Error(`Failed to parse JSON response: ${error}`);
  }
};

export const generateNodesFromTwine = async (
  content: string,
  nodes: Node[],
  mode: 'new_game' | 'merge_story' = 'new_game',
  dataExtractionInstructions: string = '',
  nodeGenerationInstructions: string = '',
  extractionCount: number = 3
): Promise<any> => {
  const extractedData = await extractDataFromTwine(content, dataExtractionInstructions, extractionCount);
  const flattenedData = extractedData.chunks.flat();
  
  // Convert mode to match generateNodesFromExtractedData parameter
  const adjustedMode = mode === 'merge_story' ? 'merge' : mode;
  
  return generateNodesFromExtractedData(flattenedData, nodes, nodeGenerationInstructions, adjustedMode);
};

export const processCompleteStory = async (
  content: string,
  nodes: Node[],
  mode: 'new_game' | 'merge' = 'new_game',
  nodeGenerationInstructions: string = '',
  dataExtractionInstructions: string = '',
  extractionCount: number = 3
): Promise<any> => {
  const extractedData = await extractDataFromTwine(content, dataExtractionInstructions, extractionCount);
  const flattenedData = extractedData.chunks.flat();
  return generateNodesFromExtractedData(flattenedData, nodes, nodeGenerationInstructions, mode);
}; 