import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PAGES_DIR = path.join(process.cwd(), 'src/pages');

function getAllPages(dir: string, pages: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      getAllPages(fullPath, pages);
    } else if (entry.name.endsWith('.astro') || entry.name.endsWith('.md')) {
      pages.push(fullPath);
    }
  }

  return pages;
}

describe('Pages', () => {
  const pages = getAllPages(PAGES_DIR);

  it('should have pages defined', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('should have valid Astro/MD files', () => {
    for (const page of pages) {
      const content = fs.readFileSync(page, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('should have a layout import in .astro files', () => {
    const astroPages = pages.filter(p => p.endsWith('.astro') && !p.includes('/api/'));

    for (const page of astroPages) {
      const content = fs.readFileSync(page, 'utf-8');

      if (
        page.includes('/admin/login') ||
        page.endsWith(`${path.sep}ops.astro`) ||
        page.endsWith(`${path.sep}auth.astro`)
      ) {
        continue;
      }

      if (page.includes('/admin/')) {
        const hasAdminLayout = content.includes("AdminLayout");
        expect(hasAdminLayout).toBe(true);
      } else if (!page.includes('[')) {
        const hasLayout = content.includes("Layout") ||
                         content.includes("SportLayout");
        expect(hasLayout).toBe(true);
      }
    }
  });

  it('should not have duplicate routes', () => {
    const routes = pages.map(p => {
      return p
        .replace(PAGES_DIR, '')
        .replace(/\.astro$/, '')
        .replace(/\.md$/, '')
        .replace(/\/index$/, '/');
    });

    const uniqueRoutes = new Set(routes);
    expect(routes.length).toBe(uniqueRoutes.size);
  });
});

describe('Page Content', () => {
  const pages = getAllPages(PAGES_DIR);

  it('should have proper frontmatter in Astro files', () => {
    const astroPages = pages.filter(p => p.endsWith('.astro'));

    for (const page of astroPages) {
      const content = fs.readFileSync(page, 'utf-8');
      expect(content.includes('---')).toBe(true);
    }
  });

  it('should have title prop passed to Layout', () => {
    const astroPages = pages.filter(p =>
      p.endsWith('.astro') &&
      !p.includes('/api/') &&
      !p.includes('[')
    );

    for (const page of astroPages) {
      const content = fs.readFileSync(page, 'utf-8');

      if (content.includes('<Layout') || content.includes('<AdminLayout') || content.includes('<SportLayout')) {
        expect(content.includes('title=')).toBe(true);
      }
    }
  });
});
