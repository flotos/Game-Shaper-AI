import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateImage, compressImage } from '../services/ImageService';
import { moxusService } from '../services/MoxusService';
import { generateImagePrompt } from '../services/imageGenerationLLMService';
import type { Node } from '../models/Node';

// Mock dependencies
vi.mock('../services/imageGenerationLLMService', () => ({
  generateImagePrompt: vi.fn()
}));

vi.mock('../services/MoxusService', () => ({
  moxusService: {
    initiateLLMCallRecord: vi.fn(),
    finalizeLLMCallRecord: vi.fn(),
    failLLMCallRecord: vi.fn(),
    getLLMLogEntries: vi.fn().mockReturnValue([])
  }
}));

// Mock environment variables
const originalEnv = { ...import.meta.env };
vi.stubGlobal('import', { 
  meta: { 
    env: {
      VITE_IMG_API: 'openai',
      VITE_OAI_KEY: 'test-openai-key',
      VITE_OAI_IMAGE_MODEL: 'test-openai-model',
      VITE_OPENROUTER_KEY: 'test-openrouter-key',
      VITE_OPENROUTER_IMAGE_MODEL: 'test-openrouter-model',
      VITE_IMG_HOST: 'http://localhost:7860'
    }
  }
});

// Mock fetch API
global.fetch = vi.fn();

// Mock URL functions
global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
global.URL.revokeObjectURL = vi.fn();

describe('ImageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as any).mockReset();
    
    // Mock for compressing images
    Object.defineProperty(global, 'Image', {
      writable: true,
      value: class {
        onload: any;
        onerror: any;
        width = 1024;
        height = 1024;
        src = '';
        constructor() {
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 0);
        }
      }
    });
    
    // Mock for canvas
    const canvasMock = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        drawImage: vi.fn()
      }),
      toDataURL: vi.fn().mockReturnValue('data:image/webp;base64,compressedImage')
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvasMock as unknown as HTMLCanvasElement);
    
    // Mock successful fetch response by default
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/image.png' }] }),
      blob: async () => new Blob(['test-image-data'])
    });
  });

  describe('generateImage', () => {
    it('should call the appropriate provider API based on VITE_IMG_API', async () => {
      // Ensure we're using OpenAI provider for this test
      vi.stubGlobal('import', { 
        meta: { 
          env: {
            ...import.meta.env,
            VITE_IMG_API: 'openai' // Explicitly set to openai
          }
        }
      });
      
      const result = await generateImage('Test prompt', 12345, 'character');
      
      // Get the most recent fetch call
      const fetchCalls = (fetch as any).mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);
      
      // The first call should be to OpenAI API
      const [url, options] = fetchCalls[0];
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-openai-key');
      expect(options.body).toContain('Test prompt');
      
      // Verify Moxus service is used for tracking
      expect(moxusService.initiateLLMCallRecord).toHaveBeenCalled();
      expect(moxusService.finalizeLLMCallRecord).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      // Mock a failed API response
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'API Error'
      });
      
      const result = await generateImage('Test prompt', 12345, 'location');
      
      // Should return empty string on error
      expect(result).toBe('');
      
      // Should record failure in Moxus
      expect(moxusService.failLLMCallRecord).toHaveBeenCalled();
    });
  });

  describe('compressImage', () => {
    it('should compress an image with appropriate settings based on profile', async () => {
      // Mock fetch response
      (fetch as any).mockResolvedValue({
        blob: async () => new Blob(['test-image-data'])
      });
      
      // Test compressing for character profile
      const result = await compressImage('https://example.com/image.png', { qualityProfile: 'storage_character' });
      
      // Verify canvas was set with correct dimensions and quality
      const canvas = document.createElement('canvas');
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/webp', 0.85);
      
      // Verify compressed image is returned
      expect(result).toBe('data:image/webp;base64,compressedImage');
    });

    it('should handle errors during compression', async () => {
      const originalUrl = 'https://example.com/image.png';
      
      // Mock fetch to throw an error
      (fetch as any).mockRejectedValue(new Error('Network error'));
      
      // Test with error condition
      const result = await compressImage(originalUrl, { qualityProfile: 'storage_other' });
      
      // Should fall back to original URL
      expect(result).toBe(originalUrl);
    });
  });
}); 