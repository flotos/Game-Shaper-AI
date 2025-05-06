# Game Shaper AI

An interactive AI-powered game engine that dynamically builds and adapts its rules and world based on your gameplay. Experience a unique gaming environment where the story and mechanics evolve as you play.

<p align="center">
    <img src="https://github.com/flotos/Game-Shaper-AI/raw/main/logo.jpg" alt="Game Shaper AI Logo"/>
</p>

[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/spKp9zeuQV)

## 🌟 Key Features

### 🎮 Dynamic Node-Based System
- **Efficient Content Management**: Token-saving features to optimize API costs while maintaining rich storytelling
- **Interactive Node Inspection**: UI for viewing and managing game nodes with image support
- **Flexible Game State**: Adapt nodes during gameplay or create game templates
- **Export/Import**: Share game states and compare different playthroughs

### 🤖 AI Integration
- **Multiple AI Backends**: Support for OpenAI and OpenRouter
- **Image Generation**: Support for multiple image generation backends (DALL-E, Stable Diffusion, NovelAI)

## 🚀 Getting Started

### Prerequisites
- Node.js (Windows/Linux/Mac) - [Download here](https://nodejs.org/en/download/package-manager)

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/flotos/Game-Shaper-AI.git
   ```
   Or download from [this link](https://github.com/flotos/Game-Shaper-AI/archive/refs/heads/main.zip)

2. **Configure Environment**
   Create a `.env` file in the root directory with your preferred configuration:
   ```env
   # OpenRouter Configuration (Default)
   VITE_LLM_API=openrouter
   VITE_OPENROUTER_KEY=your_openrouter_api_key
   VITE_OPENROUTER_MODEL=anthropic/claude-3-opus-20240229
   VITE_OPENROUTER_PROVIDER=anthropic
   
   # NovelAI Image Generation
   VITE_IMG_API=novelai
   VITE_NAI_KEY=your_novelai_api_key

   # Alternative: OpenAI Configuration
   # VITE_LLM_API=openai
   # VITE_OAI_KEY=your_openai_api_key
   # VITE_IMG_API=openai
   # VITE_OAI_IMAGE_MODEL=dalle-e-3  # or dalle-e-2 for lower cost

   # Alternative: Stable Diffusion Configuration
   # VITE_IMG_API=automatic1111
   # VITE_IMG_HOST=http://127.0.0.1:7860
   ```

3. **Start the Application**
   - Windows: Run `start.bat`
   - Linux/Mac: Run `start.sh`
   - Open [http://localhost:3000](http://localhost:3000) in your browser

## 🛠️ AI Configuration Options

### OpenAI Setup
1. Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Configure your `.env` file with the OpenAI settings
3. Recommended: Set usage limits initially to monitor costs

### Stable Diffusion (Automatic1111)
Launch with these parameters:
```bash
--listen --api --api-log --cors-allow-origins "*" --ckpt yourmodel.safetensors --port 7860 --opt-sdp-attention
```

## 💡 Advanced Features

### OpenRouter Integration
Configure OpenRouter for both text and image generation with various models:

- Qwen3
- Claude 3 (Opus, Sonnet, Haiku)
- GPT 4.1
- ...

### NovelAI v4 Support
- Configure image generation with NovelAI v4
- Custom negative prompts support
- Compressed JPEG output

## 🔧 Environment Variables Reference

### Core Variables
- `VITE_LLM_API`: LLM provider (`openai`, `openrouter`)
- `VITE_IMG_API`: Image generation provider (`openai`, `openrouter`, `automatic1111`, `novelai`)
- `VITE_OAI_KEY`: OpenAI API key
- `VITE_OPENROUTER_KEY`: OpenRouter API key

### OpenRouter Configuration
- `VITE_OPENROUTER_MODEL`: Model selection
- `VITE_OPENROUTER_PROVIDER`: Provider selection
- `VITE_OPENROUTER_TEMPERATURE`: Output randomness (0.0-1.0)
- `VITE_OPENROUTER_MAX_TOKENS`: Response length limit

### Image Generation
- `VITE_OAI_IMAGE_MODEL`: OpenAI image model
- `VITE_OPENROUTER_IMAGE_MODEL`: OpenRouter image model
- `VITE_OPENROUTER_IMAGE_SIZE`: Image dimensions
- `VITE_OPENROUTER_IMAGE_QUALITY`: Image quality setting
- `VITE_OPENROUTER_IMAGE_STYLE`: Image style preference

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License
This project is licensed under the MIT License - see the LICENSE file for details.