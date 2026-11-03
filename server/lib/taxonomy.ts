// Shared vocabulary for profile extraction and fit scoring: research
// themes, countries with their regions, and well-known funders. Kept in
// one place so the extractor and the scorer can never disagree on what
// "Health" or "East Africa" means.

export interface Theme {
  id: string;
  label: string;
  pattern: RegExp;
}

export const THEMES: Theme[] = [
  { id: 'health', label: 'Health', pattern: /\bhealth|clinical|disease|malaria|\bhiv\b|tuberculosis|maternal|vaccin|epidemiolog|nutrition|medical|medicine|patient/i },
  { id: 'agriculture', label: 'Agriculture & food', pattern: /agricultur|\bcrops?\b|farm|food security|livestock|\bsoils?\b|agri-?food|irrigation/i },
  { id: 'climate', label: 'Climate & environment', pattern: /climate|environment|biodiversity|conservation|carbon|ecosystem|forest|resilience|adaptation/i },
  { id: 'energy', label: 'Energy', pattern: /\benergy|solar|renewable|\bgrid\b|electrif|clean cooking/i },
  { id: 'water', label: 'Water & sanitation', pattern: /\bwater|sanitation|\bwash\b|hygiene/i },
  { id: 'education', label: 'Education', pattern: /education|\bschools?\b|learning|teacher|literacy|\bstem\b|curricul/i },
  { id: 'technology', label: 'Technology & AI', pattern: /artificial intelligence|machine learning|\bai\b|data science|digital|software|comput|cyber|\bict\b/i },
  { id: 'gender', label: 'Gender & inclusion', pattern: /gender|\bwomen|\bgirls?\b|inclusion|disabilit|youth/i },
  { id: 'governance', label: 'Governance & policy', pattern: /governance|policy|democra|accountab|public sector|rule of law/i },
  { id: 'economic', label: 'Economic development', pattern: /livelihood|enterprise|financial inclusion|poverty|economic|\bsmes?\b|entrepreneur|microfinance/i },
  { id: 'social', label: 'Social sciences', pattern: /social science|behaviou?r|anthropolog|sociolog|psycholog/i },
  { id: 'urban', label: 'Urban & infrastructure', pattern: /\burban|housing|transport|infrastructure|\bcities\b/i },
];

export function themesIn(text: string): Theme[] {
  return THEMES.filter((t) => t.pattern.test(text));
}

/* Countries --------------------------------------------------------- */

const REGION_OF: Record<string, string> = {};
const add = (region: string, names: string[]) => names.forEach((n) => (REGION_OF[n] = region));
add('East Africa', ['Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'Burundi', 'Ethiopia', 'Somalia', 'South Sudan', 'Djibouti', 'Eritrea']);
add('West Africa', ['Nigeria', 'Ghana', 'Senegal', "Côte d'Ivoire", 'Ivory Coast', 'Sierra Leone', 'Liberia', 'Mali', 'Burkina Faso', 'Niger', 'Benin', 'Togo', 'Gambia', 'Guinea']);
add('Southern Africa', ['South Africa', 'Zambia', 'Zimbabwe', 'Malawi', 'Mozambique', 'Botswana', 'Namibia', 'Lesotho', 'Eswatini', 'Madagascar', 'Angola']);
add('Central Africa', ['Cameroon', 'Democratic Republic of the Congo', 'DRC', 'Congo', 'Gabon', 'Chad', 'Central African Republic']);
add('North Africa', ['Egypt', 'Morocco', 'Tunisia', 'Algeria', 'Libya', 'Sudan']);
add('Europe', ['United Kingdom', 'UK', 'Germany', 'France', 'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Italy', 'Spain', 'Belgium', 'Switzerland', 'Ireland', 'Finland', 'Portugal', 'Austria', 'Poland']);
add('North America', ['United States', 'USA', 'Canada']);
add('South Asia', ['India', 'Pakistan', 'Bangladesh', 'Nepal', 'Sri Lanka']);
add('Southeast Asia', ['Indonesia', 'Philippines', 'Vietnam', 'Thailand', 'Malaysia', 'Cambodia']);
add('Latin America', ['Brazil', 'Mexico', 'Colombia', 'Peru', 'Chile', 'Argentina']);

const CANONICAL: Record<string, string> = { UK: 'United Kingdom', USA: 'United States', DRC: 'Democratic Republic of the Congo', 'Ivory Coast': "Côte d'Ivoire" };

export const COUNTRY_NAMES = Object.keys(REGION_OF);

export const canonicalCountry = (name: string) => CANONICAL[name] ?? name;

export function regionOfCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const hit = COUNTRY_NAMES.find((c) => c.toLowerCase() === country.trim().toLowerCase());
  return hit ? REGION_OF[hit]! : null;
}

/** Country names found in a line, longest first so "South Sudan" wins over "Sudan". */
export function countriesIn(line: string): string[] {
  const found: string[] = [];
  let rest = line;
  for (const c of [...COUNTRY_NAMES].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, c.length <= 3 ? '' : 'i');
    if (re.test(rest)) {
      found.push(canonicalCountry(c));
      rest = rest.replace(re, ' ');
    }
  }
  return found;
}

/* Funders ----------------------------------------------------------- */

export const KNOWN_FUNDERS: { name: string; pattern: RegExp }[] = [
  { name: 'Bill & Melinda Gates Foundation', pattern: /gates foundation|\bbmgf\b/i },
  { name: 'Wellcome Trust', pattern: /wellcome/i },
  { name: 'National Institutes of Health (NIH)', pattern: /\bnih\b|national institutes? of health/i },
  { name: 'National Science Foundation (NSF)', pattern: /\bnsf\b|national science foundation/i },
  { name: 'USAID', pattern: /\busaid\b/i },
  { name: 'IDRC', pattern: /\bidrc\b|international development research cent/i },
  { name: 'European Commission (Horizon Europe)', pattern: /horizon (europe|2020)|european commission|\berc\b/i },
  { name: 'UKRI', pattern: /\bukri\b|\bgcrf\b|research councils? uk|\bmrc\b|\besrc\b/i },
  { name: 'FCDO', pattern: /\bfcdo\b|\bdfid\b|foreign,? commonwealth/i },
  { name: 'Ford Foundation', pattern: /ford foundation/i },
  { name: 'Rockefeller Foundation', pattern: /rockefeller/i },
  { name: 'Mastercard Foundation', pattern: /mastercard foundation/i },
  { name: 'African Development Bank', pattern: /african development bank|\bafdb\b/i },
  { name: 'World Bank', pattern: /world bank/i },
  { name: 'Sida', pattern: /\bsida\b|swedish international development/i },
  { name: 'GIZ', pattern: /\bgiz\b/i },
  { name: 'CGIAR', pattern: /\bcgiar\b/i },
  { name: 'African Academy of Sciences', pattern: /african academy of sciences|\baesa\b/i },
  { name: 'Google Research', pattern: /google(\.org| research)/i },
  { name: 'Bezos Earth Fund', pattern: /bezos earth fund/i },
  { name: 'German Academic Exchange Service (DAAD)', pattern: /\bdaad\b/i },
  { name: 'Department of Energy (DOE)', pattern: /department of energy|\bdoe\b/i },
  { name: 'National Research Fund Kenya', pattern: /national research fund|\bnrf kenya\b/i },
];

/** The canonical funder named in a text, if any. */
export function funderIn(text: string): string | null {
  return KNOWN_FUNDERS.find((f) => f.pattern.test(text))?.name ?? null;
}

/** Two funder names refer to the same funder (canonical name, or one contains the other). */
export function sameFunder(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = funderIn(a) ?? a;
  const cb = funderIn(b) ?? b;
  const na = ca.toLowerCase().replace(/\([^)]*\)/g, '').trim();
  const nb = cb.toLowerCase().replace(/\([^)]*\)/g, '').trim();
  return na === nb || na.includes(nb) || nb.includes(na);
}

/* Money ------------------------------------------------------------- */

// Rough conversion to USD so award sizes in different currencies can be
// compared. Approximate by design: capacity fit is banded, not exact.
const USD_PER: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, KES: 0.0077, UGX: 0.00027, TZS: 0.00039, ZAR: 0.055, NGN: 0.00065, CHF: 1.12, CAD: 0.73, SEK: 0.095 };

export const toUsd = (amount: number, currency: string) => amount * (USD_PER[currency.toUpperCase()] ?? 1);

const CURRENCY_TOKEN: [RegExp, string][] = [
  [/^(us\$|usd|\$)$/i, 'USD'],
  [/^(€|eur|euros?)$/i, 'EUR'],
  [/^(£|gbp)$/i, 'GBP'],
  [/^(ksh|kshs|kes)$/i, 'KES'],
  [/^(ugx)$/i, 'UGX'],
  [/^(tzs)$/i, 'TZS'],
  [/^(zar|r)$/i, 'ZAR'],
  [/^(ngn|₦)$/i, 'NGN'],
  [/^(chf)$/i, 'CHF'],
  [/^(sek)$/i, 'SEK'],
];

/** The first money amount in a line: "$250,000", "KES 1.2 million", "€ 50k". */
export function moneyIn(line: string): { amount: number; currency: string } | null {
  const m = line.match(/(US\$|USD|\$|€|EUR|£|GBP|KSh?s?|KES|UGX|TZS|ZAR|NGN|CHF|SEK)\s?([\d][\d,]*(?:\.\d+)?)\s?(k|m|bn|million|thousand|billion)?\b/i);
  if (!m) return null;
  const currency = CURRENCY_TOKEN.find(([re]) => re.test(m[1]!))?.[1] ?? 'USD';
  let amount = Number(m[2]!.replace(/,/g, ''));
  const scale = m[3]?.toLowerCase();
  if (scale === 'k' || scale === 'thousand') amount *= 1_000;
  else if (scale === 'm' || scale === 'million') amount *= 1_000_000;
  else if (scale === 'bn' || scale === 'billion') amount *= 1_000_000_000;
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
}

/* Keywords ---------------------------------------------------------- */

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours
  using use used based new including include within across work works worked project projects research researcher researchers study studies university department institute programme program grant grants award awarded funding fund team member members role lead led senior junior year years month months current present email phone address page`.split(/\s+/),
);

/** Frequent terms and two-word phrases (appearing at least `minCount` times), most frequent first. */
export function topTerms(text: string, limit = 15, minCount = 2): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
  const counts = new Map<string, number>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (STOPWORDS.has(w) || w.length < 4) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
    const next = words[i + 1];
    if (next && !STOPWORDS.has(next) && next.length >= 4) {
      const bigram = `${w} ${next}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1.5); // phrases are more telling
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    // drop a single word already covered by a chosen phrase
    .filter((t, _i, all) => t.includes(' ') || !all.some((o) => o.includes(' ') && o.split(' ').includes(t) && all.indexOf(o) < all.indexOf(t)))
    .slice(0, limit);
}
