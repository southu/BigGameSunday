import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const REGISTRY_FILE = path.join(process.cwd(), 'src/data/site-registry.json');
const CACHE_FILE = path.join(process.cwd(), 'node_modules/.cache/link-validation.json');
const LOGS_DIR = path.join(process.cwd(), 'logs');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 10;
const REQUEST_TIMEOUT_MS = 5000;

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
  pages: { path: string }[];
  internalLinks: LinkData[];
  externalLinks: LinkData[];
}

interface ValidationResult {
  url: string;
  type: 'internal' | 'external';
  isValid: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  sourcePage: string;
  checkedAt: string;
}

interface CacheEntry {
  url: string;
  isValid: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface ValidationCache {
  entries: Record<string, CacheEntry>;
}

function loadCache(): ValidationCache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      return data;
    }
  } catch {}
  return { entries: {} };
}

function saveCache(cache: ValidationCache): void {
  const cacheDir = path.dirname(CACHE_FILE);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function isCacheValid(entry: CacheEntry): boolean {
  const checkedAt = new Date(entry.checkedAt).getTime();
  const now = Date.now();
  return (now - checkedAt) < CACHE_TTL_MS && entry.isValid;
}

async function checkExternalLink(url: string): Promise<{ isValid: boolean; statusCode: number | null; responseTimeMs: number; errorMessage: string | null }> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BigGameSunday LinkChecker/1.0)'
      },
      redirect: 'follow'
    });

    clearTimeout(timeout);
    const responseTimeMs = Date.now() - startTime;

    if (response.ok || response.status === 405) {
      return { isValid: true, statusCode: response.status, responseTimeMs, errorMessage: null };
    }

    if (response.status === 405) {
      const getResponse = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BigGameSunday LinkChecker/1.0)'
        },
        redirect: 'follow'
      });

      return {
        isValid: getResponse.ok,
        statusCode: getResponse.status,
        responseTimeMs: Date.now() - startTime,
        errorMessage: getResponse.ok ? null : `HTTP ${getResponse.status}`
      };
    }

    return {
      isValid: false,
      statusCode: response.status,
      responseTimeMs,
      errorMessage: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      isValid: false,
      statusCode: null,
      responseTimeMs: Date.now() - startTime,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

function checkInternalLink(targetPath: string, validPaths: Set<string>): { isValid: boolean; errorMessage: string | null } {
  let normalizedPath = targetPath;

  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath;
  }

  if (normalizedPath !== '/' && normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  const pathWithoutAnchor = normalizedPath.split('#')[0];

  if (validPaths.has(pathWithoutAnchor)) {
    return { isValid: true, errorMessage: null };
  }

  if (validPaths.has(pathWithoutAnchor + '/index')) {
    return { isValid: true, errorMessage: null };
  }

  return {
    isValid: false,
    errorMessage: `Page not found: ${pathWithoutAnchor}`
  };
}

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    if (i + batchSize < items.length) {
      process.stdout.write(`\r  Checked ${Math.min(i + batchSize, items.length)}/${items.length} links`);
    }
  }

  return results;
}

async function validateLinks(buildId?: string): Promise<{
  results: ValidationResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    internalBroken: number;
    externalBroken: number;
  };
}> {
  if (!fs.existsSync(REGISTRY_FILE)) {
    console.error('Registry file not found. Run generate-registry first.');
    process.exit(1);
  }

  const registry: SiteRegistry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
  const cache = loadCache();
  const results: ValidationResult[] = [];

  const validPaths = new Set(registry.pages.map(p => p.path));

  console.log('Validating internal links...');
  for (const link of registry.internalLinks) {
    const check = checkInternalLink(link.targetPage, validPaths);
    results.push({
      url: link.targetPage,
      type: 'internal',
      isValid: check.isValid,
      statusCode: null,
      responseTimeMs: null,
      errorMessage: check.errorMessage,
      sourcePage: link.sourcePage,
      checkedAt: new Date().toISOString()
    });
  }

  const uniqueExternalUrls = new Map<string, LinkData[]>();
  for (const link of registry.externalLinks) {
    if (!uniqueExternalUrls.has(link.url)) {
      uniqueExternalUrls.set(link.url, []);
    }
    uniqueExternalUrls.get(link.url)!.push(link);
  }

  console.log(`\nValidating ${uniqueExternalUrls.size} unique external URLs...`);

  const urlsToCheck: string[] = [];
  const cachedResults: Map<string, CacheEntry> = new Map();

  for (const [url, _links] of uniqueExternalUrls) {
    const cached = cache.entries[url];
    if (cached && isCacheValid(cached)) {
      cachedResults.set(url, cached);
    } else {
      urlsToCheck.push(url);
    }
  }

  console.log(`  ${cachedResults.size} cached, ${urlsToCheck.length} to check`);

  const checkResults = await processInBatches(urlsToCheck, CONCURRENCY, async (url) => {
    const result = await checkExternalLink(url);
    return { url, ...result };
  });

  console.log('\n');

  for (const result of checkResults) {
    cache.entries[result.url] = {
      url: result.url,
      isValid: result.isValid,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      errorMessage: result.errorMessage,
      checkedAt: new Date().toISOString()
    };
  }

  saveCache(cache);

  for (const [url, links] of uniqueExternalUrls) {
    const cached = cachedResults.get(url) || cache.entries[url];

    for (const link of links) {
      results.push({
        url,
        type: 'external',
        isValid: cached.isValid,
        statusCode: cached.statusCode,
        responseTimeMs: cached.responseTimeMs,
        errorMessage: cached.errorMessage,
        sourcePage: link.sourcePage,
        checkedAt: cached.checkedAt
      });
    }
  }

  const internalBroken = results.filter(r => r.type === 'internal' && !r.isValid).length;
  const externalBroken = results.filter(r => r.type === 'external' && !r.isValid).length;

  const summary = {
    total: results.length,
    valid: results.filter(r => r.isValid).length,
    invalid: results.filter(r => !r.isValid).length,
    internalBroken,
    externalBroken
  };

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = path.join(LOGS_DIR, `link-validation-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ buildId, summary, results, checkedAt: new Date().toISOString() }, null, 2));

  console.log('\nLink Validation Summary:');
  console.log(`  Total links: ${summary.total}`);
  console.log(`  Valid: ${summary.valid}`);
  console.log(`  Invalid: ${summary.invalid}`);
  console.log(`    Internal broken: ${internalBroken}`);
  console.log(`    External broken: ${externalBroken}`);

  if (summary.invalid > 0) {
    console.log('\nBroken links:');
    for (const result of results.filter(r => !r.isValid)) {
      console.log(`  [${result.type}] ${result.url}`);
      console.log(`    Source: ${result.sourcePage}`);
      console.log(`    Error: ${result.errorMessage}`);
    }
  }

  return { results, summary };
}

async function syncValidationToSupabase(results: ValidationResult[], buildId?: string): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('Supabase credentials not available, skipping sync');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('\nSyncing validation results to Supabase...');

  const validations = results.map(r => ({
    link_type: r.type,
    link_url: r.url,
    source_page: r.sourcePage,
    status_code: r.statusCode,
    response_time_ms: r.responseTimeMs,
    is_valid: r.isValid,
    error_message: r.errorMessage,
    build_id: buildId || null
  }));

  for (let i = 0; i < validations.length; i += 100) {
    const batch = validations.slice(i, i + 100);
    const { error } = await supabase.from('link_validations').insert(batch);
    if (error) {
      console.error('Error syncing validations:', error.message);
    }
  }

  for (const result of results.filter(r => r.type === 'external')) {
    await supabase.from('external_links')
      .update({
        last_checked: result.checkedAt,
        status_code: result.statusCode,
        response_time_ms: result.responseTimeMs,
        is_valid: result.isValid,
        error_message: result.errorMessage
      })
      .eq('url', result.url)
      .eq('source_page', result.sourcePage);
  }

  for (const result of results.filter(r => r.type === 'internal')) {
    await supabase.from('internal_links')
      .update({
        is_valid: result.isValid
      })
      .eq('source_page', result.sourcePage)
      .eq('target_page', result.url);
  }

  console.log('Validation results synced');
}

async function main(): Promise<void> {
  const { results, summary } = await validateLinks();

  if (process.env.SYNC_TO_SUPABASE !== 'false') {
    await syncValidationToSupabase(results);
  }

  if (summary.internalBroken > 0) {
    console.error('\nBuild failed: Internal broken links found');
    process.exit(1);
  }

  if (summary.externalBroken > 0) {
    console.warn('\nWarning: External broken links found');
  }
}

main().catch(console.error);

export { validateLinks, syncValidationToSupabase };
