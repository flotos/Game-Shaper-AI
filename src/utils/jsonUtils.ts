import { jsonrepair } from 'jsonrepair';

/**
 * Pre-processes common LLM JSON errors before attempting repair
 */
function preProcessBrokenJson(jsonString: string): string {
  // Remove any trailing commas in objects and arrays
  let processed = jsonString.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix empty key-value pairs like "" or ",,"
  processed = processed.replace(/""\s*,/g, '');
  processed = processed.replace(/,\s*""\s*}/g, '}');
  processed = processed.replace(/""\s*}/g, '}');
  
  // Fix incomplete property assignments with missing values
  processed = processed.replace(/"([^"]+)":\s*,/g, '"$1": null,');
  processed = processed.replace(/"([^"]+)":\s*$/g, '"$1": null');
  
  // Fix empty properties in objects
  processed = processed.replace(/":\s*"",?/g, '": null,');
  
  // Fix objects that end abruptly
  if (processed.trim().endsWith(',')) {
    processed = processed.trim().slice(0, -1);
  }

  // Fix objects that start JSON but end abruptly
  const openBraces = (processed.match(/{/g) || []).length;
  const closeBraces = (processed.match(/}/g) || []).length;
  if (openBraces > closeBraces) {
    processed += '}'.repeat(openBraces - closeBraces);
  }

  // Same for arrays
  const openBrackets = (processed.match(/\[/g) || []).length;
  const closeBrackets = (processed.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    processed += ']'.repeat(openBrackets - closeBrackets);
  }

  return processed;
}

/**
 * Safely parses a JSON string, attempting to repair the JSON if the initial parse fails.
 * @param jsonString The JSON string to parse
 * @returns The parsed JSON object
 * @throws Error if the JSON cannot be parsed even after repair attempt
 */
export function safeJsonParse(jsonString: string): any {
  try {
    // First try standard JSON.parse
    return JSON.parse(jsonString);
  } catch (initialError) {
    try {
      // Pre-process common LLM JSON errors
      const preprocessedJson = preProcessBrokenJson(jsonString);
      
      try {
        // Try parsing after pre-processing
        return JSON.parse(preprocessedJson);
      } catch (preProcessError) {
        // If that fails, try to repair the JSON using jsonrepair
        const repairedJson = jsonrepair(preprocessedJson);
        
        // Log that repair was necessary
        console.log('JSON required repair before parsing');
        
        return JSON.parse(repairedJson);
      }
    } catch (repairError) {
      // If repair also fails, throw with better error message
      const errorMessage = repairError instanceof Error ? repairError.message : String(repairError);
      console.error('Failed to parse JSON even after repair attempt:', errorMessage);
      
      // Log the problematic JSON for debugging
      console.error('Original JSON:', JSON.stringify(jsonString.substring(0, 100) + '...'));
      
      throw new Error(`Failed to parse JSON: ${errorMessage}`);
    }
  }
}

/**
 * Specialized parser for the node operation responses with merge/delete structure
 * This handles the specific format used in generateNodesFromPrompt
 */
export function parseNodeOperationJson(jsonString: string): any {
  try {
    return safeJsonParse(jsonString);
  } catch (error) {
    // Handle the specific case where we have a merge array but broken structure
    if (jsonString.includes('"merge"')) {
      try {
        // Extract all objects in the merge array
        const mergeRegex = /"merge"\s*:\s*\[([\s\S]*?)\]/;
        const mergeMatch = mergeRegex.exec(jsonString);
        
        if (mergeMatch && mergeMatch[1]) {
          // Extract all objects within the merge array
          let objectsText = mergeMatch[1];
          const objects = [];
          let depth = 0;
          let startIndex = -1;
          
          // Parse objects manually by tracking braces
          for (let i = 0; i < objectsText.length; i++) {
            if (objectsText[i] === '{') {
              if (depth === 0) startIndex = i;
              depth++;
            } else if (objectsText[i] === '}') {
              depth--;
              
              if (depth === 0 && startIndex !== -1) {
                const objectText = objectsText.substring(startIndex, i + 1);
                try {
                  // Try to parse each object individually
                  const obj = safeJsonParse(objectText);
                  objects.push(obj);
                } catch (objError) {
                  console.warn('Could not parse object:', objectText);
                }
                startIndex = -1;
              }
            }
          }
          
          console.log(`Manually extracted ${objects.length} objects from broken JSON`);
          return { merge: objects, delete: [] };
        }
      } catch (specialError) {
        console.error('Failed during specialized JSON parsing:', specialError);
      }
    }
    
    // If we reach here, both normal and specialized parsing failed
    throw error;
  }
} 