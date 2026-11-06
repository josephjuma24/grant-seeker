import { createHash } from 'node:crypto';

import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

import { regionsFromEligibilityText } from '../../shared/regions.ts';

// Where grants come from, and how each kind of source is read. Pure: no
// database and no process settings, so the API can list the sources too.

/** Postgres NOTIFY channel the API uses to ask the worker for a run. */
export const SCRAPER_CHANNEL = 'scraper_run_requested';

/* ------------------------------------------------------------------ */
/* Source configuration                                                */
/* ------------------------------------------------------------------ */

export const SourceConfigSchema = z.discriminatedUnion('adapter', [
  z.object({
    adapter: z.literal('grantsgov'),
    keyword: z.string().min(1).max(200),
    rows: z.number().int().min(1).max(100).default(25),
  }),
  z.object({ adapter: z.literal('rss'), url: z.url({ protocol: /^https?$/ }) }),
  // An HTML page of calls, read by Gemini. Skipped when no key is set.
  z.object({ adapter: z.literal('page'), url: z.url({ protocol: /^https?$/ }) }),
]);
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export interface Source {
  id: string;
  label: string;
  config: SourceConfig;
  /** Set for sources configured on a funder (funders.scrape_config). */
  funderId?: string;
  funderName?: string;
}

/**
 * Built-in sources: Grants.gov keyword searches across US federal agencies
 * (public API, no key). Funders add their own through scrape_config.
 */
export const DEFAULT_SOURCES: Source[] = [
  { id: 'grantsgov-ai', label: 'Grants.gov: artificial intelligence', config: { adapter: 'grantsgov', keyword: 'artificial intelligence', rows: 25 } },
  { id: 'grantsgov-health', label: 'Grants.gov: public health', config: { adapter: 'grantsgov', keyword: 'public health research', rows: 25 } },
  { id: 'grantsgov-climate', label: 'Grants.gov: climate & energy', config: { adapter: 'grantsgov', keyword: 'climate energy', rows: 25 } },
  { id: 'grantsgov-education', label: 'Grants.gov: education research', config: { adapter: 'grantsgov', keyword: 'education research', rows: 25 } },
];

/** Builds a source from a funder's scrape_config, or null if it is absent or invalid. */
export function funderSource(funder: { id: string; slug: string; name: string; scrapeConfig: unknown }): Source | null {
  if (!funder.scrapeConfig) return null;
  const parsed = SourceConfigSchema.safeParse(funder.scrapeConfig);
  if (!parsed.success) return null;
  return { id: `funder-${funder.slug}`, label: funder.name, config: parsed.data, funderId: funder.id, funderName: funder.name };
}

/* ------------------------------------------------------------------ */
/* What an adapter produces                                            */
/* ------------------------------------------------------------------ */

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const HarvestedGrantSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2_000),
  title: z.string().trim().min(3).max(500),
  description: z.string().trim().max(20_000).default(''),
  funderName: z.string().trim().max(300).optional(),
  amount: z.number().nonnegative().max(1e12).nullable().default(null),
  currency: z.string().length(3).default('USD'),
  deadline: z.string().regex(isoDate).nullable().default(null),
  eligibleRegions: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  eligibleOrgTypes: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  category: z.string().trim().max(80).nullable().default(null),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
});
export type HarvestedGrant = z.infer<typeof HarvestedGrantSchema>;

/**
 * One item a source currently lists. `fingerprint` changes when the
 * listing changes, so unchanged items are skipped without loading detail;
 * `load` fetches whatever detail the source has.
 */
export interface Listing {
  url: string;
  fingerprint: string;
  load: () => Promise<unknown>;
}

export interface AdapterContext {
  fetch: typeof fetch;
  grantsGovApi: string;
  /** Gemini-backed extraction for page sources; null without a key. */
  extractFromPage: ((pageText: string, pageUrl: string) => Promise<unknown[]>) | null;
  log: (msg: string) => void;
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const USER_AGENT = 'GrantSeekerBot/1.0 (grant discovery; respects robots.txt)';
const MAX_BYTES = 5 * 1024 * 1024;

export class SourceError extends Error {}

/** fetch with timeout, size cap, and retries with backoff on 429/5xx and network errors. */
export async function fetchWithRetry(
  ctx: Pick<AdapterContext, 'fetch'>,
  url: string,
  init: RequestInit = {},
  { retries = 2, timeoutMs = 20_000 } = {},
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1_000 * 2 ** (attempt - 1)));
    try {
      const res = await ctx.fetch(url, {
        ...init,
        headers: { 'user-agent': USER_AGENT, accept: '*/*', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new SourceError(`${url} answered ${res.status}`);
        continue;
      }
      if (!res.ok) throw new SourceError(`${url} answered ${res.status}`);
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > MAX_BYTES) throw new SourceError(`${url} is larger than ${MAX_BYTES} bytes`);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new SourceError(`${url} is larger than ${MAX_BYTES} bytes`);
      return text;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      lastError = err;
    }
  }
  throw new SourceError(`${url}: ${(lastError as Error)?.message ?? 'request failed'}`);
}

/* robots.txt ---------------------------------------------------------- */

const robotsCache = new Map<string, Promise<string[]>>();

/** Disallowed path prefixes for our user agent (or *). Unreachable robots.txt allows all. */
function disallowedPaths(ctx: AdapterContext, origin: string): Promise<string[]> {
  let cached = robotsCache.get(origin);
  if (!cached) {
    cached = fetchWithRetry(ctx, `${origin}/robots.txt`, {}, { retries: 0, timeoutMs: 8_000 })
      .then((txt) => {
        const rules: string[] = [];
        let applies = false;
        for (const raw of txt.split('\n')) {
          const line = raw.replace(/#.*/, '').trim();
          const [key, ...rest] = line.split(':');
          const value = rest.join(':').trim();
          if (/^user-agent$/i.test(key ?? '')) applies = value === '*' || /grantseekerbot/i.test(value);
          else if (applies && /^disallow$/i.test(key ?? '') && value) rules.push(value);
        }
        return rules;
      })
      .catch(() => []);
    robotsCache.set(origin, cached);
  }
  return cached;
}

export function clearRobotsCache() {
  robotsCache.clear();
}

async function assertAllowed(ctx: AdapterContext, url: string) {
  const u = new URL(url);
  const rules = await disallowedPaths(ctx, u.origin);
  if (rules.some((prefix) => u.pathname.startsWith(prefix))) {
    throw new SourceError(`${url} is disallowed by robots.txt`);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : ENTITIES[e.toLowerCase()] ?? m,
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

const money = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const isoFromUs = (mdY: string | undefined) => {
  const m = mdY?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

// Grants.gov funding-activity codes → the catalogue's categories.
const GRANTS_GOV_CATEGORY: Record<string, string> = {
  ST: 'Technology',
  HL: 'Health',
  EN: 'Energy',
  ENV: 'Energy',
  ED: 'Education',
  ELT: 'Education',
  HU: 'Social Sciences',
  ISS: 'Social Sciences',
  CD: 'Social Sciences',
  AG: 'Agriculture',
  NR: 'Environment',
};

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

const GrantsGovSearch = z.object({
  errorcode: z.number(),
  msg: z.string().optional(),
  data: z
    .object({
      oppHits: z
        .array(
          z.object({
            id: z.union([z.string(), z.number()]).transform(String),
            number: z.string().optional(),
            title: z.string(),
            agency: z.string().optional(),
            openDate: z.string().optional(),
            closeDate: z.string().optional(),
            oppStatus: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});

const GrantsGovDetail = z.object({
  errorcode: z.number(),
  data: z
    .object({
      opportunityTitle: z.string().optional(),
      synopsis: z
        .object({
          synopsisDesc: z.string().nullish(),
          agencyName: z.string().nullish(),
          awardCeiling: z.unknown().optional(),
          awardFloor: z.unknown().optional(),
          responseDateStr: z.string().nullish(),
          applicantTypes: z.array(z.object({ description: z.string() })).nullish(),
          applicantEligibilityDesc: z.string().nullish(),
          fundingActivityCategories: z.array(z.object({ id: z.string(), description: z.string() })).nullish(),
        })
        .passthrough()
        .nullish(),
      // Forecasted calls carry a forecast instead of a synopsis.
      forecast: z
        .object({
          forecastDesc: z.string().nullish(),
          estimatedFunding: z.unknown().optional(),
          numberOfAwards: z.unknown().optional(),
          applicantTypes: z.array(z.object({ description: z.string() })).nullish(),
          applicantEligibilityDesc: z.string().nullish(),
          fundingActivityCategories: z.array(z.object({ id: z.string(), description: z.string() })).nullish(),
        })
        .passthrough()
        .nullish(),
      cfdas: z.array(z.object({ programTitle: z.string().nullish() })).nullish(),
    })
    .passthrough()
    .optional(),
});

/**
 * Grants.gov uses far-future dates (e.g. 2076) to mean "open-ended"; a
 * deadline more than 10 years out is treated as no deadline.
 */
function plausibleDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() + 10);
  return iso <= limit.toISOString().slice(0, 10) ? iso : null;
}

async function grantsGov(source: Source, config: Extract<SourceConfig, { adapter: 'grantsgov' }>, ctx: AdapterContext): Promise<Listing[]> {
  const post = (path: string, body: unknown) =>
    fetchWithRetry(ctx, `${ctx.grantsGovApi}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const search = GrantsGovSearch.parse(
    JSON.parse(await post('search2', { keyword: config.keyword, rows: config.rows, oppStatuses: 'forecasted|posted' })),
  );
  if (search.errorcode !== 0) throw new SourceError(`Grants.gov search failed: ${search.msg ?? search.errorcode}`);

  return (search.data?.oppHits ?? []).map((hit) => ({
    url: `https://www.grants.gov/search-results-detail/${hit.id}`,
    // Search hits carry title, status and dates; a change in any of them
    // is worth re-reading the full synopsis.
    fingerprint: [hit.title, hit.oppStatus, hit.openDate, hit.closeDate].join('|'),
    load: async () => {
      const detail = GrantsGovDetail.parse(JSON.parse(await post('fetchOpportunity', { opportunityId: Number(hit.id) })));
      const syn = detail.data?.synopsis ?? undefined;
      const fc = detail.data?.forecast ?? undefined;
      const cats = syn?.fundingActivityCategories ?? fc?.fundingActivityCategories ?? [];
      // The amount is the most one award can be: the synopsis ceiling, or a
      // forecast's total funding over its number of awards. A floor is not
      // an award size, so it is never used.
      const awards = money(fc?.numberOfAwards);
      const forecastPerAward = money(fc?.estimatedFunding) && awards ? Math.round(money(fc?.estimatedFunding)! / awards) : null;
      const responseDate = syn?.responseDateStr?.slice(0, 10);
      return {
        url: `https://www.grants.gov/search-results-detail/${hit.id}`,
        title: detail.data?.opportunityTitle ?? hit.title,
        description: htmlToText(syn?.synopsisDesc ?? fc?.forecastDesc ?? '').slice(0, 20_000),
        funderName: syn?.agencyName ?? hit.agency,
        amount: syn ? money(syn.awardCeiling) : forecastPerAward,
        deadline: plausibleDeadline(responseDate && isoDate.test(responseDate) ? responseDate : isoFromUs(hit.closeDate)),
        // US federal calls; some also accept foreign organisations, which the
        // eligibility text says (shared/regions.ts reads it).
        eligibleRegions: regionsFromEligibilityText(
          ['United States'],
          [
            syn?.applicantEligibilityDesc ?? fc?.applicantEligibilityDesc ?? '',
            ...(syn?.applicantTypes ?? fc?.applicantTypes ?? []).map((t) => t.description),
            htmlToText(syn?.synopsisDesc ?? fc?.forecastDesc ?? ''),
          ].join(' | '),
        ),
        eligibleOrgTypes: (syn?.applicantTypes ?? fc?.applicantTypes ?? []).map((t) => t.description.slice(0, 300)).slice(0, 30),
        // Prefer a category the catalogue knows (a call can list several).
        category: (() => {
          const known = cats.find((c) => GRANTS_GOV_CATEGORY[c.id]);
          return known ? GRANTS_GOV_CATEGORY[known.id]! : cats[0]?.description.slice(0, 80) ?? null;
        })(),
        keywords: [
          config.keyword,
          ...(detail.data?.cfdas ?? []).map((c) => c.programTitle ?? '').filter(Boolean),
          ...(hit.number ? [hit.number] : []),
        ]
          .map((k) => k.slice(0, 80))
          .slice(0, 30),
      };
    },
  }));
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const textOf = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v && typeof v === 'object' && '#text' in v ? String((v as Record<string, unknown>)['#text']) : '';

async function rss(source: Source, config: Extract<SourceConfig, { adapter: 'rss' }>, ctx: AdapterContext): Promise<Listing[]> {
  await assertAllowed(ctx, config.url);
  const doc = xml.parse(await fetchWithRetry(ctx, config.url));
  // RSS 2.0 (channel.item) or Atom (feed.entry).
  const items = [
    ...asArray(doc?.rss?.channel?.item).map((i: Record<string, unknown>) => ({
      title: textOf(i.title),
      link: textOf(i.link),
      summary: textOf(i.description),
      date: textOf(i.pubDate),
    })),
    ...asArray(doc?.feed?.entry).map((e: Record<string, unknown>) => ({
      title: textOf(e.title),
      link: textOf((asArray(e.link as unknown[])[0] as Record<string, unknown> | undefined)?.['@_href'] ?? e.link),
      summary: textOf(e.summary ?? e.content),
      date: textOf(e.updated ?? e.published),
    })),
  ].filter((i) => i.title && /^https?:\/\//.test(i.link));

  return items.map((i) => ({
    url: i.link,
    fingerprint: [i.title, i.summary, i.date].join('|'),
    load: async () => ({
      url: i.link,
      title: htmlToText(i.title),
      description: htmlToText(i.summary),
      funderName: source.funderName,
    }),
  }));
}

async function page(source: Source, config: Extract<SourceConfig, { adapter: 'page' }>, ctx: AdapterContext): Promise<Listing[]> {
  if (!ctx.extractFromPage) {
    ctx.log(`${source.id}: skipped, page sources need GEMINI_API_KEY`);
    return [];
  }
  await assertAllowed(ctx, config.url);
  const text = htmlToText(await fetchWithRetry(ctx, config.url)).slice(0, 60_000);
  const extracted = await ctx.extractFromPage(text, config.url);
  return extracted.map((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const title = String(item.title ?? `Call ${i + 1}`);
    // An extracted call without its own link is keyed to the page plus its title.
    const url = typeof item.url === 'string' && /^https?:\/\//.test(item.url)
      ? item.url
      : `${config.url}#${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
    return {
      url,
      fingerprint: JSON.stringify(item),
      load: async () => ({ ...item, url, funderName: item.funderName ?? source.funderName }),
    };
  });
}

/** Everything a source currently lists. */
export function listSource(source: Source, ctx: AdapterContext): Promise<Listing[]> {
  const c = source.config;
  switch (c.adapter) {
    case 'grantsgov':
      return grantsGov(source, c, ctx);
    case 'rss':
      return rss(source, c, ctx);
    case 'page':
      return page(source, c, ctx);
  }
}
