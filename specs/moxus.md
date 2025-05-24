# Moxus - Technical Implementation Reference

> **📖 For comprehensive Moxus documentation, see [moxus-system.md](./moxus-system.md)**  
> This file contains technical implementation details and developer notes.

## Core Job Description

Moxus acts as a guardrail and helper for the primary assistant LLM that generates story content. It provides quality control, consistency checking, and continuous improvement through feedback loops.

## Implementation Requirements

### Per User Interaction Cycle

**Phase 1: Evaluation (after LLM outputs complete)**
- **Chat Text Evaluation**: Listen when chat text streaming finishes, evaluate using last 2 interactions (user input, user notes, assistant replies, moxus analysis). Update `chatText` memory using diff operations.
- **Node Edition Evaluation**: Listen when node edition completes, evaluate using last 2 interactions + full node list. Update `nodeEdition` memory using diff operations.

**Phase 2: Synthesis and Reporting**
- **Analysis Generation**: After both evaluations complete, generate comprehensive analysis reading:
  - Both previous analyses from memory
  - Current `generalMemory`
  - Last 5 interactions in chat
- **Critical Feedback**: Provide feedback directed at narrative AI (not user) through chat
- **Memory Update**: Update `generalMemory` with new insights

### Additional Monitoring Points

**Assistant Feature Monitoring**
- Monitor when "assistant" feature generates nodes
- Update `generalMemory` using diff if patterns warrant attention

**Regeneration Monitoring**
- Monitor "regenerate" button usage for assistant/twine-suggested nodes
- Update `generalMemory` using diff based on input/output analysis

## Technical Implementation

### Prompts Location
All Moxus prompts exist in `src/prompts-instruct.yaml` - most features already implemented or have remnants from previous working versions.

### Logging Integration
All Moxus-triggered LLM calls must be viewable in the "log" panel feature for debugging and transparency.

### Memory Management
- Use diff-based updates for all memory segments
- Maintain separate memory spaces: `chatText`, `nodeEdition`, `generalMemory`
- Persist memory across sessions with export/import capability

## Current LLM Call Flow

### 1. Synchronous Main Flow
```
getRelevantNodes (conditional: nodes > MAX_INCLUDED_NODES)
→ Call Type: node_relevance_check

generateChatText (streaming)
→ Call Type: chat_text_generation

[Parallel Execution]
├── generateActions
│   → Call Type: action_generation
└── generateNodeEdition
    → Call Type: node_edition_json
```

### 2. Asynchronous Moxus Flow
```
Chat Text Feedback Generation
→ Call Type: moxus_feedback_on_chat_text_generation

Node Edition Feedback Generation
→ Call Type: moxus_feedback_on_node_edition_json

[Memory Updates]
├── Chat Text Memory Update
│   → Call Type: INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback
└── Node Edition Memory Update
    → Call Type: INTERNAL_MEMORY_UPDATE_FOR_node_edition

Final Report Generation (after both feedbacks complete)
→ Call Type: INTERNAL_FINAL_REPORT_GENERATION_STEP

General Memory Update (after final report)
→ Call Type: INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory
```

### 3. Background Image Generation
```
Image Prompt Generation (per node needing updates)
→ Call Type: image_prompt_generation
Note: Multiple calls possible per interaction
```

## Integration Notes

### Service Integration
- Primary implementation in `src/services/MoxusService.ts`
- Integration points in main user interaction flow
- Async operation to avoid blocking user experience

### Error Handling
- Graceful degradation when Moxus unavailable
- Comprehensive logging for debugging
- Fallback operation modes

### Performance Considerations
- Asynchronous execution prevents UI blocking
- Smart memory management to control API costs
- Batch processing where appropriate

## Development Status

Most Moxus features are implemented or have working remnants from previous versions. The system previously worked properly before refactoring. Current task is ensuring all components are properly connected and operational within the new architecture.

## Debug and Monitoring

- All Moxus operations logged in LLM Logger Panel
- Memory state viewable through Moxus JSON interface
- Export capability for analysis and debugging
- Real-time status indicators for pending operations
