// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://biggamesunday.com',
  trailingSlash: 'never',
  build: {
    format: 'file'
  }
});
