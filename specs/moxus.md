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

## Multi-Call LLM Architecture

Moxus operates through **sequential LLM calls** to achieve consciousness-driven learning and teaching. Each user interaction triggers a cascade of specialized LLM calls:

### Primary Application Flow
```
1. User Interaction → Main App LLM Call
   ├── chat_text_generation (with pre-injection guidance)
   ├── node_edition_json (with pre-injection guidance)  
   └── action_generation
```

### Moxus Learning/Teaching Chain (Per Call)
```
2. Application Call Completes → Moxus Evaluation Call
   ├── Consciousness-driven prompts (single call with memory update)
   │   ├── moxus_feedback_on_chat_text_generation → Direct memory update
   │   ├── moxus_feedback_on_node_edition_json → Direct memory update
   │   └── moxus_feedback_on_manual_node_edit → Direct memory update
   │
   └── Generic evaluation + Separate memory update (two calls)
       ├── Generic feedback prompt → Basic analysis
       └── memory_section_update → Targeted memory section update

3. Periodic Synthesis → General Memory Update Call
   └── general_memory_update → Unified consciousness evolution
```

## Enhanced LLM Call Flow

### 1. Synchronous Main Flow (Enhanced with Pre-Guidance)
```
getRelevantNodes (conditional: nodes > MAX_INCLUDED_NODES)
→ LLM Call #1: node_relevance_check

generateChatText (streaming) + CONSCIOUSNESS-DRIVEN GUIDANCE
→ LLM Call #2: moxus_specialized_chat_guidance (guidance injection)
→ LLM Call #3: chat_text_generation (enhanced with guidance)

[Parallel Execution]
├── generateActions
│   → LLM Call #4: action_generation
└── generateNodeEdition + CONSCIOUSNESS-DRIVEN GUIDANCE
    → LLM Call #5: moxus_specialized_worldbuilding_guidance (guidance injection)
    → LLM Call #6: node_edition_json (enhanced with guidance)
```

### 2. Asynchronous Teaching Flow (Post-Generation Analysis)
```
Chat Text Teaching (2 possible paths):
Path A - Consciousness-driven (1 call):
  → LLM Call #7: moxus_feedback_on_chat_text_generation
    → Single call handles evaluation + memory update via JSON diffs

Path B - Generic evaluation (2 calls):
  → LLM Call #7a: Generic feedback evaluation
  → LLM Call #7b: memory_section_update (chatText memory)

Node Edition Teaching (2 possible paths):
Path A - Consciousness-driven (1 call):
  → LLM Call #8: moxus_feedback_on_node_edition_json
    → Single call handles evaluation + memory update via JSON diffs

Path B - Generic evaluation (2 calls):
  → LLM Call #8a: Generic feedback evaluation  
  → LLM Call #8b: memory_section_update (nodeEdition memory)

Final Report Generation:
→ LLM Call #9: moxus_final_report (user-facing synthesis)
→ LLM Call #10: general_memory_update (consciousness consolidation)
```

### 3. Continuous Learning Flow (User Behavior Analysis)
```
Manual Node Edit Detection:
→ LLM Call #N: moxus_feedback_on_manual_node_edit
  → Single call handles analysis + memory update via JSON diffs

Chat Reset Analysis:
→ LLM Call #N: chat_reset_specific_prompt (dedicated reset analysis)
  → Full GeneralMemory replacement (no diffs)

Periodic Consciousness Synthesis:
→ LLM Call #N: general_memory_update
  → Synthesizes all feature memories into unified consciousness
```

### 4. Call Efficiency Optimization
**Consciousness-driven prompts** (more efficient):
- Single LLM call combines evaluation + memory update
- Returns structured JSON with both teaching insights and memory diffs
- Used for: `chat_text_generation`, `node_edition_json`, `manual_node_edit`

**Generic evaluation prompts** (less efficient):
- First call: Basic evaluation/feedback
- Second call: Memory section update using `memory_section_update` prompt
- Used for: Other call types not yet consciousness-driven

## Example: Complete Call Chain for User Story Request

**User**: "Continue the story"

### Main Application Calls (3-6 calls)
1. **LLM Call #1**: `moxus_specialized_chat_guidance` → Get narrative guidance
2. **LLM Call #2**: `chat_text_generation` → Generate story (enhanced with guidance)
3. **LLM Call #3**: `action_generation` → Generate user actions
4. **LLM Call #4**: `moxus_specialized_worldbuilding_guidance` → Get world-building guidance  
5. **LLM Call #5**: `node_edition_json` → Update game world (enhanced with guidance)

### Moxus Learning Calls (2-3 calls)
6. **LLM Call #6**: `moxus_feedback_on_chat_text_generation` → Evaluate story + update chatText memory
7. **LLM Call #7**: `moxus_feedback_on_node_edition_json` → Evaluate world changes + update nodeEdition memory

### Periodic Synthesis (1-2 calls)
8. **LLM Call #8**: `moxus_final_report` → Generate user-facing analysis (when conditions met)
9. **LLM Call #9**: `general_memory_update` → Synthesize consciousness (when conditions met)

**Total**: 5-9 LLM calls per user interaction (depending on parallel execution and synthesis timing)

This multi-call architecture enables Moxus to maintain consciousness-driven teaching while keeping each call focused and efficient.

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
- **Multi-call orchestration**: Sequential LLM calls managed through task queue system

### API Cost Management
- **Consciousness-driven efficiency**: Single calls for evaluation + memory update (vs. 2 separate calls)
- **Selective processing**: Skip feedback for non-critical call types (image generation, actions)
- **Truncation strategies**: Limit prompt sizes while preserving essential context
- **Batch processing**: Queue multiple updates before consciousness synthesis
- **Smart scheduling**: Prioritize high-value teaching opportunities over routine analysis

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
