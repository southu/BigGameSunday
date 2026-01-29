import * as fs from 'fs';
import * as path from 'path';

interface PageData {
  path: string;
  title: string | null;
  description: string | null;
  wordCount: number;
  hasHero: boolean;
  hasFeaturedImage: boolean;
  lastModified: string | null;
}

interface LinkData {
  sourcePage: string;
  targetPage: string;
  linkText: string;
  anchor: string | null;
  isExternal: boolean;
  url: string;
  domain: string | null;
}

interface SiteRegistry {
  generatedAt: string;
  pages: PageData[];
  internalLinks: LinkData[];
  externalLinks: LinkData[];
}

const PAGES_DIR = path.join(process.cwd(), 'src/pages');
const OUTPUT_FILE = path.join(process.cwd(), 'src/data/site-registry.json');

function getRouteFromFile(filePath: string): string {
  let route = filePath
    .replace(PAGES_DIR, '')
    .replace(/\.astro$/, '')
    .replace(/\.md$/, '')
    .replace(/\/index$/, '/')
    .replace(/\[\.\.\.slug\]/, '*');

  if (!route.startsWith('/')) {
    route = '/' + route;
  }

  if (route !== '/' && route.endsWith('/')) {
    route = route.slice(0, -1);
  }

  return route;
}

function extractMetadata(content: string): { title: string | null; description: string | null } {
  let title: string | null = null;
  let description: string | null = null;

  const titleMatch = content.match(/title\s*[:=]\s*['"`]([^'"`]+)['"`]/);
  if (titleMatch) {
    title = titleMatch[1];
  }

  const descMatch = content.match(/description\s*[:=]\s*['"`]([^'"`]+)['"`]/);
  if (descMatch) {
    description = descMatch[1];
  }

  return { title, description };
}

function countWords(content: string): number {
  const textContent = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/---[\s\S]*?---/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[\s\S]*?\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return textContent.split(' ').filter(word => word.length > 0).length;
}

function hasHeroComponent(content: string): boolean {
  return content.includes('<Hero') || content.includes('Hero ');
}

function hasFeaturedImageComponent(content: string): boolean {
  return content.includes('<FeaturedImage') || content.includes('FeaturedImage ');
}

function extractLinks(content: string, sourcePath: string): LinkData[] {
  const links: LinkData[] = [];
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)</gi;

  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const href = match[1];
    const linkText = match[2].trim();

    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }

    const isExternal = href.startsWith('http://') || href.startsWith('https://');
    let domain: string | null = null;
    let targetPage = href;
    let anchor: string | null = null;

    if (isExternal) {
      try {
        const url = new URL(href);
        domain = url.hostname;
      } catch {}
    } else {
      const hashIndex = href.indexOf('#');
      if (hashIndex !== -1) {
        anchor = href.substring(hashIndex + 1);
        targetPage = href.substring(0, hashIndex) || sourcePath;
      }

      if (!targetPage.startsWith('/')) {
        const sourceDir = path.dirname(sourcePath);
        targetPage = path.join(sourceDir, targetPage).replace(/\\/g, '/');
      }
    }

    links.push({
      sourcePage: sourcePath,
      targetPage: isExternal ? href : targetPage,
      linkText,
      anchor,
      isExternal,
      url: href,
      domain
    });
  }

  const linkCardRegex = /<LinkCard[^>]*href=["']([^"']+)["'][^>]*(?:title=["']([^"']+)["'])?/gi;
  while ((match = linkCardRegex.exec(content)) !== null) {
    const href = match[1];
    const linkText = match[2] || '';

    const isExternal = href.startsWith('http://') || href.startsWith('https://');
    let domain: string | null = null;
    let targetPage = href;

    if (isExternal) {
      try {
        const url = new URL(href);
        domain = url.hostname;
      } catch {}
    } else {
      if (!targetPage.startsWith('/')) {
        const sourceDir = path.dirname(sourcePath);
        targetPage = path.join(sourceDir, targetPage).replace(/\\/g, '/');
      }
    }

    links.push({
      sourcePage: sourcePath,
      targetPage: isExternal ? href : targetPage,
      linkText,
      anchor: null,
      isExternal,
      url: href,
      domain
    });
  }

  return links;
}

function getAllFiles(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      getAllFiles(fullPath, files);
    } else if (entry.name.endsWith('.astro') || entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function generateRegistry(): Promise<void> {
  console.log('Generating site registry...');

  const files = getAllFiles(PAGES_DIR);
  const pages: PageData[] = [];
  const allLinks: LinkData[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const route = getRouteFromFile(file);

    if (route.includes('[') || route.includes('*')) {
      continue;
    }

    const stats = fs.statSync(file);
    const { title, description } = extractMetadata(content);

    pages.push({
      path: route,
      title,
      description,
      wordCount: countWords(content),
      hasHero: hasHeroComponent(content),
      hasFeaturedImage: hasFeaturedImageComponent(content),
      lastModified: stats.mtime.toISOString()
    });

    const links = extractLinks(content, route);
    allLinks.push(...links);
  }

  const internalLinks = allLinks.filter(l => !l.isExternal);
  const externalLinks = allLinks.filter(l => l.isExternal);

  const registry: SiteRegistry = {
    generatedAt: new Date().toISOString(),
    pages,
    internalLinks,
    externalLinks
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(registry, null, 2));

  console.log(`Registry generated: ${pages.length} pages, ${internalLinks.length} internal links, ${externalLinks.length} external links`);
}

generateRegistry().catch(console.error);
