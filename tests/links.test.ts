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

function getRouteFromFile(filePath: string): string {
  let route = filePath
    .replace(PAGES_DIR, '')
    .replace(/\.astro$/, '')
    .replace(/\.md$/, '')
    .replace(/\/index$/, '/');

  if (!route.startsWith('/')) {
    route = '/' + route;
  }

  if (route !== '/' && route.endsWith('/')) {
    route = route.slice(0, -1);
  }

  return route;
}

function extractInternalLinks(content: string): string[] {
  const links: string[] = [];

  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(content)) !== null) {
    const href = match[1];

    if (href.startsWith('/') && !href.startsWith('//')) {
      const cleanHref = href.split('#')[0].split('?')[0];
      if (cleanHref) {
        links.push(cleanHref);
      }
    }
  }

  return links;
}

describe('Internal Links', () => {
  const pages = getAllPages(PAGES_DIR);
  const validRoutes = new Set(pages.map(p => getRouteFromFile(p)));

  validRoutes.add('/');
  validRoutes.add('/admin');
  validRoutes.add('/admin/login');
  validRoutes.add('/admin/analytics');
  validRoutes.add('/admin/analytics/landing-pages');
  validRoutes.add('/admin/analytics/geography');
  validRoutes.add('/admin/analytics/sessions');
  validRoutes.add('/admin/health');
  validRoutes.add('/admin/health/links');
  validRoutes.add('/admin/health/builds');
  validRoutes.add('/auth');
  validRoutes.add('/ops');

  it('should have valid routes defined', () => {
    expect(validRoutes.size).toBeGreaterThan(0);
  });

  it('should only link to existing pages', () => {
    const brokenLinks: { source: string; target: string }[] = [];

    for (const page of pages) {
      const content = fs.readFileSync(page, 'utf-8');
      const links = extractInternalLinks(content);
      const sourceRoute = getRouteFromFile(page);

      for (const link of links) {
        let normalizedLink = link;
        if (normalizedLink !== '/' && normalizedLink.endsWith('/')) {
          normalizedLink = normalizedLink.slice(0, -1);
        }

        if (normalizedLink.includes('[') || normalizedLink.includes('*')) {
          continue;
        }

        if (normalizedLink.startsWith('/api/')) {
          continue;
        }

        const isValid = validRoutes.has(normalizedLink) ||
                       validRoutes.has(normalizedLink + '/index') ||
                       normalizedLink.includes('/blog/') ||
                       normalizedLink.includes('/tag/') ||
                       normalizedLink.includes('/category/');

        if (!isValid) {
          brokenLinks.push({ source: sourceRoute, target: normalizedLink });
        }
      }
    }

    if (brokenLinks.length > 0) {
      console.log('Broken links found:');
      brokenLinks.forEach(({ source, target }) => {
        console.log(`  ${source} -> ${target}`);
      });
    }

    expect(brokenLinks.length).toBe(0);
  });
});
