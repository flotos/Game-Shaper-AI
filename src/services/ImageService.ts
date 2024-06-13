import prompts from '../../prompts.json';

const apiType = import.meta.env.VITE_IMG_API;

export const generateImage = async (prompt: string): Promise<string> => {
  if (apiType === 'openai') {
    return generateImageFromOpenAI(prompt);
  } else if (apiType === 'automatic1111') {
    return generateImageFromAutomatic(prompt);
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
        model: import.meta.env.VITE_AOI_IMAGE_MODEL,
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

const compressImage = async (imageUrl: string): Promise<string> => {
  const img = new Image();
  img.src = imageUrl;
  await new Promise((resolve) => {
    img.onload = resolve;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0);
  }

  // Convert the canvas to a JPEG or WebP image
  const compressedImage = canvas.toDataURL('image/jpeg', 0.8); // 0.8 is the quality setting (0 to 1)
  // Or use 'image/webp' for WebP format
  // const compressedImage = canvas.toDataURL('image/webp', 0.8);

  return compressedImage;
};
