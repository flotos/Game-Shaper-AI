# Advanced Node Generation System Specification

## Overview
The Advanced Node Generation System is a sophisticated multi-stage pipeline that enhances the standard node generation process with web search integration, iterative refinement, and validation mechanisms. It replaces the standard single-call node generation with a comprehensive 4-stage process designed to produce higher quality, research-informed game content.

## Core Architecture

### Pipeline Stages
The system operates through a sequential 4-stage pipeline:

1. **Planning Stage**: Analyzes user requests and defines objectives
2. **Web Search Stage**: Gathers external inspiration and examples
3. **Content Generation Stage**: Creates or updates nodes using all available context
4. **Validation Stage**: Verifies success criteria and enables iterative improvement

### Pipeline State Management
```typescript
interface PipelineState {
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
  generatedDiffs?: { [nodeId: string]: any };
  validationResult?: ValidationResult;
  
  // State tracking
  originalNodes: { [nodeId: string]: any };
  currentNodeStates: { [nodeId: string]: any };
  
  // Error handling
  errors: Array<{
    stage: string;
    loop: number;
    error: string;
    timestamp: Date;
  }>;
}
```

## Stage 1: Planning

### Purpose
Analyzes the user request and game context to create a structured plan for node generation or modification.

### Inputs
- All current nodes in the game
- Complete chat history
- User prompt/request
- Optional Moxus context

### Process
- Uses specialized `advanced_nodes_generation.planning` prompt
- LLM analyzes current game state and user request
- Identifies target nodes for modification or creation
- Defines concrete, measurable success criteria
- Generates two distinct web search queries

### Output Structure
```typescript
interface PlanningStageOutput {
  targetNodeIds: string[];      // Mix of existing node IDs and "NEW_NODE_descriptiveName" for new nodes
  objectives: string;           // Paragraph describing update goals
  successRules: string[];       // Boolean-testable validation criteria
  searchQueries: string[];      // Exactly 2 queries: [broad, precise]
}
```

### Example Output
```json
{
  "targetNodeIds": ["char_001", "NEW_NODE_magicalArtifact"],
  "objectives": "Enhance the merchant character with quest-giving capabilities and create a new magical artifact for trade",
  "successRules": [
    "Merchant node contains minimum 2 new quest hooks",
    "New artifact node has unique magical properties not found in existing items",
    "Content doesn't overlap with existing characters or items"
  ],
  "searchQueries": [
    "RPG merchant NPC quest design examples",
    "Fantasy magical artifact properties D&D"
  ]
}
```

### Validation
- Ensures exactly 2 search queries are provided
- Validates target node ID format (existing IDs or NEW_NODE_descriptiveName pattern)
- Confirms success rules are concrete and testable
- Verifies JSON structure integrity

## Stage 2: Web Search

### Purpose
Gathers external inspiration and examples to inform content generation.

### Process
- Executes dual queries via Brave Search API
- Implements rate limiting (1-second delay between searches)
- Handles search failures gracefully (continues with empty results)
- Extracts title, URL, and description from search results

### Search Strategy
- **Broad Query**: General conceptual inspiration (e.g., "RPG character development")
- **Precise Query**: Specific implementation examples (e.g., "Witcher 3 companion quests")

### Output Structure
```typescript
interface SearchResults {
  broad: SearchResult[];
  precise: SearchResult[];
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
}
```

### Configuration
- Maximum results per query: 5 (configurable)
- API timeout and error handling
- Development proxy vs production endpoint routing

## Stage 3: Content Generation

### Purpose
Creates new nodes or updates existing nodes using all available context including search results.

### Process
- Processes each target node individually
- Uses `advanced_nodes_generation.node_edition` prompt
- Incorporates search results, objectives, and success rules
- Applies previous failure feedback for iterative improvement
- Supports both new node creation and existing node updates

### Inputs Per Node
- Original node content (or empty for new nodes)
- Both search result sets with queries
- Full chat history
- Planning objectives and success rules
- Previous validation failures (if in loop > 1)

### Output Format
Uses the existing diff format for consistency:

**New Nodes:**
```json
{
  "n_nodes": [
    {
      "id": "descriptive-permanent-id",
      "name": "Node Name",
      "longDescription": "Complete detailed description...",
      "type": "character",
      "updateImage": true
    }
  ]
}
```

**Existing Node Updates:**
```json
{
  "u_nodes": {
    "existing-node-id": {
      "longDescription": {
        "df": [
          {
            "prev_txt": "old text fragment",
            "next_txt": "new text replacement",
            "occ": 1
          }
        ]
      },
      "img_upd": true
    }
  }
}
```

### Key Features
- **NEW_NODE_descriptiveName Replacement**: Converts placeholder IDs to permanent descriptive IDs
- **Context Integration**: Weaves search results naturally into node content
- **Failure Recovery**: Addresses specific validation failures from previous loops
- **Quality Control**: Higher temperature (0.8) for creative content generation

## Stage 4: Validation

### Purpose
Objectively evaluates generated content against predefined success criteria.

### Process
- Uses `advanced_nodes_generation.validation` prompt
- Compares edited nodes against original success rules
- Provides specific failure reasons and affected node IDs
- Enables automatic loop control and improvement cycles

### Inputs
- All current nodes for context
- Generated node diffs applied to create final states
- Original success rules from planning stage
- Chat history for context

### Output Structure
```typescript
interface ValidationResult {
  validatedRules: string[];     // Successfully met rules
  failedRules: Array<{         // Unmet rules with details
    rule: string;              // Exact rule text
    reason: string;            // Specific failure explanation
    nodeId: string;            // Which node failed
  }>;
  failedNodeIds: string[];     // All nodes with unmet rules
}
```

### Validation Criteria
- **Boolean Testing**: Each rule must be objectively verifiable
- **Quantifiable Metrics**: Specific counts, comparisons, or presence checks
- **Cross-Node Validation**: Detects overlaps and conflicts between nodes
- **Implementation Verification**: Ensures diffs will apply correctly

## Loop Control and Iteration

### Automatic Mode
- Continues looping until all success rules pass OR maximum loops reached
- Default maximum: 3 loops (configurable)
- Each loop uses validation failures to improve subsequent generation
- Automatic progression without user intervention

### Manual Mode
- Pauses after each generation for user review
- "Run Next Loop" button available when validation fails
- User can edit nodes manually between loops
- Manual edits preserved in subsequent iterations

### Termination Conditions
1. **Success**: All validation rules pass
2. **Maximum Loops**: 3 loops completed regardless of validation state
3. **Critical Error**: Unrecoverable failure in any stage
4. **User Cancellation**: Manual termination by user
5. **Timeout**: 10-minute pipeline timeout (configurable via `VITE_ADVANCED_NODE_TIMEOUT`)

## User Interface Integration

### Assistant Overlay Enhancements
- **Advanced Mode Toggle**: Checkbox to enable/disable advanced pipeline
- **Pipeline State Panel**: Real-time progress indicator showing current stage
- **Loop Counter**: Displays current loop vs maximum loops
- **Progress Bar**: Visual representation of pipeline completion

### Control Elements
```typescript
interface AdvancedControls {
  advancedModeToggle: boolean;        // Enable/disable advanced pipeline
  runNextLoopButton: boolean;         // Manual loop progression
  cancelButton: boolean;              // Terminate pipeline
  progressIndicator: PipelineStage;   // Current stage display
}
```

### Progress Visualization
- **Planning**: 25% complete
- **Searching**: 50% complete  
- **Generating**: 75% complete
- **Validating**: 90% complete
- **Completed/Failed**: 100% complete

### Result Integration
Advanced pipeline results integrate seamlessly with existing diff viewer:
- Same preview interface as standard generation
- Apply/reject functionality maintained
- Manual editing capabilities preserved
- Error display and retry options available

## Web Search Integration

### Brave Search API Service
```typescript
class BraveSearchService {
  searchDualQueries(broadQuery: string, preciseQuery: string, maxResults: number): Promise<SearchResults>
  searchSingleQuery(query: string, maxResults: number): Promise<SearchResult[]>
  isConfigured(): boolean
  getConfigurationStatus(): { configured: boolean; message: string }
}
```

### Environment Configuration
- **Development**: Proxy via Vite dev server to avoid CORS
- **Production**: Direct API calls or serverless function
- **API Key**: `BRAVE_API_KEY` or `VITE_BRAVE_API_KEY` environment variable
- **Timeout**: 10-second default timeout per search request

### Rate Limiting
- 1-second delay between broad and precise queries
- Graceful degradation on API failures
- Empty results fallback rather than pipeline termination
- Error logging and user feedback

### Search Query Optimization
- **Broad Queries**: Focus on conceptual inspiration and general examples
- **Precise Queries**: Target specific game titles, mechanics, or implementations
- **Domain Relevance**: Prefer gaming, RPG, and narrative-focused results
- **Result Filtering**: Extract most relevant titles and descriptions

## Error Handling and Resilience

### Pipeline Error States
```typescript
interface PipelineError {
  stage: string;      // Where error occurred
  loop: number;       // Which iteration
  error: string;      // Error message
  timestamp: Date;    // When it happened
}
```

### Error Recovery Strategies
1. **Invalid JSON**: Re-attempt with different temperature or retry limit
2. **Search Failures**: Continue with empty search results
3. **Validation Failures**: Trigger automatic retry up to max loops
4. **Timeout**: Graceful termination with partial results
5. **Network Issues**: Exponential backoff and retry mechanisms

### User-Facing Error Handling
- Clear error messages with suggested actions
- Fallback to standard mode on critical failures
- Retry options for recoverable errors
- Progress preservation during error states

## Configuration and Environment

### Environment Variables
```bash
# Web Search Configuration
BRAVE_API_KEY=your_brave_api_key_here
VITE_BRAVE_API_KEY=your_brave_api_key_here  # Alternative naming

# Pipeline Configuration
VITE_ADVANCED_NODE_TIMEOUT=600000           # 10 minutes default
VITE_SEARCH_PROXY_URL=https://your-proxy    # Production search endpoint

# Development Configuration
VITE_MAX_SEARCH_RESULTS=5                   # Results per query
```

### Service Configuration
```typescript
interface AdvancedNodeGenerationConfig {
  braveApiKey?: string;
  defaultTimeout: number;     // Pipeline timeout in milliseconds
  maxSearchResults: number;   // Results per search query
}
```

### Default Settings
- **Pipeline Timeout**: 10 minutes
- **Maximum Loops**: 3 iterations
- **Search Results**: 5 per query
- **Rate Limiting**: 1 second between searches
- **Temperature**: 0.7 (planning), 0.8 (generation), 0.3 (validation)

## Integration with Existing Systems

### LLM Core Integration
- Uses existing `getResponse` function for all LLM calls
- Integrates with prompt loading system (`loadedPrompts.advanced_nodes_generation`)
- Supports all configured LLM providers (OpenAI, OpenRouter, KoboldCPP, DeepSeek)
- Maintains existing logging and debugging capabilities

### Node System Integration
- Preserves all existing node update mechanisms
- Uses standard diff format for consistency
- Integrates with image generation queue
- Respects node protection rules (system, assistant nodes)

### Moxus System Integration
- Advanced pipeline results feed into Moxus evaluation
- Moxus guidance influences planning and generation stages
- Background quality assessment continues as normal
- Memory updates include advanced generation context

### Storage and Persistence
- Pipeline state maintained in React state during execution
- Results integrated with existing localStorage persistence
- Automatic cleanup of pipeline state on completion
- Error recovery maintains partial progress

## Testing Strategy

### Unit Tests
- **Planning Stage**: JSON validation, target node identification, success rule generation
- **Search Stage**: API integration, rate limiting, error handling, result formatting
- **Generation Stage**: Diff format validation, content integration, failure recovery
- **Validation Stage**: Rule evaluation, failure detection, loop control logic

### Integration Tests
- **Complete Pipeline**: End-to-end execution with mocked dependencies
- **Error Scenarios**: Timeout handling, API failures, invalid responses
- **Loop Control**: Automatic vs manual mode behavior
- **State Management**: Pipeline state persistence and cleanup

### Performance Tests
- **Pipeline Timeout**: Verify 10-minute timeout enforcement
- **Search Rate Limiting**: Confirm 1-second delays between queries
- **Memory Usage**: Monitor state size and cleanup effectiveness
- **Concurrent Execution**: Ensure single pipeline per assistant session

## Security Considerations

### API Key Management
- Environment variable configuration only
- No client-side storage of API keys
- Proxy server for development to hide keys
- Serverless function deployment for production

### Input Validation
- Sanitize all user inputs before LLM calls
- Validate JSON responses before processing
- Prevent injection attacks through search queries
- Rate limiting to prevent abuse

### Data Privacy
- Search queries logged only in development
- No persistent storage of search results
- User content remains within game state
- Configurable endpoint routing for privacy compliance

## Performance Optimization

### Token Management
- Smart context inclusion based on relevance
- Search result summarization to reduce token usage
- Diff format minimizes redundant content
- Progressive loading of pipeline stages

### Caching Strategy
- Search results cached per session (not persistent)
- Planning output reused across loops
- Validation results inform subsequent iterations
- State snapshots for efficient rollback

### Resource Management
- Single pipeline execution per assistant session
- Automatic cleanup on completion or failure
- Memory management for large node collections
- Background processing where possible

## Future Enhancements

### Planned Features
- **Multi-Provider Search**: Integration with additional search APIs
- **Search Result Ranking**: Relevance scoring and filtering
- **Pipeline Templates**: Pre-configured pipelines for common tasks
- **Batch Processing**: Multiple node operations in parallel

### Extensibility Points
- **Custom Validation Rules**: User-defined success criteria
- **Search Source Configuration**: Pluggable search providers
- **Stage Customization**: Additional pipeline stages
- **Integration Hooks**: External system callbacks

### Performance Improvements
- **Parallel Processing**: Concurrent node generation
- **Search Optimization**: Smarter query generation
- **Caching Layer**: Persistent search result storage
- **Incremental Updates**: Partial pipeline execution

This Advanced Node Generation System represents a significant enhancement to the standard node generation process, providing research-informed, iteratively-refined content generation with comprehensive validation and quality control mechanisms. 