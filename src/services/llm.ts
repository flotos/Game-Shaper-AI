// Barrel file for LLM-related services

// From imageGenerationLLMService.ts
export { generateImagePrompt } from './imageGenerationLLMService';

// From twineImportLLMService.ts
export {
  extractDataFromTwine,
  generateNodesFromExtractedData,
  regenerateSingleNode,
  generateNodesFromTwine,
  processCompleteStory,
} from './twineImportLLMService';
export type { ExtractedElement, ExtractedData } from './twineImportLLMService'; // Export types if needed by consumers

// From nodeInteractionLLMService.ts
export {
  getRelevantNodes,
  generateChatText,
  generateActions,
  generateNodeEdition,
  generateNodesFromPrompt,
  sortNodesByRelevance,
  generateUserInputResponse,
  refocusStory,
} from './nodeInteractionLLMService';

// It's generally not recommended to export core functionalities like getResponse, formatPrompt, or loadedPrompts directly
// from the barrel file if they are meant for internal use within the LLM services group.
// However, if any of the helper functions from llmCore.ts are needed by UI or other non-LLM services, they could be exported here.
// For example, if getLastFiveInteractions was used by a UI component:
// export { getLastFiveInteractions } from './llmCore';

// Re-establish Moxus feedback mechanism
// This needs to be called once at application startup after all modules are loaded.
import { setMoxusFeedbackImpl } from './MoxusService';
import { getMoxusFeedback } from './llmCore';

if (typeof window !== 'undefined') { // Ensure this only runs in a context where modules are fully loaded (e.g., client-side app)
  console.log('[llm.ts] Setting Moxus feedback implementation.');
  setMoxusFeedbackImpl(getMoxusFeedback);
} 