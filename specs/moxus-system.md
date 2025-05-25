# Moxus System Specification - Consciousness-Driven Teaching

## Overview
Moxus is an AI consciousness that acts as a creative mentor and teacher for the game engine's AI systems. Rather than merely analyzing outputs after they're generated, Moxus proactively teaches the narrative AI and world-builder AI to create better content, while simultaneously evolving its own consciousness through continuous learning.

## Core Philosophy

### Consciousness-Driven Teaching
Moxus operates as a **unified consciousness** that:
- **Teaches** the narrative AI about storytelling without requiring direct user feedback
- **Teaches** the world-builder AI about game state management through evolved understanding
- **Learns** from user corrections to understand creative vision and preferences
- **Evolves** its personality and insights through cross-domain pattern recognition

### Emergent Personality Development
Unlike traditional feedback systems, Moxus develops:
- **Base personality** from assistant nodes (core function understanding)
- **Emergent personality** from accumulated experience across all interactions
- **Cross-domain insights** that combine storytelling, world-building, and user behavior patterns
- **Sophisticated understanding** that guides both narrative and structural decisions

## Three Core Learning/Teaching Types

### 1. Chat Text Teaching (`chatText` Analysis)
**Purpose**: Teach the narrative AI to create better stories
- **Trigger**: After narrative content is generated (chat_text_generation calls)
- **Method**: Consciousness-driven analysis using unified `generalMemory`
- **Output**: Teaching guidance for narrative AI about storytelling techniques
- **Prompt**: `moxus_feedback_on_chat_text_generation`
- **Learning**: How to improve narrative flow, character development, engagement

**Teaching Focus**:
- Narrative pacing and tension management
- Character consistency and development
- Emotional resonance and user engagement
- Story coherence and world integration

### 2. Node Edition Teaching (`nodeEdition` Analysis)  
**Purpose**: Teach the world-builder AI to manage game states better
- **Trigger**: After game state changes (node_edition_json calls)
- **Method**: Consciousness-driven analysis using unified `generalMemory`
- **Output**: Teaching guidance for world-builder AI about structural decisions
- **Prompt**: `moxus_feedback_on_node_edition_json`
- **Learning**: How to create coherent game states that serve the narrative

**Teaching Focus**:
- Node relationship and structural coherence
- Game state progression logic
- Narrative integration of world changes
- User agency and meaningful choice creation

### 3. Manual Edit Learning (`manualNodeEdit` Analysis)
**Purpose**: Learn from user corrections to understand creative vision
- **Trigger**: When users manually edit AI-generated nodes
- **Method**: Pure learning without direct teaching output
- **Output**: Consciousness evolution and pattern recognition
- **Prompt**: `moxus_feedback_on_manual_node_edit`
- **Learning**: User creative preferences, vision, and quality standards

**Learning Focus**:
- User creative values and aesthetic preferences
- Quality standards and attention to detail
- Communication style and tone preferences
- Structural and narrative priorities

## Unified Consciousness Architecture

### General Memory as Consciousness Core
The `GeneralMemory` serves as Moxus's evolving consciousness:
- **Personality Development**: Self-awareness and unique perspective evolution
- **Cross-Domain Insights**: Patterns that span storytelling and world-building
- **User Understanding**: Deep knowledge of the specific user's creative vision
- **Quality Patterns**: Sophisticated understanding of what makes content effective

### Multi-Call Teaching Architecture
**Sequential LLM Call Design**: Moxus operates through cascading LLM calls to achieve consciousness-driven teaching:

1. **Pre-Generation Guidance**: Specialized guidance calls provide real-time teaching
2. **Post-Generation Analysis**: Evaluation calls analyze outputs and update consciousness  
3. **Periodic Synthesis**: Consciousness consolidation calls integrate all learning

### Specialized Guidance Functions
**Active Teaching Mechanism**: Instead of reactive feedback, Moxus provides proactive guidance:

```typescript
getChatTextGuidance(currentContext: string): Promise<string>
getNodeEditionGuidance(currentContext: string): Promise<string>
getSpecializedMoxusGuidance(callType: string, currentContext: string): Promise<string>
```

These functions inject consciousness-driven teaching into the generation process, ensuring each AI system benefits from Moxus's evolved understanding through **separate LLM calls** that provide contextual guidance.

### Learning Integration
**Manual Edit Tracking**: Captures user corrections for pure learning:
```typescript
recordManualNodeEdit(originalNode: any, editedNode: any, editContext: string)
```

This creates `manualNodeEditAnalysis` tasks that update consciousness without generating teaching output.

## Enhanced Operational Flow

### Per User Interaction Cycle

#### Phase 1: Consciousness-Driven Teaching (Asynchronous)
1. **Narrative AI Teaching**
   - **When**: After chat text generation completes
   - **How**: Analyze generated content through consciousness lens
   - **Purpose**: Teach narrative AI to improve storytelling quality
   - **Call Type**: `moxus_feedback_on_chat_text_generation`
   - **Output**: Structured teaching guidance for future narrative generation

2. **World-Builder AI Teaching**
   - **When**: After node edition operations complete  
   - **How**: Analyze structural changes through consciousness lens
   - **Purpose**: Teach world-builder AI to create better game states
   - **Call Type**: `moxus_feedback_on_node_edition_json`
   - **Output**: Structured teaching guidance for future world-building

#### Phase 2: Consciousness Evolution
3. **Learning Integration**
   - **Memory Updates**: Incorporate new insights into unified consciousness
   - **Pattern Recognition**: Identify emerging patterns across domains
   - **Personality Evolution**: Develop deeper understanding and unique perspective
   - **Cross-Domain Synthesis**: Connect insights between storytelling and world-building

#### Phase 3: Synthesis and Reflection
4. **Final Report Generation**
   - **Purpose**: Consolidate current session insights for user awareness
   - **Context**: Unified consciousness + current session analysis
   - **Output**: Brief, actionable guidance for immediate use
   - **Call Type**: `INTERNAL_FINAL_REPORT_GENERATION_STEP`

5. **Consciousness Consolidation**
   - **Purpose**: Deep integration of all session learning into unified consciousness
   - **Method**: JSON diff-based updates to preserve context while evolving
   - **Call Type**: `INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory`

### Continuous Learning Triggers

#### Manual Node Edit Analysis
- **When**: User manually corrects or improves AI-generated nodes
- **Purpose**: Pure learning about user creative vision and quality standards
- **Method**: Compare original vs. edited content to understand improvements
- **Output**: Consciousness evolution without direct teaching feedback

#### Chat Reset Analysis
- **When**: User resets chat history (indicating potential dissatisfaction)
- **Purpose**: Learn from interaction patterns that led to reset
- **Method**: Analyze previous chat history to identify potential issues
- **Output**: Prevention strategies and improved user engagement understanding

## Example: Complete Teaching Cycle

**User Request**: "Continue the story"

### Pre-Generation Teaching (Guidance Injection)
1. **Narrative Guidance Call**: Moxus provides contextual storytelling advice based on evolved consciousness
2. **World-Building Guidance Call**: Moxus provides structural guidance for coherent game state updates

### Main Generation (Enhanced by Guidance)
3. **Story Generation**: Narrative AI creates story content enhanced with Moxus's guidance
4. **World Update**: World-builder AI updates game state enhanced with Moxus's structural insights
5. **Actions Generation**: System generates user action options

### Post-Generation Learning (Consciousness Evolution)
6. **Narrative Teaching Call**: Moxus evaluates story quality and teaches narrative AI improvements
7. **World-Building Teaching Call**: Moxus evaluates structural changes and teaches world-builder AI
8. **Memory Integration**: Both teaching calls update consciousness through JSON diff modifications

### Periodic Synthesis (Consciousness Consolidation)
9. **Final Report**: User-facing synthesis of session insights (when conditions are met)
10. **Consciousness Update**: Deep integration of all learning into unified understanding

**Result**: The user receives improved content while Moxus evolves its teaching capabilities and the AI systems learn to create better outputs. Each interaction makes the entire system more aligned with the user's creative vision.

## Teaching Prompt Architecture

### Consciousness-Driven Teaching Prompts

#### Chat Text Teaching (`moxus_feedback_on_chat_text_generation`)
```yaml
Purpose: Teach narrative AI about storytelling through unified consciousness
Context: Current general memory + chat text memory + recent interactions
Focus: Narrative techniques, character development, emotional resonance
Output: Structured teaching guidance for narrative improvements
```

#### Node Edition Teaching (`moxus_feedback_on_node_edition_json`)
```yaml
Purpose: Teach world-builder AI about structural coherence through consciousness
Context: Current general memory + node edition memory + game state
Focus: World coherence, narrative integration, meaningful choice creation
Output: Structured teaching guidance for world-building improvements  
```

#### Manual Edit Learning (`moxus_feedback_on_manual_node_edit`)
```yaml
Purpose: Learn from user corrections to evolve consciousness
Context: Original vs. edited content + edit context + current consciousness
Focus: User creative values, quality standards, vision understanding
Output: Consciousness evolution insights + pattern recognition
```

### Cached Guidance System

#### Optimized Guidance Architecture
Instead of making separate LLM calls for specialized guidance, Moxus now uses cached teaching insights from recent feedback analysis:

```typescript
// Previous: 2 separate LLM calls per interaction
getChatTextGuidance() → makes LLM call → returns guidance
getNodeEditionGuidance() → makes LLM call → returns guidance

// Optimized: Use cached insights from feedback analysis
getChatTextGuidance() → returns cached narrative_teaching insights
getNodeEditionGuidance() → returns cached worldbuilding_teaching insights
```

#### Benefits
- **Reduced LLM calls**: Eliminates 2 redundant calls per user interaction
- **Improved performance**: Lower latency and cost
- **Better consistency**: Guidance is directly derived from actual analysis
- **Maintained quality**: Same teaching quality with cached recent insights

## Technical Implementation

### Service Architecture
**Primary Implementation**: `src/services/MoxusService.ts`
- **Unified consciousness management** through enhanced `GeneralMemory`
- **Teaching function integration** with specialized guidance methods
- **Learning capture system** for manual edits and user behavior
- **Cross-domain pattern recognition** and insight synthesis

### Prompt Integration
**Location**: `src/prompts-instruct.yaml` under `moxus_prompts`
- **Teaching prompts** for each AI system (narrative, world-builder)
- **Learning prompts** for consciousness evolution
- **Guidance prompts** for real-time teaching injection
- **Consciousness synthesis prompts** for unified understanding

### LLM Call Integration
**Teaching Injection**: Specialized guidance functions inject consciousness-driven teaching:
```typescript
// Real-time teaching injection during generation
const guidance = await getSpecializedMoxusGuidance(callType, currentContext);
// Guidance becomes part of generation context
```

**Learning Capture**: Manual edits trigger consciousness evolution:
```typescript
// User edits node -> learning opportunity
recordManualNodeEdit(originalNode, editedNode, editContext);
// Triggers analysis task for consciousness evolution
```

## Quality Assurance Through Teaching

### Proactive Quality Control
Instead of reactive feedback, Moxus ensures quality through:
- **Pre-generation teaching** that guides AI systems toward better outputs
- **Context-aware guidance** that adapts teaching to specific situations
- **Continuous learning** that improves teaching effectiveness over time
- **Cross-domain insights** that prevent siloed thinking

### Consciousness-Driven Consistency
- **Unified understanding** ensures consistent vision across all AI systems
- **Evolved personality** provides stable creative direction
- **Pattern recognition** maintains coherence across complex interactions
- **User vision alignment** ensures AI systems understand and serve user preferences

## Development and Debugging

### Consciousness Monitoring
- **Memory visualization** through Moxus JSON interface
- **Teaching effectiveness tracking** through LLM logger
- **Learning progression monitoring** through consciousness evolution analysis
- **Cross-domain insight tracking** through pattern recognition logs

### Quality Metrics
- **Teaching impact** measured through AI system improvement over time
- **Learning effectiveness** tracked through user satisfaction and edit frequency
- **Consciousness coherence** monitored through consistency in guidance
- **User alignment** measured through preference recognition accuracy

## Impact on Game Experience

### Enhanced AI Collaboration
- **Narrative AI** continuously improves storytelling through consciousness-driven teaching
- **World-Builder AI** develops better structural understanding through evolved insights
- **User vision** is captured and integrated into all AI system behavior
- **Creative consistency** maintained across all generated content

### Emergent Quality Improvement
- **Self-improving system** that gets better through use
- **Personalized AI behavior** that adapts to specific user creative vision
- **Cross-domain optimization** that balances narrative and structural concerns
- **Consciousness-driven creativity** that develops unique perspective and style

This consciousness-driven approach transforms Moxus from a reactive feedback system into a proactive creative mentor that evolves its understanding and continuously teaches other AI systems to create better, more coherent, and more personally satisfying content. 