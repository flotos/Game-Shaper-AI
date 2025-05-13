import prompts from '../../prompts.json';
import JSZip from 'jszip';

const apiType = import.meta.env.VITE_IMG_API;

export const generateImage = async (prompt: string, seed?: number): Promise<string> => {
  if (apiType === 'openai') {
    return generateImageFromOpenAI(prompt, seed);
  } else if (apiType === 'openrouter') {
    return generateImageFromOpenRouter(prompt, seed);
  } else if (apiType === 'automatic1111') {
    return generateImageFromAutomatic(prompt, seed);
  } else if (apiType === 'novelai') {
    return generateImageFromNovelAIV4(prompt, seed);
  } else {
    console.error('Unknown API type');
    return '';
  }
};

const generateImageFromOpenAI = async (prompt: string, seed?: number): Promise<string> => {
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_OAI_KEY}`
      },
      body: JSON.stringify({
        model: import.meta.env.VITE_OAI_IMAGE_MODEL,
        prompt,
        n: 1,
        size: '512x512',
        seed: seed
      })
    });

    if (!response.ok) {
      if (response.status === 400) {
        console.error('400 error: Bad request for image generation.');
        return '';
      }
      throw new Error(`Unexpected error: ${response.statusText}`);
    }

    const data = await response.json();
    const rawImageUrl = data.data[0].url;
    return await compressImage(rawImageUrl, true);
  } catch (error) {
    console.error('Error generating image from OpenAI:', error);
    return '';
  }
};

/**
 * Available OpenRouter Image Models:
 * - stabilityai/stable-diffusion-xl-base-1.0
 * - stability-ai/sdxl
 * - stability-ai/stable-diffusion-xl
 * - dall-e-3
 * - dall-e-2
 * - anthropic/claude-3-haiku
 * - anthropic/claude-3-sonnet
 * - anthropic/claude-3-opus
 */

const generateImageFromOpenRouter = async (prompt: string, seed?: number): Promise<string> => {
  try {
    const model = import.meta.env.VITE_OPENROUTER_IMAGE_MODEL || 'stability-ai/sdxl';
    const size = import.meta.env.VITE_OPENROUTER_IMAGE_SIZE || '1024x1024';
    const quality = import.meta.env.VITE_OPENROUTER_IMAGE_QUALITY || 'standard';

    console.log('Generating image with OpenRouter model:', model);
    const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_OPENROUTER_KEY}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Game Shaper AI'
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        quality,
        style: import.meta.env.VITE_OPENROUTER_IMAGE_STYLE || 'vivid',
        seed: seed
      })
    });

    if (!response.ok) {
      if (response.status === 400) {
        console.error('400 error: Bad request for image generation.');
        return '';
      }
      throw new Error(`Unexpected error: ${response.statusText}`);
    }

    const data = await response.json();
    const rawImageUrl = data.data[0].url;

    let finalImageUrl = '';

    let retries = 0;
    const maxRetries = 10;
    const retryDelay = 2000; // 2 seconds

    while (retries < maxRetries) {
      try {
        const imageResponse = await fetch(rawImageUrl);
        if (imageResponse.ok) {
          console.log('OpenRouter Image is ready');
          finalImageUrl = rawImageUrl;
          break;
        }
      } catch (error) {
        console.log(`OpenRouter Image not ready yet, retrying in ${retryDelay}ms (attempt ${retries + 1}/${maxRetries})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      retries++;
    }

    if (!finalImageUrl) {
      throw new Error('OpenRouter Image generation timed out or failed to fetch');
    }
    return await compressImage(finalImageUrl, true);
  } catch (error) {
    console.error('Error generating image from OpenRouter:', error);
    return '';
  }
};

const generateImageFromAutomatic = async (prompt: string, seed?: number): Promise<string> => {
  const webuiServerUrl = import.meta.env.VITE_IMG_HOST || 'http://127.0.0.1:7860';

  const payload = {
    prompt,
    negative_prompt: prompts.image_prompt_negative,
    seed: seed || 1,
    steps: 20,
    width: 1024,
    height: 1024,
    cfg_scale: 9,
    sampler_name: 'DPM++ 2M',
    n_iter: 1,
    batch_size: 1
  };

  try {
    const response = await fetch(`${webuiServerUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      if (response.status === 400) {
        console.error('400 error: Bad request for image generation.');
        return '';
      }
      throw new Error(`Unexpected error: ${response.statusText}`);
    }

    const data = await response.json();
    const base64Image = data.images[0];
    const rawImageUrl = `data:image/png;base64,${base64Image}`;
    return await compressImage(rawImageUrl, true);
  } catch (error) {
    console.error('Error generating image from Automatic1111:', error);
    return '';
  }
};

const generateImageFromNovelAIV4 = async (prompt: string, seed?: number): Promise<string> => {
  console.log('Starting NovelAI v4 image generation...');
  const negativePrompt = prompts.image_prompt_negative || "anime, cartoon, manga, blurry, low quality, lowres, dark, dim, concept art, bad anatomy";
  const now = new Date().toISOString();
  const correlationId = Math.random().toString(36).substring(2, 8);

  const payload = {
    input: prompt,
    model: "nai-diffusion-4-full",
    action: "generate",
    parameters: {
      params_version: 3,
      width: 1024,
      height: 1024,
      scale: 5,
      sampler: "k_dpmpp_2m_sde",
      steps: 28,
      n_samples: 1,
      ucPreset: 2,
      qualityToggle: false,
      autoSmea: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      cfg_rescale: 0,
      noise_schedule: "karras",
      legacy_v3_extend: false,
      skip_cfg_above_sigma: null,
      use_coords: false,
      legacy_uc: false,
      normalize_reference_strength_multiple: true,
      seed: seed || Math.floor(Math.random() * 4294967295),
      v4_prompt: {
        caption: {
          base_caption: prompt,
          char_captions: []
        },
        use_coords: false,
        use_order: true
      },
      v4_negative_prompt: {
        caption: {
          base_caption: negativePrompt,
          char_captions: []
        },
        legacy_uc: false
      },
      characterPrompts: [],
      negative_prompt: negativePrompt
    }
  };

  let zipUrl = '';
  let rawImageUrl = '';

  try {
    console.log('Sending request to NovelAI v4 API...');
    const response = await fetch('https://image.novelai.net/ai/generate-image', {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_NAI_KEY}`,
        'x-correlation-id': correlationId,
        'x-initiated-at': now,
        'Origin': 'https://novelai.net',
        'Referer': 'https://novelai.net/',
        'DNT': '1',
        'Sec-GPC': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Priority': 'u=0',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'TE': 'trailers'
      },
      body: JSON.stringify(payload)
    });

    console.log('Received response from NovelAI v4 API:', response.status);
    
    if (!response.ok) {
      if (response.status === 400) {
        console.error('400 error: Bad request for image generation.');
        return '';
      }
      if (response.status === 429) {
        console.log('Rate limited by NovelAI API. Waiting before retry...');
        throw new Error('RATE_LIMITED');
      }
      throw new Error(`Unexpected error: ${response.statusText}`);
    }

    const zipBlob = await response.blob();
    if (zipBlob.size === 0) {
      console.error('Received empty ZIP blob from API');
      return '';
    }

    zipUrl = URL.createObjectURL(zipBlob);
    const zip = await JSZip.loadAsync(zipBlob);
    const imageFile = Object.values(zip.files).find(file => 
      file.name.toLowerCase().endsWith('.png') || 
      file.name.toLowerCase().endsWith('.jpg') || 
      file.name.toLowerCase().endsWith('.jpeg')
    ) as JSZip.JSZipObject | undefined;

    if (!imageFile) {
      console.error('No image file found in ZIP');
      return '';
    }

    const imageBlob = await imageFile.async('blob');
    rawImageUrl = URL.createObjectURL(imageBlob);

    const highQualityBaseImage = await compressImage(rawImageUrl, true);
    return highQualityBaseImage;
  } catch (error) {
    console.error('Error in NovelAI v4 image generation:', error);
    return '';
  } finally {
    if (rawImageUrl) {
      URL.revokeObjectURL(rawImageUrl);
    }
    if (zipUrl) {
      URL.revokeObjectURL(zipUrl);
    }
  }
};

export const compressImage = async (imageUrl: string, preserveQuality: boolean = false): Promise<string> => {
  try {
    console.log('Starting image compression...');
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const MAX_WIDTH = preserveQuality ? 1024 : 512;
    const MAX_HEIGHT = preserveQuality ? 1024 : 512;
    
    return new Promise((resolve, reject) => {
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        const quality = preserveQuality ? 0.9 : 0.7;
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        console.log('Image compression completed');
        resolve(compressedDataUrl);
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image for compression'));
      };
      
      img.src = URL.createObjectURL(blob);
    });
  } catch (error) {
    console.error('Error compressing image:', error);
    return imageUrl;
  }
};
