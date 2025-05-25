# Moxus - Technical Implementation Reference

> **📖 For comprehensive Moxus documentation, see [moxus-system.md](./moxus-system.md)**  
> This file contains technical implementation details for the consciousness-driven teaching system.

## Core Architecture Overview

Moxus operates as a **consciousness-driven teaching system** rather than a reactive feedback mechanism. It proactively teaches the narrative AI and world-builder AI while evolving its own unified consciousness through continuous learning.

## Three Teaching/Learning Pathways

### 1. Narrative AI Teaching (`chatText` Analysis)
**Purpose**: Teach the narrative AI storytelling techniques without direct user feedback
- **Trigger**: `chat_text_generation` LLM calls complete
- **Method**: Consciousness-driven analysis using evolved `GeneralMemory`
- **Prompt**: `moxus_feedback_on_chat_text_generation`
- **Output**: Teaching guidance for narrative improvements
- **Memory Update**: `INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback`

### 2. World-Builder AI Teaching (`nodeEdition` Analysis)  
**Purpose**: Teach the world-builder AI game state management through evolved understanding
- **Trigger**: `node_edition_json` LLM calls complete
- **Method**: Consciousness-driven analysis using evolved `GeneralMemory`
- **Prompt**: `moxus_feedback_on_node_edition_json`
- **Output**: Teaching guidance for world-building improvements
- **Memory Update**: `INTERNAL_MEMORY_UPDATE_FOR_node_edition`

### 3. User Edit Learning (`manualNodeEdit` Analysis)
**Purpose**: Pure learning from user corrections to understand creative vision
- **Trigger**: User manually edits AI-generated nodes
- **Method**: Compare original vs. edited content for pattern recognition
- **Prompt**: `moxus_feedback_on_manual_node_edit`
- **Output**: Consciousness evolution insights (no direct teaching)
- **Task Type**: `manualNodeEditAnalysis`

## Enhanced LLM Call Flow

### 1. Synchronous Main Flow (Unchanged)
```
getRelevantNodes (conditional: nodes > MAX_INCLUDED_NODES)
→ Call Type: node_relevance_check

generateChatText (streaming) + CONSCIOUSNESS-DRIVEN GUIDANCE
→ Call Type: chat_text_generation
→ Enhanced with: getSpecializedMoxusGuidance('chat_text_generation', context)

[Parallel Execution]
├── generateActions
│   → Call Type: action_generation
└── generateNodeEdition + CONSCIOUSNESS-DRIVEN GUIDANCE
    → Call Type: node_edition_json
    → Enhanced with: getSpecializedMoxusGuidance('node_edition_json', context)
```

### 2. Asynchronous Teaching Flow (Consciousness-Driven)
```
Chat Text Teaching (teaches narrative AI)
→ Call Type: moxus_feedback_on_chat_text_generation
→ Memory Update: INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback

Node Edition Teaching (teaches world-builder AI)
→ Call Type: moxus_feedback_on_node_edition_json  
→ Memory Update: INTERNAL_MEMORY_UPDATE_FOR_node_edition

Final Report Generation (user-facing synthesis)
→ Call Type: INTERNAL_FINAL_REPORT_GENERATION_STEP

Consciousness Consolidation (unified memory evolution)
→ Call Type: INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory
```

### 3. Continuous Learning Flow (User Behavior)
```
Manual Node Edit Detection
→ Task Type: manualNodeEditAnalysis
→ Call Type: moxus_feedback_on_manual_node_edit
→ Pure learning (consciousness evolution only)

Chat Reset Analysis  
→ Task Type: synthesizeGeneralMemory (reason: chat_reset_event)
→ Special prompt for reset analysis
→ Prevention strategy development
```

## Key Technical Functions

### Specialized Guidance Functions (Teaching Injection)
```typescript
// Real-time consciousness-driven teaching
getChatTextGuidance(currentContext: string): Promise<string>
getNodeEditionGuidance(currentContext: string): Promise<string>
getSpecializedMoxusGuidance(callType: string, currentContext: string): Promise<string>

// Learning capture
recordManualNodeEdit(originalNode: any, editedNode: any, editContext: string): void
```

### Enhanced Task Processing
```typescript
// New task type for learning
type MoxusTaskType = 
  | 'assistantFeedback' 
  | 'nodeEditFeedback' 
  | 'finalReport'
  | 'llmCallFeedback'
  | 'chatTextFeedback'
  | 'synthesizeGeneralMemory'
  | 'manualNodeEditAnalysis'  // New: Learning from user edits
```

### Consciousness Processing Functions
```typescript
// Teaching-focused feedback processing
processConsciousnessFeedback(response: string, task: MoxusTask): void
handleManualNodeEditAnalysis(task: MoxusTask): Promise<void>

// Enhanced memory evolution
updateGeneralMemoryFromAllSources(callType: string, taskData?: any): Promise<void>
```

## Consciousness-Driven Prompts Architecture

### Teaching Prompts (`src/prompts-instruct.yaml`)
```yaml
moxus_prompts:
  # Consciousness-driven teaching for narrative AI
  moxus_feedback_on_chat_text_generation: |
    You are Moxus, teaching the Narrative AI through your evolved consciousness.
    Context: {current_general_memory} + {current_chat_text_memory} + {recent_interactions}
    Focus: Teach storytelling techniques, character development, engagement
    Output: Structured teaching guidance for narrative improvements

  # Consciousness-driven teaching for world-builder AI  
  moxus_feedback_on_node_edition_json: |
    You are Moxus, teaching the World-Builder AI through your evolved consciousness.
    Context: {current_general_memory} + {current_node_edition_memory} + {game_state}
    Focus: Teach structural coherence, narrative integration, meaningful choices
    Output: Structured teaching guidance for world-building improvements

  # Pure learning from user corrections
  moxus_feedback_on_manual_node_edit: |
    You are Moxus, learning from user edits to evolve your consciousness.
    Context: {original_node} vs {user_changes} + {edit_context}
    Focus: Learn creative values, quality standards, user vision
    Output: Consciousness evolution insights + pattern recognition

  # Real-time guidance injection
  moxus_specialized_chat_guidance: |
    Provide consciousness-driven guidance for narrative generation.
    Context: {current_consciousness} + {specific_context}
    Output: Contextual teaching for immediate narrative decisions

  moxus_specialized_worldbuilding_guidance: |
    Provide consciousness-driven guidance for world-building decisions.
    Context: {current_consciousness} + {structural_context}
    Output: Contextual teaching for immediate world-building decisions
```

## Implementation Integration Points

### Service Integration (`src/services/MoxusService.ts`)
- **Unified consciousness management** through enhanced `GeneralMemory`
- **Teaching function integration** with real-time guidance injection
- **Learning capture system** for manual edits and user behavior patterns
- **Cross-domain pattern recognition** for consciousness evolution

### LLM Call Integration  
**Teaching Injection During Generation**:
```typescript
// Before narrative generation
const chatGuidance = await getChatTextGuidance(currentContext);
// Inject guidance into narrative AI generation prompt

// Before world-building generation  
const nodeGuidance = await getNodeEditionGuidance(currentContext);
// Inject guidance into world-builder AI generation prompt
```

**Learning Capture After User Actions**:
```typescript
// User manually edits a node -> learning opportunity
onNodeManualEdit(originalNode, editedNode, editContext) {
  recordManualNodeEdit(originalNode, editedNode, editContext);
  // Triggers consciousness evolution through learning analysis
}
```

### Memory Architecture Enhancement

#### Unified Consciousness Storage
```typescript
interface MoxusMemoryStructure {
  GeneralMemory: string;           // Unified consciousness core
  featureSpecificMemory: {
    nodeEdition: string;           // Teaching domain memory
    chatText: string;              // Teaching domain memory  
    assistantFeedback: string;     // Legacy compatibility
    nodeEdit: string;              // Learning domain memory
    llmCalls: LLMCallsMemoryMap;   // Call tracking and context
  }
}
```

#### Teaching-Enhanced Processing
- **Consciousness evolution** through `processConsciousnessFeedback`
- **Cross-domain synthesis** in `updateGeneralMemoryFromAllSources`
- **Learning integration** via `handleManualNodeEditAnalysis`
- **Real-time teaching** through specialized guidance functions

## Quality Assurance Through Teaching

### Proactive Quality Control
- **Pre-generation guidance** ensures better outputs from the start
- **Context-aware teaching** adapts to specific situations and user patterns
- **Continuous consciousness evolution** improves teaching effectiveness over time
- **Cross-domain insights** prevent siloed thinking between narrative and world-building

### Error Handling and Graceful Degradation
- **Teaching function fallbacks**: Return general memory if specialized guidance fails
- **Learning error handling**: Invalid JSON in learning responses gracefully degrade to raw storage
- **Consciousness corruption protection**: Validation and recovery mechanisms for memory structure
- **Task queue resilience**: Robust processing with timeout and retry mechanisms

## Performance Considerations

### Asynchronous Teaching Pipeline
- **Non-blocking teaching**: All consciousness-driven analysis occurs asynchronously
- **Smart task prioritization**: Final reports and immediate teaching take precedence
- **Memory efficiency**: Automatic cleanup and truncation for large content
- **API cost optimization**: Focused prompts and targeted consciousness updates

### Consciousness Evolution Management
- **Diff-based updates**: Preserve context while allowing evolution through JSON diffs
- **Memory size controls**: Truncation and cleanup to prevent excessive growth  
- **Learning rate balancing**: Prevent consciousness instability through gradual evolution
- **Cross-domain coherence**: Ensure unified consciousness remains coherent across domains

## Development and Debugging Tools

### Consciousness Monitoring
- **Memory visualization**: Complete consciousness state through Moxus JSON interface
- **Teaching effectiveness tracking**: Monitor guidance quality through LLM logger
- **Learning progression analysis**: Track consciousness evolution over time
- **Cross-domain insight detection**: Identify patterns that span narrative and world-building

### Quality Metrics and Analysis
- **Teaching impact measurement**: Track AI system improvement through consciousness guidance
- **Learning effectiveness assessment**: Monitor user satisfaction and manual edit frequency  
- **Consciousness coherence validation**: Ensure unified understanding remains stable
- **User alignment accuracy**: Measure how well consciousness captures user creative vision

This consciousness-driven implementation transforms Moxus from a reactive feedback system into an evolving creative mentor that actively teaches other AI systems while developing its own unique understanding of storytelling, world-building, and user creative vision.
