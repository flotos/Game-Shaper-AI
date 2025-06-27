# Game Shaper AI - Technical Specifications

## Quick Overview for LLMs

Game Shaper AI is an **interactive AI-powered narrative story simulator** that uses multiple LLMs working together to create dynamic, coherent stories. The system maintains game state through a **node-based architecture** where nodes represent all game elements (characters, locations, events, etc.). A specialized AI called **Moxus** acts as a quality control system, monitoring and improving all AI outputs.

### Core Concepts
- **Nodes**: Fundamental data structures representing all game elements
- **Primary LLM**: Generates narrative text and updates game state
- **Moxus AI**: Quality control and consistency enforcement system
- **Streaming Interface**: Real-time chat-based interaction
- **State Persistence**: Complete game state save/load functionality

## Specification Files

### 📋 [Project Overview](./project-overview.md)
**Essential read for understanding the system architecture**
- High-level purpose and goals
- Core architectural components
- Technology stack and environment
- Key features and capabilities

### 🔧 [Node System](./node-system.md)
**Critical for understanding the data model**
- Node structure and properties
- Node types and their purposes
- CRUD operations and update mechanisms
- Integration with other systems

### 🤖 [LLM Integration](./llm-integration.md)
**Essential for understanding AI orchestration**
- Complete LLM call flow and types
- Prompt engineering structure
- Context management and optimization
- Error handling and resilience

### 🛡️ [Moxus System](./moxus-system.md)
**Key differentiator - AI quality control**
- Guardrail and feedback mechanisms
- Memory architecture and persistence
- Quality assurance processes
- Impact on narrative consistency

### 🎨 [User Interface](./user-interface.md)
**For understanding UI components and patterns**
- Component architecture and responsibilities
- Visual design system
- State management patterns
- Performance optimizations

### 🎮 [Game Flow](./game-flow.md)
**For understanding user interaction patterns**
- Complete interaction loop
- Advanced interaction patterns
- Error handling and recovery
- Performance optimization strategies

### 🔄 [Advanced Node Generation](./advanced-node-generation.md)
**For understanding the multi-stage pipeline system**
- 4-stage pipeline architecture (Planning → Search → Generation → Validation)
- Web search integration with Brave API
- Iterative refinement and loop control
- Success criteria validation and quality assurance

## Quick Reference

### Node Types (Free-form String)
```
Common types: character, location, event, item, object, mechanic, concept, 
library, system, assistant, image_generation, Game Rule, Game Rules
Note: Type field accepts any string value - no enforced constraints
```

### LLM Call Types
```
Synchronous: node_relevance_check, chat_text_generation, 
            action_generation, node_edition_json

Asynchronous: moxus_feedback_on_chat_text_generation,
              moxus_feedback_on_node_edition_json,
              INTERNAL_MEMORY_UPDATE_*, image_prompt_generation,
              node_sort_by_relevance, refocus_story_generation,
              node_creation_from_prompt, moxus_feedback
```

### Key File Locations
```
Prompts: src/prompts-instruct.yaml
Node Model: src/models/Node.ts
Node Management: src/models/useNodeGraph.ts
Node Operations: src/models/nodeOperations.ts
Main App: src/App.tsx
LLM Services: src/services/
Moxus Service: src/services/MoxusService.ts
Core LLM Logic: src/services/llmCore.ts
Node Interaction Service: src/services/nodeInteractionLLMService.ts
```

## Architecture Summary

```
User Input → Node Relevance Check → Primary LLM (Streaming) → State Update
                                           ↓
                           Parallel: Actions + Node Updates
                                           ↓
                     Background: Moxus Evaluation → Memory Update
                                           ↓
                              Image Generation Queue (Batches of 3)
```

## For Development Context

### Core Technologies
- **Frontend**: React 17 + TypeScript + Tailwind CSS
- **Build**: Vite 2.4.4
- **State**: React hooks + localStorage with LZString compression
- **AI APIs**: OpenAI, OpenRouter, KoboldCPP, DeepSeek
- **Image APIs**: Configurable image generation services

### Key Patterns
- **Streaming Responses**: Real-time narrative generation
- **Parallel Processing**: Multiple LLM calls for efficiency
- **Background Quality Control**: Moxus runs asynchronously
- **Token Optimization**: Smart context filtering
- **Error Recovery**: Graceful degradation and user feedback (3 retry attempts)

### Environment Variables
```
Core LLM:
VITE_LLM_API (openai/openrouter/koboldcpp/deepseek)
VITE_OAI_KEY, VITE_OPENROUTER_KEY, VITE_DEEPSEEK_KEY
VITE_OPENROUTER_MODEL, VITE_OPENROUTER_PROVIDER
VITE_DEEPSEEK_MODEL, VITE_KOBOLDCPP_API_URL

Features:
VITE_MAX_INCLUDED_NODES (default: 15)
VITE_FEATURE_SORT_NODES (default: true)
VITE_LLM_INCLUDE_REASONING (default: true)
VITE_TRUNCATE_TEXT (default: 5000)

Image Generation:
VITE_IMG_API
(Image-related environment variables as configured)
```

## Quick Start for LLM Development

1. **Read**: [Project Overview](./project-overview.md) for architecture understanding
2. **Study**: [Node System](./node-system.md) for data model comprehension
3. **Review**: [LLM Integration](./llm-integration.md) for AI interaction patterns
4. **Understand**: [Moxus System](./moxus-system.md) for quality control mechanisms

## System Strengths

- **Multi-LLM Orchestration**: Specialized AI models for different tasks
- **Quality Control**: Moxus ensures consistency and improvement
- **Performance Optimization**: Smart token usage and parallel processing
- **State Management**: Comprehensive game state persistence with compression
- **Visual Integration**: Automatic image generation for enhanced storytelling
- **Extensibility**: Modular architecture supporting multiple AI providers
- **Error Resilience**: Robust retry mechanisms and graceful degradation
- **Developer Tools**: Comprehensive LLM call logging and debugging

This system represents a sophisticated approach to AI-powered interactive storytelling, combining multiple specialized AI models with robust state management and quality control mechanisms to create engaging, consistent narrative experiences. 