/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import yaml from '@rollup/plugin-yaml';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [
      react({
        jsxRuntime: 'automatic'
      }),
      yaml()
    ],
    define: {
      'import.meta.env': {
        VITE_LLM_API: env.VITE_LLM_API,
        VITE_IMG_API: env.VITE_IMG_API,
        VITE_OAI_KEY: env.VITE_OAI_KEY,
        VITE_OPENROUTER_KEY: env.VITE_OPENROUTER_KEY,
        VITE_OAI_IMAGE_MODEL: env.VITE_OAI_IMAGE_MODEL,
        VITE_OPENROUTER_IMAGE_MODEL: env.VITE_OPENROUTER_IMAGE_MODEL,
        VITE_LLM_HOST: env.VITE_LLM_HOST,
        VITE_IMG_HOST: env.VITE_IMG_HOST,
        VITE_BRAVE_API_KEY: env.VITE_BRAVE_API_KEY
      }
    },
    server: {
      proxy: {
        '^/api/search': {
          target: 'https://api.search.brave.com/res/v1/web/search',
          changeOrigin: true,
          rewrite: (path) => {
            const [, queryString] = path.split('?');
            return queryString ? `?${queryString}` : '';
          },
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              console.log('[PROXY] Request:', req.method, req.url);
              console.log('[PROXY] Target:', proxyReq.path);
              
              proxyReq.setHeader('Accept', 'application/json');
              proxyReq.setHeader('Accept-Encoding', 'gzip');
              proxyReq.setHeader('User-Agent', 'Game-Shaper-AI/1.0');
              
              const apiKey = env.BRAVE_API_KEY || env.VITE_BRAVE_API_KEY;
              if (apiKey) {
                proxyReq.setHeader('X-Subscription-Token', apiKey);
                console.log('[PROXY] API key header added');
              } else {
                console.error('[PROXY] BRAVE_API_KEY not found! Please set BRAVE_API_KEY environment variable.');
              }
            });
            
            proxy.on('proxyRes', (proxyRes, req, res) => {
              console.log('[PROXY] Response status:', proxyRes.statusCode);
              if (proxyRes.statusCode !== 200) {
                console.log('[PROXY] Response headers:', proxyRes.headers);
              }
            });
            
            proxy.on('error', (err, req, res) => {
              console.error('[PROXY] Error:', err.message);
            });
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': '/src'
      }
    },
    // @ts-ignore
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/tests/setup.ts',
    }
  };
});