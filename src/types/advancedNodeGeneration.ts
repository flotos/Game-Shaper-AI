// Advanced Node Generation Pipeline Types

export interface PlanningStageOutput {
  targetNodeIds: string[];
  deleteNodeIds: string[];
  objectives: string;
  successRules: string[];
  searchQueries: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchResults {
  broad: SearchResult[];
  precise: SearchResult[];
}

export interface ValidationResult {
  validatedRules: string[];
  failedRules: Array<{
    rule: string;
    reason: string;
    nodeId: string;
  }>;
  failedNodeIds: string[];
}

export interface PipelineState {
  // Configuration
  mode: 'automatic' | 'manual';
  maxLoops: number;
  timeout: number; // in milliseconds
  
  // Current state
  currentLoop: number;
  stage: 'planning' | 'searching' | 'generating' | 'validating' | 'completed' | 'failed';
  
  // Stage outputs
  planningOutput?: PlanningStageOutput;
  searchResults?: SearchResults;
  generatedDiffs?: { [nodeId: string]: any }; // Diff format from node_edition prompt
  validationResult?: ValidationResult;
  
  // State tracking
  originalNodes: { [nodeId: string]: any }; // Snapshot of nodes at start
  currentNodeStates: { [nodeId: string]: any }; // Current state including manual edits
  finalAppliedNodes?: { [nodeId: string]: any }; // Final state with all changes applied (for UI preview)
  
  // Error handling
  errors: Array<{
    stage: string;
    loop: number;
    error: string;
    timestamp: Date;
  }>;
  
  // User interactions
  userPrompt: string;
  allNodes: any[]; // All nodes for context
  chatHistory?: any[]; // Chat history for context
}

export interface AdvancedNodeGenerationConfig {
  braveApiKey?: string;
  defaultTimeout: number;
  maxSearchResults: number;
  maxLoops?: number;
  forceLoops?: boolean;
}

// API Response types for Brave Search
export interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title: string;
      url: string;
      description: string;
      age?: string;
      language?: string;
    }>;
  };
  query?: {
    original: string;
    show_strict_warning: boolean;
  };
} 