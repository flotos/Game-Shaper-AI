# LLM Integration Specification

## Overview
Game Shaper AI uses multiple Large Language Models working in concert to create dynamic, consistent narrative experiences. The system employs a primary narrative LLM, a quality control LLM (Moxus), and specialized models for image generation.

## LLM Call Types and Flow

### Main User Interaction Flow (Synchronous)

#### 1. Node Relevance Check
- **Call Type**: `node_relevance_check`
- **Purpose**: Filter nodes relevant to user input
- **Triggers**: When total nodes > MAX_INCLUDED_NODES
- **Output**: Array of relevant node IDs
- **Function**: `getRelevantNodes()`

#### 2. Chat Text Generation  
- **Call Type**: `chat_text_generation`
- **Purpose**: Generate narrative response to user input
- **Mode**: Streaming for real-time display
- **Context**: Relevant nodes + last 5 interactions + cached Moxus guidance
- **Output**: Narrative text stream
- **Function**: `generateChatText()`

#### 3. Action Generation (Parallel)
- **Call Type**: `action_generation`
- **Purpose**: Suggest possible next user actions
- **Context**: Generated narrative + nodes + cached Moxus guidance
- **Output**: Array of 2 suggested actions
- **Function**: `generateActions()`

#### 4. Node Edition Generation (Parallel)
- **Call Type**: `node_edition_json`
- **Purpose**: Update game state based on story progression
- **Context**: Generated narrative + current nodes + cached Moxus guidance
- **Output**: JSON with node create/update/delete operations
- **Function**: `generateNodeEdition()`

### Background Moxus Flow (Asynchronous)

#### 5. Chat Text Feedback (Optimized)
- **Call Type**: `moxus_feedback_on_chat_text_generation`
- **Purpose**: Evaluate quality of generated narrative AND cache teaching insights
- **Context**: Last 2 interactions + chat text
- **Output**: Critical analysis, suggestions, and cached guidance for future use

#### 6. Node Edition Feedback (Optimized)
- **Call Type**: `moxus_feedback_on_node_edition_json`
- **Purpose**: Evaluate proposed node changes AND cache teaching insights
- **Context**: Last 2 interactions + node operations + all nodes
- **Output**: Analysis of node consistency and coherence

#### 7. Memory Updates
- **Call Type**: `INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback`
- **Call Type**: `INTERNAL_MEMORY_UPDATE_FOR_node_edition`
- **Purpose**: Update Moxus internal memory with feedback

#### 8. Final Report Generation
- **Call Type**: `INTERNAL_FINAL_REPORT_GENERATION_STEP`
- **Purpose**: Synthesize feedback into comprehensive report
- **Context**: Both chat and node feedback + general memory

#### 9. General Memory Update
- **Call Type**: `INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory`
- **Purpose**: Update Moxus long-term memory with new insights

### Additional LLM Operations

#### 10. Image Prompt Generation
- **Call Type**: `image_prompt_generation`
- **Purpose**: Create detailed prompts for image generation
- **Context**: Node details + all nodes + chat history
- **Output**: Optimized image generation prompt
- **Function**: `generateImagePrompt()`

#### 11. Node Sorting by Relevance
- **Call Type**: `node_sort_by_relevance`
- **Purpose**: Sort nodes by relevance to current context
- **Function**: `sortNodesByRelevance()`

#### 12. Story Refocusing
- **Call Type**: `refocus_story_generation`
- **Purpose**: Generate story summary when narrative becomes inconsistent
- **Function**: `refocusStory()`

#### 13. Node Creation from Prompt
- **Call Type**: `node_creation_from_prompt`
- **Purpose**: Generate nodes based on user prompts
- **Function**: `generateNodesFromPrompt()`

#### 14. Moxus Feedback
- **Call Type**: `moxus_feedback`
- **Purpose**: Internal Moxus feedback generation
- **Function**: `getMoxusFeedback()`

## Supported LLM Providers

### OpenAI
- **API Type**: `openai`
- **Models**: gpt-4o, gpt-3.5-turbo, gpt-4o-mini
- **Environment**: `VITE_OAI_KEY`

### OpenRouter
- **API Type**: `openrouter`
- **Default Model**: anthropic/claude-3-opus-20240229
- **Environment**: `VITE_OPENROUTER_KEY`, `VITE_OPENROUTER_MODEL`, `VITE_OPENROUTER_PROVIDER`
- **Features**: Provider selection, fallbacks, reasoning support

### KoboldCPP
- **API Type**: `koboldcpp`
- **Environment**: `VITE_KOBOLDCPP_API_URL`
- **Features**: Local model support, grammar constraints

### DeepSeek
- **API Type**: `deepseek`
- **Models**: deepseek-chat, deepseek-reasoner
- **Environment**: `VITE_DEEPSEEK_KEY`, `VITE_DEEPSEEK_MODEL`

## Prompt Engineering

### System Prompts Structure
All prompts follow a consistent structure stored in `prompts-instruct.yaml`:

```yaml
operation_name:
  instruction: |
    # TASK description
    # Rules and constraints  
    # Context sections
    # Return format specification
    # Examples
```

### Context Management
- **Token Optimization**: Relevance filtering reduces context size
- **Moxus Integration**: Previous Moxus reports included as critical context
- **Chat History**: Last 5 interactions for narrative continuity
- **Node Context**: Filtered nodes based on relevance scores
- **Node Sanitization**: Image fields removed for Moxus feedback

### Response Formats
- **JSON Objects**: Structured data for node operations and actions
- **Streaming Text**: Real-time narrative display
- **Plain Text**: Direct responses for specific tasks

## Error Handling and Resilience

### JSON Parsing
- Robust error handling with detailed logging
- Fallback mechanisms for malformed responses
- User-friendly error messages
- Automatic retry logic (3 attempts) for transient failures
- Special handling for different provider response formats

### Rate Limiting
- Batch processing for image generation (batches of 3)
- Configurable delays between API calls (50ms)
- Queue management for background tasks
- Priority handling for user-facing operations

### Quality Control
- Moxus validation of all LLM outputs
- Consistency checking across generated content
- Automatic flagging of problematic responses
- Memory-based learning from past mistakes

## Configuration and Flexibility

### Model Selection
- Environment-based model configuration
- Support for multiple LLM providers (OpenAI, OpenRouter, KoboldCPP, DeepSeek)
- Fallback model options for reliability
- Cost optimization through model selection

### Feature Flags
- **Node sorting**: `VITE_FEATURE_SORT_NODES` (default: true)
- **Maximum included nodes**: `VITE_MAX_INCLUDED_NODES` (default: 15)
- **Reasoning inclusion**: `VITE_LLM_INCLUDE_REASONING` (default: true)
- **Text truncation**: `VITE_TRUNCATE_TEXT` (default: 5000)

### Prompt Customization
- External YAML configuration for all prompts
- Think/no-think mode selection
- Template-based prompt generation
- Context-aware prompt selection

## Integration Points

### With Node System
- Node relevance scoring and filtering
- Dynamic node creation and updates
- Image regeneration triggers
- State persistence and recovery

### With UI Components
- Streaming response display
- Progress indicators for long operations
- Error state handling and user feedback
- Real-time status updates

### With Moxus System
- Feedback integration in all prompts
- Memory sharing between systems
- Quality control checkpoints
- Continuous improvement mechanisms

## Best Practices

### Prompt Design
- Clear task definitions and constraints
- Comprehensive context provision
- Structured output formats
- Robust error handling instructions

### Performance Optimization
- Parallel execution where possible (actions + node edition)
- Smart context filtering and compression
- Efficient model selection for different tasks
- Proactive caching of common operations

### Quality Assurance
- Multi-layer validation through Moxus
- Consistent formatting and structure
- Regular prompt testing and refinement
- User feedback integration for improvement 