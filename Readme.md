# Game Shaper AI

Interact with a Game-engine that keep building its rules and world as you play, adapted to your gameplay.

<p align="center">
    <img src="https://github.com/flotos/Game-Shaper-AI/raw/main/logo.jpg" alt="logo"/>
</p>

[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/spKp9zeuQV)

## I. Features
### Node-based system
We propose a node system that has few advantages over raw LLM gaming:
- Token-saving features to keep the API costs lowers, as large stories can easily scale in content. the AI only retrieves the content from the nodes it needs, while keeping a short context of all the available nodes
- UI to inspect any node in your game, with the possibility to store an image for each
- Adapt nodes as you play, or create game templates. Export your game stat at any moment to share the state of your gameplay and see how others diverge from it, or prepare a set of rules from scratch.

### Strong support for Local AIs
We have strong optimizations in place for local AIs using KoboldCPP for accessibility on smaller GPU, and thanks to a set of custom Grammar (GNBF), your AI, even the simpler one will very rarely produce unhandled output such as badly formated JSON.

We know local AI can be more prone to errors, and we made sure these will not break your adventure.

![example screenshot](docs/images/capture2.JPG)


## II. Quick start with OpenAI Example
Node.js available here (Windows/linux/Mac)
`https://nodejs.org/en/download/package-manager`

Get the files, either:
- Download the repository from [this link](https://github.com/flotos/Game-Shaper-AI/archive/refs/heads/main.zip)
- Or clone the repository with
`git clone https://github.com/flotos/Game-Shaper-AI.git`

Get an OpenAI API key from [this link](https://platform.openai.com/api-keys) (We recommend setting low usage cost so you can first see the pricing.)

Create a file named `.env` at the root of this folder
```
VITE_OAI_KEY=# Open ai api key
VITE_LLM_API=openai
VITE_IMG_API=openai
VITE_OAI_IMAGE_MODEL=dalle-e-3 # You can set dalle-e-2 instead for half the cost, lower quality
```

Run `start.bat` which will install dependencies and run a server.
On your browser open [http://localhost:3000](http://localhost:3000)

## III. Set up AI Tools (LLM, image generation)
### OpenAI
You can specify in the .env your API key and the model to use for image generation
[Sample .env](#sample-env)


### Stable Diffusion (Automatic1111)

Start your automatic1111 repository with the following argument:

```
--listen --api --api-log --cors-allow-origins "*" --ckpt yourmodel.safetensors --port 7860 --opt-sdp-attention
```

### KoboldCPP

Example launch argument for running Higgs-Llama-3-70B.Q4_K on 2 RTX 4090
```
./koboldcpp --port 5001 --usecublas --model ./model/Higgs-Llama-3-70B.Q4_K.gguf --flashattention --quantkv 0 --gpulayers 81 --contextsize 2048
```

## IV. Notes
### Sample .env
```
VITE_OAI_KEY=# Open ai api key

VITE_LLM_API=koboldcpp #can be koboldcpp or openai
VITE_LLM_HOST=http://127.0.0.1:5001

VITE_IMG_API=automatic1111 #can be automatic1111 or openai (dalle-e)
VITE_IMG_HOST=http://127.0.0.1:7860
VITE_OAI_IMAGE_MODEL=dalle-e-3
```

### Quick notes

I have tested this project with both OpenAI and the following setup:

### Runpod "local" AI for 2.28€/h
- KoboldCPP on 2x 4090 GPU running the LLM [legraphista/Higgs-Llama-3-70B-IMat-GGUF](https://huggingface.co/legraphista/Higgs-Llama-3-70B-IMat-GGUF) at Q4_K quant.
- Stable diffusion XL on 1x4090 GPU

### OpenAI
About half the cost was images, the other GPT-4o. Each image is 0.02$ on dalle-e-2 and 0.04$ for dalle-e-3 [pricing](https://openai.com/api/pricing/)

## Environment Variables
- `VITE_LLM_API`: The API provider for LLM (e.g., `openai`, `openrouter`, `koboldcpp`).
- `VITE_IMG_API`: The API provider for image generation (e.g., `openai`, `openrouter`, `automatic1111`).
- `VITE_OAI_KEY`: The API key for OpenAI.
- `VITE_OPENROUTER_KEY`: The API key for OpenRouter.
- `VITE_OAI_IMAGE_MODEL`: The model for OpenAI image generation.
- `VITE_OPENROUTER_IMAGE_MODEL`: The model for OpenRouter image generation.
- `VITE_LLM_HOST`: The host for the LLM API.
- `VITE_IMG_HOST`: The host for the image generation API.

## NovelAI v4 Image Generation Support

To use NovelAI v4 for image generation:

1. Set the following environment variables in your `.env` or build environment:
   - `VITE_IMG_API=novelai`
   - `VITE_NAI_KEY=your_novelai_api_key`
2. The prompt you provide will be used as the main prompt. The negative prompt is taken from `prompts.json` (key: `image_prompt_negative`).
3. The API will return a compressed image (JPEG) as a data URL.

The integration uses the official NovelAI v4 endpoint and mimics the required headers and payload structure.

## OpenRouter Image Generation Configuration

When using OpenRouter for image generation (`VITE_IMG_API=openrouter`), you can configure the following environment variables:

- `VITE_OPENROUTER_KEY`: Your OpenRouter API key
- `VITE_OPENROUTER_IMAGE_MODEL`: The model to use for image generation (default: 'stability-ai/sdxl')
  - Available models:
    - `stabilityai/stable-diffusion-xl-base-1.0`
    - `stability-ai/sdxl`
    - `stability-ai/stable-diffusion-xl`
    - `dall-e-3`
    - `dall-e-2`
    - `anthropic/claude-3-haiku`
    - `anthropic/claude-3-sonnet`
    - `anthropic/claude-3-opus`
- `VITE_OPENROUTER_IMAGE_SIZE`: The size of the generated image (default: '1024x1024')
  - Available sizes depend on the model:
    - DALL-E 3: '1024x1024', '1792x1024', '1024x1792'
    - SDXL: '1024x1024'
    - Other models: Check the model's documentation
- `VITE_OPENROUTER_IMAGE_QUALITY`: The quality of the generated image (default: 'standard')
  - Available options: 'standard', 'hd' (for models that support it)
- `VITE_OPENROUTER_IMAGE_STYLE`: The style of the generated image (default: 'vivid')
  - Available options: 'vivid', 'natural' (for models that support it)

Example .env configuration:
```env
VITE_IMG_API=openrouter
VITE_OPENROUTER_KEY=your_api_key
VITE_OPENROUTER_IMAGE_MODEL=stability-ai/sdxl
VITE_OPENROUTER_IMAGE_SIZE=1024x1024
VITE_OPENROUTER_IMAGE_QUALITY=standard
VITE_OPENROUTER_IMAGE_STYLE=vivid
```

## OpenRouter Text Generation Configuration

When using OpenRouter for text generation (`VITE_LLM_API=openrouter`), you can configure the following environment variables:

- `VITE_OPENROUTER_KEY`: Your OpenRouter API key
- `VITE_OPENROUTER_MODEL`: The model to use for text generation (default: 'anthropic/claude-3-opus-20240229')
  - Available models:
    - `anthropic/claude-3-opus-20240229` - Most capable Claude 3 model
    - `anthropic/claude-3-sonnet-20240229` - Balanced Claude 3 model
    - `anthropic/claude-3-haiku-20240307` - Fast and efficient Claude 3 model
    - `anthropic/claude-2.1` - Previous generation Claude
    - `anthropic/claude-2.0` - Previous generation Claude
    - `google/gemini-pro` - Google's latest model
    - `google/gemini-1.0-pro` - Previous Gemini version
    - `meta-llama/llama-2-70b-chat` - Meta's largest Llama 2 model
    - `meta-llama/llama-2-13b-chat` - Smaller Llama 2 model
    - `mistral/mistral-medium` - Mistral's medium model
    - `mistral/mistral-small` - Mistral's small model
    - `mistral/mixtral-8x7b` - Mistral's MoE model
    - `nousresearch/nous-hermes-2-mixtral-8x7b-dpo` - Nous Research's Mixtral fine-tune
    - `perplexity/pplx-70b-online` - Perplexity's large model
    - `perplexity/pplx-7b-online` - Perplexity's small model
- `VITE_OPENROUTER_TEMPERATURE`: Controls randomness in the output (default: 0.7)
  - Range: 0.0 to 1.0 (lower = more deterministic)
- `VITE_OPENROUTER_MAX_TOKENS`: Maximum number of tokens in the response (default: 4096)
  - Actual limits vary by model

Example .env configuration:
```env
VITE_LLM_API=openrouter
VITE_OPENROUTER_KEY=your_api_key
VITE_OPENROUTER_MODEL=anthropic/claude-3-opus-20240229
VITE_OPENROUTER_TEMPERATURE=0.7
VITE_OPENROUTER_MAX_TOKENS=4096
```

For detailed pricing and capabilities of each model, visit: https://openrouter.ai/docs#models