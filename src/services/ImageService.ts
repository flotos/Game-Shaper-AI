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
    const imageUrl = data.data[0].url;
    if (apiType === 'openai') {
      return imageUrl;
    }
    return await compressImage(imageUrl);
  } catch (error) {
    console.error('Error generating image:', error);
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
    const imageUrl = data.data[0].url;

    // Wait for the image to be ready
    let retries = 0;
    const maxRetries = 10;
    const retryDelay = 2000; // 2 seconds

    while (retries < maxRetries) {
      try {
        const imageResponse = await fetch(imageUrl);
        if (imageResponse.ok) {
          console.log('Image is ready');
          return await compressImage(imageUrl);
        }
      } catch (error) {
        console.log(`Image not ready yet, retrying in ${retryDelay}ms (attempt ${retries + 1}/${maxRetries})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      retries++;
    }

    throw new Error('Image generation timed out');
  } catch (error) {
    console.error('Error generating image:', error);
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
    const imageUrl = `data:image/png;base64,${base64Image}`;
    return await compressImage(imageUrl);
  } catch (error) {
    console.error('Error generating image:', error);
    return '';
  }
};

const generateImageFromNovelAIV4 = async (prompt: string, seed?: number): Promise<string> => {
  console.log('Starting NovelAI v4 image generation...');
  // You may want to customize these or pass as arguments
  const negativePrompt = prompts.image_prompt_negative || "anime, cartoon, manga, blurry, low quality, lowres, dark, dim, concept art";
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

    // The response is a ZIP file containing the generated images
    console.log('Converting response to blob...');
    const zipBlob = await response.blob();
    console.log('ZIP blob created, size:', zipBlob.size);
    
    if (zipBlob.size === 0) {
      console.error('Received empty ZIP blob from API');
      return '';
    }

    // Create a temporary URL for the ZIP file
    const zipUrl = URL.createObjectURL(zipBlob);
    
    try {
      // Use JSZip to extract the image from the ZIP
      const zip = await JSZip.loadAsync(zipBlob);
      
      // Find the first image file in the ZIP
      const files = Object.values(zip.files) as any[];
      const imageFile = files.find(file => 
        file.name.toLowerCase().endsWith('.png') || 
        file.name.toLowerCase().endsWith('.jpg') || 
        file.name.toLowerCase().endsWith('.jpeg')
      );
      
      if (!imageFile) {
        console.error('No image file found in ZIP');
        return '';
      }

      // Convert the image file to a blob
      const imageBlob = await imageFile.async('blob');
      console.log('Image extracted from ZIP, size:', imageBlob.size);

      // Create a URL for the image blob
      const imageUrl = URL.createObjectURL(imageBlob);
      
      try {
        console.log('Starting image compression...');
        const compressedImage = await compressImage(imageUrl);
        console.log('Image compression completed');
        return compressedImage;
      } catch (error) {
        console.error('Error during image compression:', error);
        return '';
      } finally {
        // Clean up the URLs
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
      console.error('Error processing ZIP file:', error);
      return '';
    } finally {
      // Clean up the ZIP URL
      URL.revokeObjectURL(zipUrl);
    }
  } catch (error) {
    console.error('Error in NovelAI v4 image generation:', error);
    return '';
  }
};

const compressImage = async (imageUrl: string): Promise<string> => {
  try {
    console.log('Starting image compression...');
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Create a canvas to resize and compress the image
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Set maximum dimensions while maintaining aspect ratio
    const MAX_WIDTH = 512;
    const MAX_HEIGHT = 512;
    
    return new Promise((resolve, reject) => {
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        // Calculate new dimensions while maintaining aspect ratio
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
        
        // Draw image with reduced quality
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to JPEG with reduced quality
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
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
    return imageUrl; // Return original URL if compression fails
  }
};
