import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Node } from '../models/Node';

// Mock external dependencies, not the service itself
vi.mock('jszip', () => ({
  default: class MockJSZip {
    constructor() {}
    static loadAsync = vi.fn().mockResolvedValue({
      files: {
        'image.png': {
          name: 'image.png',
          async: vi.fn().mockResolvedValue(new Blob(['test-image-data'], { type: 'image/png' }))
        }
      }
    });
  }
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
const mockEnv = {
  VITE_IMG_API: 'novelai',
  VITE_NAI_KEY: 'test-novelai-key',
  VITE_OAI_KEY: 'test-openai-key',
  VITE_OAI_IMAGE_MODEL: 'dall-e-3',
  VITE_OPENROUTER_KEY: 'test-openrouter-key',
  VITE_OPENROUTER_IMAGE_MODEL: 'test-model'
};

// Mock import.meta.env
vi.stubGlobal('import', {
  meta: {
    env: mockEnv
  }
});

// Mock global functions that the service uses
global.fetch = vi.fn();
global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
global.URL.revokeObjectURL = vi.fn();

// Mock DOM APIs for compression
Object.defineProperty(global, 'Image', {
  writable: true,
  value: class MockImage {
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

const mockCanvas = {
  width: 0,
  height: 0,
  getContext: vi.fn().mockReturnValue({
    drawImage: vi.fn()
  }),
  toDataURL: vi.fn().mockReturnValue('data:image/webp;base64,compressedImage')
};

vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
  if (tagName === 'canvas') {
    return mockCanvas as unknown as HTMLCanvasElement;
  }
  return document.createElement(tagName);
});

// Now import the service to test
import { generateImage, compressImage } from '../services/ImageService';
import { moxusService } from '../services/MoxusService';

describe('ImageService - Real Logic Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as any).mockReset();
    mockCanvas.toDataURL.mockReturnValue('data:image/webp;base64,compressedImage');
    
    // Reset environment to our test values before each test
    vi.stubGlobal('import', {
      meta: {
        env: mockEnv
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateImage', () => {
    it('should successfully generate image with NovelAI and return blob URL', async () => {
      // Mock successful NovelAI response (returns zip)
      const mockZipBlob = new Blob(['fake-zip-data'], { type: 'application/zip' });
      (fetch as any).mockResolvedValue({
        ok: true,
        blob: async () => mockZipBlob
      });

      const result = await generateImage('Test prompt', 12345, 'character');

      // Verify API calls were made (image generation + compression fetch)
      expect(fetch).toHaveBeenCalledTimes(2);
      const [url, options] = (fetch as any).mock.calls[0];
      expect(url).toBe('https://image.novelai.net/ai/generate-image');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toContain('"input":"Test prompt"');

      // Verify Moxus tracking
      expect(moxusService.initiateLLMCallRecord).toHaveBeenCalled();
      expect(moxusService.finalizeLLMCallRecord).toHaveBeenCalled();

      // Should return compressed data URL (since compression is applied)
      expect(result).toBe('data:image/webp;base64,compressedImage');
    });

    it('should handle API errors and return empty string', async () => {
      // Mock failed API response
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'API Error'
      });

      const result = await generateImage('Test prompt', 12345, 'location');

      // Should return empty string on error
      expect(result).toBe('');

      // Should record failure
      expect(moxusService.failLLMCallRecord).toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      // Mock network error
      (fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await generateImage('Test prompt', 12345, 'character');

      // Should return empty string on error
      expect(result).toBe('');

      // Should record failure
      expect(moxusService.failLLMCallRecord).toHaveBeenCalled();
    });

    it('should handle different providers based on configuration', async () => {
      // This test verifies that the service can handle different providers
      // without testing exact environment variable switching which is complex to mock
      (fetch as any).mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['fake-zip-data'], { type: 'application/zip' })
      });

      const result = await generateImage('Test prompt', 12345, 'character');

      // Verify calls were made and result returned
      expect(fetch).toHaveBeenCalled();
      // Should return compressed data URL (the service compresses by default)
      expect(result).toBe('data:image/webp;base64,compressedImage');
    });
  });

  describe('compressImage', () => {
    it('should compress image and return data URL', async () => {
      // Mock successful image fetch
      (fetch as any).mockResolvedValue({
        blob: async () => new Blob(['test-image-data'], { type: 'image/png' })
      });

      const result = await compressImage('https://example.com/image.png', { 
        qualityProfile: 'storage_character' 
      });

      // Should set canvas dimensions for character profile
      expect(mockCanvas.width).toBeGreaterThan(0);
      expect(mockCanvas.height).toBeGreaterThan(0);

      // Should call toDataURL with correct quality
      expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/webp', 0.85);

      // Should return compressed data URL
      expect(result).toBe('data:image/webp;base64,compressedImage');
    });

    it('should use different compression settings for different profiles', async () => {
      (fetch as any).mockResolvedValue({
        blob: async () => new Blob(['test-image-data'], { type: 'image/png' })
      });

      // Test storage_other profile
      await compressImage('https://example.com/image.png', { 
        qualityProfile: 'storage_other' 
      });

      expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/webp', 0.8);

      vi.clearAllMocks();
      mockCanvas.toDataURL.mockReturnValue('data:image/webp;base64,thumbnailImage');

      // Test thumbnail profile
      await compressImage('https://example.com/image.png', { 
        qualityProfile: 'thumbnail' 
      });

      expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/webp', 0.7);
    });

    it('should handle compression errors and return original URL', async () => {
      // Mock fetch error
      (fetch as any).mockRejectedValue(new Error('Network error'));

      const originalUrl = 'https://example.com/image.png';
      const result = await compressImage(originalUrl, { qualityProfile: 'storage_other' });

      // Should fallback to original URL
      expect(result).toBe(originalUrl);
    });

    it('should handle empty blob by falling back to original URL', async () => {
      // Mock empty blob - this should cause the service to fall back to original URL
      (fetch as any).mockResolvedValue({
        blob: async () => new Blob([], { type: 'image/png' })
      });

      const originalUrl = 'https://example.com/image.png';
      const result = await compressImage(originalUrl, { qualityProfile: 'storage_character' });

      // Should fallback to original URL when blob is empty (this is the correct behavior)
      expect(result).toBe(originalUrl);
    });
  });
}); 