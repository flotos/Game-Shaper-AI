# Game Shaper AI - Project Overview

## Purpose
Game Shaper AI is an interactive AI-powered narrative story simulator that dynamically builds and adapts its rules and world based on gameplay. It uses Large Language Models (LLMs) to progress stories while maintaining consistency through a node-based game state system.

## Core Architecture

### Node-Based World System
- **Nodes** are the fundamental data structure representing all game elements
- Each node has: `id`, `name`, `longDescription`, `type`, `image`, `updateImage`, `imageSeed`
- Node types are free-form strings, commonly: `character`, `location`, `event`, `item`, `object`, `mechanic`, `concept`, `library`, `system`, `assistant`, `image_generation`, `Game Rule`, `Game Rules`
- Nodes serve as persistent memory for the AI narrator

### AI Integration Architecture
- **Primary LLM**: Generates narrative text and updates game state
- **Moxus AI**: Acts as guardrail and quality controller for primary LLM outputs
- **Image Generation**: Creates visual representations for nodes
- **Multiple Backend Support**: OpenAI, OpenRouter, KoboldCPP, DeepSeek

### Core Flow
1. User provides input through chat interface
2. System determines relevant nodes for context
3. Primary LLM generates narrative response (streaming)
4. Parallel LLM calls generate possible actions and node updates
5. Moxus evaluates and provides feedback on outputs
6. Image generation triggered for updated nodes (batched)
7. System updates UI with new state

## Technology Stack
- **Frontend**: React 17 + TypeScript + Tailwind CSS
- **Build Tool**: Vite 2.4.4
- **State Management**: React hooks + localStorage with LZString compression
- **LLM APIs**: OpenAI, OpenRouter, KoboldCPP, DeepSeek
- **Image APIs**: Configurable image generation services

## Key Features
- Real-time narrative generation with streaming responses
- Dynamic node creation, update, and deletion based on story progression
- Image generation for visual storytelling
- Export/import game states for sharing
- Twine story import functionality
- Token optimization for cost-effective AI usage
- Comprehensive logging and debugging tools
- Robust error handling with retry mechanisms
- Node-based relevance filtering and sorting

## File Structure
```
src/
├── components/          # React UI components
├── services/           # LLM and external service integrations
├── models/             # Data models and business logic
├── context/            # React context for state management
├── utils/              # Utility functions
├── types/              # TypeScript type definitions
├── data/               # Static data and configurations
└── lib/                # Additional libraries and utilities
```

## Environment Configuration
The application supports flexible AI backend configuration through environment variables, allowing users to choose between different LLM providers (OpenAI, OpenRouter, KoboldCPP, DeepSeek) and image generation services based on their needs and budget. Configuration includes feature flags for sorting, node limits, reasoning inclusion, and text truncation. 