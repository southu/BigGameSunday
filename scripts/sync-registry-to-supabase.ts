import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const REGISTRY_FILE = path.join(process.cwd(), 'src/data/site-registry.json');

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

async function syncToSupabase(): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!fs.existsSync(REGISTRY_FILE)) {
    console.error('Registry file not found. Run generate-registry first.');
    process.exit(1);
  }

  const registry: SiteRegistry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));

  console.log('Syncing pages to Supabase...');

  for (const page of registry.pages) {
    const { error } = await supabase.from('pages').upsert({
      path: page.path,
      title: page.title,
      description: page.description,
      word_count: page.wordCount,
      has_hero: page.hasHero,
      has_featured_image: page.hasFeaturedImage,
      last_modified: page.lastModified,
      internal_link_count: registry.internalLinks.filter(l => l.sourcePage === page.path).length,
      external_link_count: registry.externalLinks.filter(l => l.sourcePage === page.path).length,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'path'
    });

    if (error) {
      console.error(`Error syncing page ${page.path}:`, error.message);
    }
  }

  console.log(`Synced ${registry.pages.length} pages`);

  console.log('Syncing internal links...');

  await supabase.from('internal_links').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const internalLinkBatches = [];
  for (let i = 0; i < registry.internalLinks.length; i += 100) {
    internalLinkBatches.push(registry.internalLinks.slice(i, i + 100));
  }

  for (const batch of internalLinkBatches) {
    const { error } = await supabase.from('internal_links').insert(
      batch.map(link => ({
        source_page: link.sourcePage,
        target_page: link.targetPage,
        link_text: link.linkText,
        anchor: link.anchor
      }))
    );

    if (error) {
      console.error('Error syncing internal links:', error.message);
    }
  }

  console.log(`Synced ${registry.internalLinks.length} internal links`);

  console.log('Syncing external links...');

  await supabase.from('external_links').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const externalLinkBatches = [];
  for (let i = 0; i < registry.externalLinks.length; i += 100) {
    externalLinkBatches.push(registry.externalLinks.slice(i, i + 100));
  }

  for (const batch of externalLinkBatches) {
    const { error } = await supabase.from('external_links').insert(
      batch.map(link => ({
        source_page: link.sourcePage,
        url: link.url,
        domain: link.domain,
        link_text: link.linkText
      }))
    );

    if (error) {
      console.error('Error syncing external links:', error.message);
    }
  }

  console.log(`Synced ${registry.externalLinks.length} external links`);
  console.log('Registry sync complete!');
}

syncToSupabase().catch(console.error);
