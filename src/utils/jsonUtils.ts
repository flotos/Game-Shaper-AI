import { jsonrepair } from 'jsonrepair';

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
      // If that fails, try to repair the JSON and parse again
      const repairedJson = jsonrepair(jsonString);
      
      // Log that repair was necessary
      console.log('JSON required repair before parsing');
      
      return JSON.parse(repairedJson);
    } catch (repairError) {
      // If repair also fails, throw with better error message
      const errorMessage = repairError instanceof Error ? repairError.message : String(repairError);
      console.error('Failed to parse JSON even after repair attempt:', errorMessage);
      throw new Error(`Failed to parse JSON: ${errorMessage}`);
    }
  }
} 