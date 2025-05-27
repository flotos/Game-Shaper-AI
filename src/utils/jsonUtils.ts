import { jsonrepair } from 'jsonrepair';

/**
 * Removes markdown code block wrapping from JSON strings
 */
function removeMarkdownWrapping(jsonString: string): string {
  let cleaned = jsonString.trim();
  
  // Handle multiple variations of markdown code blocks
  const patterns = [
    /^```json\s*\n?/i,
    /^```JSON\s*\n?/i,
    /^```\s*json\s*\n?/i,
    /^```\s*\n?/
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '');
      break;
    }
  }
  
  // Remove trailing code block markers more aggressively
  // Look for ``` followed by any content (including newlines) until end of string
  const endPatterns = [
    /\n```[\s\S]*$/,
    /```[\s\S]*$/
  ];
  
  for (const pattern of endPatterns) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '');
      break;
    }
  }
  
  return cleaned.trim();
}

/**
 * Fixes unquoted property names in JSON strings
 */
function fixUnquotedPropertyNames(jsonString: string): string {
  // Match unquoted property names (word characters followed by colon)
  // This regex looks for word characters that aren't already quoted, followed by a colon
  return jsonString.replace(/(\s*)"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*:/g, (match, leading, propName) => {
    // Only quote if not already quoted
    if (match.includes('"' + propName + '"')) {
      return match; // Already quoted
    }
    return leading + '"' + propName + '":';
  });
}

/**
 * Extracts the first complete JSON object from a string that might contain trailing content
 */
function extractFirstCompleteJson(jsonString: string): string {
  let processed = jsonString.trim();
  
  // Find the first opening brace or bracket
  const firstBrace = processed.indexOf('{');
  const firstBracket = processed.indexOf('[');
  
  let startIndex = -1;
  let isObject = true;
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    isObject = false;
  }
  
  if (startIndex === -1) {
    return processed; // No JSON structure found
  }
  
  // Track braces/brackets to find the end of the JSON
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = startIndex; i < processed.length; i++) {
    const char = processed[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) {
      continue;
    }
    
    if ((isObject && char === '{') || (!isObject && char === '[')) {
      depth++;
    } else if ((isObject && char === '}') || (!isObject && char === ']')) {
      depth--;
      
      if (depth === 0) {
        // Found the end of the JSON object/array
        return processed.substring(startIndex, i + 1);
      }
    }
  }
  
  // If we didn't find a complete JSON, return the original
  return processed;
}

/**
 * Normalizes non-ASCII quotation marks to standard ASCII double quotes
 */
function normalizeQuotationMarks(jsonString: string): string {
  return jsonString
    // German quotation marks
    .replace(/„/g, '"')
    .replace(/"/g, '"')
    // French quotation marks
    .replace(/«/g, '"')
    .replace(/»/g, '"')
    // English curved quotes
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    // Single quotes that might be misused
    .replace(/'/g, '"')
    .replace(/'/g, '"')
    // Other common unicode quote variants
    .replace(/‚/g, '"')
    .replace(/'/g, '"')
    .replace(/‛/g, '"');
}

/**
 * Pre-processes common LLM JSON errors before attempting repair
 */
function preProcessBrokenJson(jsonString: string): string {
  // First remove markdown wrapping
  let processed = removeMarkdownWrapping(jsonString);
  
  // Normalize non-ASCII quotation marks to standard ASCII quotes
  processed = normalizeQuotationMarks(processed);
  
  // Try to extract just the JSON part if there's trailing content
  processed = extractFirstCompleteJson(processed);
  
  // Fix unquoted property names
  processed = fixUnquotedPropertyNames(processed);
  
  // Remove any trailing commas in objects and arrays
  processed = processed.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix empty key-value pairs like "" or ",,"
  processed = processed.replace(/""\s*,/g, '');
  processed = processed.replace(/,\s*""\s*}/g, '}');
  processed = processed.replace(/""\s*}/g, '}');
  
  // Fix incomplete property assignments with missing values
  processed = processed.replace(/"([^"]+)":\s*,/g, '"$1": null,');
  processed = processed.replace(/"([^"]+)":\s*$/g, '"$1": null');
  processed = processed.replace(/"([^"]+)":\s*$/gm, '"$1": null');
  
  // Fix empty properties in objects
  processed = processed.replace(/":\s*"",?/g, '": null,');
  
  // Fix missing quotes around string values that clearly should be strings
  processed = processed.replace(/"([^"]+)":\s*([^",}\]\s][^",}\]]*[^",}\]\s])\s*([,}\]])/g, (match, key, value, terminator) => {
    if (/^(true|false|null|\d+\.?\d*)$/.test(value.trim())) {
      return match;
    }
    if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
      return match;
    }
    return '"' + key + '": "' + value.trim() + '"' + terminator;
  });
  
  // Fix incomplete nested objects that might be cut off
  processed = processed.replace(/("([^"]+)":\s*{[^}]*?)$/g, (match, prefix) => {
    // If we have an opening brace but no closing, add a closing brace
    if ((prefix.match(/{/g) || []).length > (prefix.match(/}/g) || []).length) {
      return prefix + '}';
    }
    return match;
  });
  
  // Handle truncated strings that end abruptly
  processed = processed.replace(/("([^"]+)":\s*"[^"]*?)$/g, (match, prefix) => {
    // If we have an incomplete string value, close it
    if (!prefix.endsWith('"')) {
      return prefix + '"';
    }
    return match;
  });
  
  // Fix objects that end with just a property name and colon (common truncation)
  processed = processed.replace(/("([^"]+)":\s*)$/g, '"$2": null');
  
  // Fix objects that end abruptly with a comma
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
  if (!jsonString || typeof jsonString !== 'string') {
    throw new Error('Invalid input: jsonString must be a non-empty string');
  }
  
  try {
    // First try standard JSON.parse
    return JSON.parse(jsonString);
  } catch (initialError) {
    console.warn('Initial JSON parse failed, attempting repair...', initialError instanceof Error ? initialError.message : String(initialError));
    
    try {
      // Pre-process common LLM JSON errors
      const preprocessedJson = preProcessBrokenJson(jsonString);
      
      try {
        // Try parsing after pre-processing
        console.log('JSON successfully repaired with preprocessing');
        return JSON.parse(preprocessedJson);
      } catch (preProcessError) {
        // If that fails, try to repair the JSON using jsonrepair
        console.warn('Preprocessing failed, attempting jsonrepair...', preProcessError instanceof Error ? preProcessError.message : String(preProcessError));
        
        try {
          const repairedJson = jsonrepair(preprocessedJson);
          
          console.log('JSON required jsonrepair library for successful parsing');
          return JSON.parse(repairedJson);
        } catch (jsonrepairError) {
          // If jsonrepair also fails, try one more approach for the specific case of unescaped newlines
          console.warn('jsonrepair failed, attempting manual newline escape...', jsonrepairError instanceof Error ? jsonrepairError.message : String(jsonrepairError));
          
          // Try a simple fix for unescaped newlines in string values
          const newlineFixed = preprocessedJson.replace(/("(?:[^"\\]|\\.)*")|(\n)/g, (match, quotedString, newline) => {
            if (quotedString) {
              // This is a quoted string, don't modify it
              return quotedString;
            } else if (newline) {
              // This is an unescaped newline outside of quotes, escape it
              return '\\n';
            }
            return match;
          });
          
          try {
            console.log('JSON successfully repaired with manual newline escaping');
            return JSON.parse(newlineFixed);
          } catch (finalError) {
            // If even this fails, try jsonrepair on the newline-fixed version
            const finalRepairedJson = jsonrepair(newlineFixed);
            console.log('JSON required both manual newline escaping and jsonrepair');
            return JSON.parse(finalRepairedJson);
          }
        }
      }
    } catch (repairError) {
      // If repair also fails, provide comprehensive error information
      const errorMessage = repairError instanceof Error ? repairError.message : String(repairError);
      console.error('Failed to parse JSON even after repair attempt:', errorMessage);
      
      // Log more context for debugging
      const truncatedOriginal = jsonString.length > 100000 ? jsonString.substring(0, 100000) + '...[truncated]' : jsonString;
      console.error('Original JSON (first 100000 chars):', truncatedOriginal);
      
      // Try to identify the error position if available
      const positionMatch = errorMessage.match(/position (\d+)/i);
      if (positionMatch) {
        const position = parseInt(positionMatch[1]);
        const contextStart = Math.max(0, position - 50);
        const contextEnd = Math.min(jsonString.length, position + 50);
        const context = jsonString.substring(contextStart, contextEnd);
        console.error(`Context around error position ${position}:`, context);
      }
      
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