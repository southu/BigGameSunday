// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

export default defineConfig({
  site: 'https://biggamesunday.com',
  trailingSlash: 'never',
  output: 'server',
  adapter: netlify(),
  build: {
    format: 'file'
  },
  vite: {
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY)
    }
  }
});
