import prompts from '../../prompts.json';
import JSZip from 'jszip';

const apiType = import.meta.env.VITE_IMG_API;

export const generateImage = async (prompt: string): Promise<string> => {
  if (apiType === 'openai') {
    return generateImageFromOpenAI(prompt);
  } else if (apiType === 'openrouter') {
    return generateImageFromOpenRouter(prompt);
  } else if (apiType === 'automatic1111') {
    return generateImageFromAutomatic(prompt);
  } else if (apiType === 'novelai') {
    return generateImageFromNovelAIV4(prompt);
  } else {
    console.error('Unknown API type');
    return '';
  }
};

const generateImageFromOpenAI = async (prompt: string): Promise<string> => {
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
        size: '512x512'
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

const generateImageFromOpenRouter = async (prompt: string): Promise<string> => {
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
        style: import.meta.env.VITE_OPENROUTER_IMAGE_STYLE || 'vivid'
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
    return await compressImage(imageUrl);
  } catch (error) {
    console.error('Error generating image:', error);
    return '';
  }
};

const generateImageFromAutomatic = async (prompt: string): Promise<string> => {
  const webuiServerUrl = import.meta.env.VITE_IMG_HOST || 'http://127.0.0.1:7860';

  const payload = {
    prompt,
    negative_prompt: prompts.image_prompt_negative,
    seed: 1,
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

const generateImageFromNovelAIV4 = async (prompt: string): Promise<string> => {
  console.log('Starting NovelAI v4 image generation...');
  // You may want to customize these or pass as arguments
  const negativePrompt = prompts.image_prompt_negative || "anime, cartoon, manga, flat lighting\n";
  const seed = Math.floor(Math.random() * 4294967295); // random 32-bit unsigned int
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
      scale: 7,
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
      seed: seed,
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
  console.log('Starting image compression...');
  const img = new Image();
  
  return new Promise((resolve, reject) => {
    img.onload = () => {
      console.log('Image loaded successfully, creating canvas...');
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        console.log('Converting canvas to JPEG...');
        try {
          const compressedImage = canvas.toDataURL('image/jpeg', 0.8);
          console.log('Image compression completed successfully');
          resolve(compressedImage);
        } catch (error) {
          console.error('Error converting canvas to JPEG:', error);
          reject('Failed to compress image');
        }
      } else {
        console.error('Failed to get canvas context');
        reject('Failed to get canvas context');
      }
    };

    img.onerror = (error) => {
      console.error('Error loading image:', error);
      reject('Failed to load image');
    };

    console.log('Setting image source...');
    img.src = imageUrl;
  });
};
