import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env': {
      VITE_LLM_API: process.env.VITE_LLM_API,
      VITE_IMG_API: process.env.VITE_IMG_API,
      VITE_OAI_KEY: process.env.VITE_OAI_KEY,
      VITE_OPENROUTER_KEY: process.env.VITE_OPENROUTER_KEY,
      VITE_OAI_IMAGE_MODEL: process.env.VITE_OAI_IMAGE_MODEL,
      VITE_OPENROUTER_IMAGE_MODEL: process.env.VITE_OPENROUTER_IMAGE_MODEL,
      VITE_LLM_HOST: process.env.VITE_LLM_HOST,
      VITE_IMG_HOST: process.env.VITE_IMG_HOST
    }
  }
});