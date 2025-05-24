# Moxus System Specification

## Overview
Moxus is an AI-powered guardrail and quality control system that monitors, evaluates, and provides feedback on all primary LLM outputs. It acts as a "World Design & Interactivity Watcher" to ensure narrative consistency, coherence, and quality in the generated content.

## Core Responsibilities

### Primary Functions
1. **Chat Text Evaluation**: Analyzes generated narrative for quality and consistency
2. **Node Edition Assessment**: Validates proposed game state changes
3. **Memory Management**: Maintains long-term context and learning
4. **Feedback Synthesis**: Provides actionable guidance for future generations
5. **Quality Assurance**: Flags problems and suggests improvements
6. **LLM Call Tracking**: Comprehensive logging of all LLM operations

### Guardrail Mechanisms
- Monitors all LLM outputs in real-time
- Maintains persistent memory across sessions with localStorage
- Provides critical feedback that becomes mandatory context
- Learns from past interactions to improve future guidance
- Acts as a consistency checker for the game world
- Automatic cleanup of old LLM call records (keeps latest 50)

## Operational Flow

### Per User Interaction Cycle

#### Phase 1: Output Evaluation (Asynchronous)
1. **Chat Text Analysis**
   - Triggers after chat text streaming completes
   - Evaluates last 2 interactions + generated chat text
   - Produces diff-based updates to `chatText` memory
   - **Call Type**: `moxus_feedback_on_chat_text_generation`

2. **Node Edition Analysis**
   - Triggers after node operations complete
   - Evaluates last 2 interactions + node changes + all nodes
   - Produces diff-based updates to `nodeEdition` memory
   - **Call Type**: `moxus_feedback_on_node_edition_json`

#### Phase 2: Memory Updates
3. **Individual Memory Updates**
   - Updates specific memory segments with evaluation results
   - **Call Types**: 
     - `INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback`
     - `INTERNAL_MEMORY_UPDATE_FOR_node_edition`

#### Phase 3: Synthesis and Reporting
4. **Final Report Generation**
   - Synthesizes both evaluations into comprehensive analysis
   - Context: Both feedbacks + general memory + last 5 interactions
   - **Call Type**: `INTERNAL_FINAL_REPORT_GENERATION_STEP`

5. **General Memory Update**
   - Updates long-term memory with synthesized insights
   - **Call Type**: `INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory`

### Additional Trigger Points

#### Assistant Feature Monitoring
- Monitors AI-generated nodes from assistant feature
- Updates general memory when significant patterns emerge
- Provides feedback on node generation quality

#### Regeneration Monitoring  
- Tracks when users regenerate AI-suggested content
- Analyzes input/output patterns to improve suggestions
- Updates memory with user preference patterns

#### Chat Reset Events
- Special handling for chat history clearing
- Archives previous chat history for analysis
- Updates general memory with session insights

## Memory Architecture

### Memory Segments
1. **General Memory**: Long-term insights and patterns
2. **Chat Text Memory**: Recent narrative quality assessments
3. **Node Edition Memory**: Recent game state change evaluations
4. **Assistant Feedback Memory**: Assistant interaction analysis
5. **Node Edit Memory**: Manual node edit analysis
6. **LLM Call Records**: Detailed logs of all operations (latest 50 kept)

### Memory Persistence
- JSON-based storage with localStorage
- Structured memory format with feature-specific segments
- Export/import capabilities for analysis
- Reset functionality for clean starts
- Automatic cleanup for optimal performance
- Text truncation for large content (default: 5000 chars)

### Memory Integration
- Moxus feedback becomes **mandatory context** in all future LLM calls
- Critical feedback flagged as "MUST FOLLOW" instructions
- Historical patterns inform future generation guidelines
- Consistency rules enforced across all content

## Feedback Mechanisms

### Critical Feedback Integration
```
### Latest Moxus Analysis (CRITICAL - MUST FOLLOW):
Note: This is feedback from the World Design & Interactivity Watcher, an AI that monitors 
the story and provides VITAL guidance to maintain consistency and quality in the game world.
ALL INSTRUCTIONS AND OBSERVATIONS FROM MOXUS IN THIS SECTION ARE MANDATORY.

[Moxus feedback content]
```

### Feedback Categories
- **Narrative Consistency**: Character behavior, world rules, continuity
- **Pacing and Flow**: Story rhythm, tension management, engagement
- **Node Coherence**: Logical state changes, relationship maintenance
- **User Experience**: Clarity, interactivity, immersion quality
- **Technical Quality**: JSON structure, field accuracy, completeness

## Error Handling and Recovery

### LLM Call Management
- Comprehensive logging of all Moxus operations with status tracking
- Success/failure tracking with detailed error messages
- Automatic retry mechanisms for transient failures
- Graceful degradation when Moxus is unavailable
- Call duration tracking and performance metrics

### Quality Assurance
- Self-monitoring of Moxus output quality
- Validation of memory updates and consistency
- Detection of infinite loops or recursive feedback
- Emergency fallback to basic operation mode
- Task queue management with debounced processing

## User Interface Integration

### Moxus Memory Panel
- Real-time view of Moxus memory state
- Export functionality for analysis and debugging
- Reset capabilities for development and testing
- Memory structure visualization

### LLM Logger Integration
- All Moxus calls visible in debug panel with real-time updates
- Detailed call logs with context and results
- Performance metrics and timing analysis
- Error tracking and resolution guidance
- Live listener system for UI updates

### Status Indicators
- Pending task counters in UI
- Background operation progress
- Memory update notifications
- Quality alerts and warnings

## Configuration and Customization

### Environment Controls
- Feature toggles for Moxus operations
- Memory size and retention limits (VITE_TRUNCATE_TEXT)
- Feedback severity thresholds
- Performance optimization settings

### Prompt Customization
- All Moxus prompts stored in `prompts-instruct.yaml`
- Personality and behavior configuration
- Context window management
- Output format specifications
- Diff-based memory update instructions

### Integration Flexibility
- Modular design allows selective Moxus features
- Fallback operation without Moxus interference
- Developer overrides for testing and debugging
- Custom feedback integration points
- Circular dependency avoidance with function injection

## Task Management System

### Task Types
- `assistantFeedback`: Assistant interaction analysis
- `nodeEditFeedback`: Node modification feedback  
- `finalReport`: Comprehensive synthesis reports
- `llmCallFeedback`: General LLM call analysis
- `chatTextFeedback`: Narrative quality assessment
- `synthesizeGeneralMemory`: Long-term memory updates

### Queue Processing
- Debounced task processing (50ms delay)
- Priority-based task execution
- Automatic final report triggering
- Background task management
- State tracking for complex workflows

## Best Practices

### Effective Utilization
- Monitor Moxus feedback for quality trends
- Use memory exports for game development insights
- Adjust prompts based on Moxus recommendations
- Leverage consistency enforcement for better narratives

### Performance Optimization
- Balance feedback detail with response time
- Use async processing to avoid user delays
- Implement smart caching for repetitive evaluations
- Monitor resource usage and API costs

### Quality Maintenance
- Regular review of Moxus feedback accuracy
- Continuous refinement of evaluation criteria
- User feedback integration for improvement
- Testing with diverse scenarios and edge cases

## Impact on Game Quality

### Consistency Enforcement
- Maintains character personality across interactions
- Enforces world rules and physics
- Preserves continuity in narrative threads
- Prevents contradictory information

### Quality Improvement
- Identifies weak narrative moments
- Suggests engagement enhancements
- Monitors pacing and tension
- Ensures meaningful user choices

### Learning and Adaptation
- Builds institutional memory of quality patterns
- Adapts to user preferences over time
- Improves suggestions based on past feedback
- Develops game-specific knowledge bases 