// Geographic eligibility, shared by the Grant Explorer filter (browser)
// and the matcher (server). Grant listings describe regions in free text
// ("Sub-Saharan Africa", "Global / Low-and-Middle Income Countries
// prioritized", "Worldwide"), so eligibility is decided by meaning, not by
// an exact string match. Pure: no imports, no environment.

const test = (re: RegExp) => (region: string) => re.test(region.toLowerCase());

const EAST_AFRICA =
  /\bkenya|uganda|tanzania|rwanda|burundi|ethiopia|somalia|somaliland|south sudan|djibouti|eritrea|east(ern)? africa|horn of africa|\beac\b/;

/** Calls that name Kenya. */
export const isKenya = test(/\bkenya/);

/** East African countries and regions, Kenya included. */
export const isEastAfrica = test(EAST_AFRICA);

/** Anywhere in Africa: the continent, its sub-regions, or an African country by name. */
export const isAfrica = (region: string) =>
  isEastAfrica(region) ||
  test(/\bafrica|nigeria|ghana|senegal|cameroon|egypt|morocco|tunisia|algeria|zambia|zimbabwe|malawi|mozambique|botswana|namibia|madagascar|sahel|maghreb/)(region);

/** Low- and middle-income and developing regions, Africa included. */
export const isGlobalSouth = (region: string) =>
  isAfrica(region) ||
  test(
    /global south|developing (countries|nations|economies)|low[- ]?(and|&)[- ]?middle|\blmics?\b|\blics?\b|least developed|\bldcs?\b|south asia|southeast asia|latin america|caribbean|pacific island|small island developing/,
  )(region);

/**
 * Open to applicants anywhere, so to Kenya, East Africa and Africa too:
 * "Global", "Worldwide", "International", "Any country". Global calls that
 * exclude someone else ("excluding Germany residents") or fix where the
 * work happens ("to conduct research in Europe") still accept Kenyan
 * applicants, so they count.
 */
export const isWorldwide = test(/^\s*global\b|worldwide|world-wide|\binternational\b|any country|all countries|open to all|no geographic restriction/);

export type RegionFilterId = 'africa';

/** Grant Explorer region options decided by meaning rather than by name. */
export const REGION_FILTERS: { id: RegionFilterId; label: string; hint: string; matches: (region: string) => boolean }[] = [
  {
    id: 'africa',
    label: 'Africa',
    hint: 'African countries and Africa-wide calls, including Kenya, East Africa and Sub-Saharan Africa.',
    matches: isAfrica,
  },
];

/** Does a grant listing these regions fall under the chosen filter? */
export function grantMatchesRegionFilter(grantRegions: string[], filterId: string): boolean {
  const filter = REGION_FILTERS.find((f) => f.id === filterId);
  return filter ? grantRegions.some(filter.matches) : false;
}

/**
 * Can an applicant based in `applicantRegion` apply to a call open to
 * `grantRegion`? Worldwide calls are open to everyone; a Kenya-based
 * applicant also qualifies for East African, African and Global South
 * calls; otherwise the region names must overlap.
 */
export function applicantRegionEligible(grantRegion: string, applicantRegion: string | null | undefined): boolean {
  if (isWorldwide(grantRegion)) return true;
  const applicant = (applicantRegion ?? '').trim();
  if (!applicant) return false;
  if (isKenya(applicant)) return isKenya(grantRegion) || isAfrica(grantRegion) || isGlobalSouth(grantRegion);
  if (isEastAfrica(applicant)) return isEastAfrica(grantRegion) || isAfrica(grantRegion) || isGlobalSouth(grantRegion);
  if (isAfrica(applicant)) return isAfrica(grantRegion) || isGlobalSouth(grantRegion);
  const g = grantRegion.toLowerCase();
  const a = applicant.toLowerCase();
  return g.includes(a) || a.includes(g);
}

/**
 * The catalogue rule: GrantSeeker lists calls that applicants based in
 * Africa (Sub-Saharan Africa included) can apply to. A call qualifies when
 * any eligible region names Africa or an African country, is worldwide or
 * international, or targets low- and middle-income countries. Calls open
 * only to, say, the United States or the European Union do not.
 */
export const isOpenToAfrica = (regions: string[]): boolean =>
  regions.some((r) => isAfrica(r) || isWorldwide(r) || isGlobalSouth(r));

const AFRICAN_PLACES: [RegExp, string][] = [
  [/sub-?saharan africa/i, 'Sub-Saharan Africa'],
  [/east(ern)? africa/i, 'East Africa'],
  [/west(ern)? africa/i, 'West Africa'],
  [/southern africa/i, 'Southern Africa'],
  [/\bafrica\b/i, 'Africa'],
  [/\bkenya/i, 'Kenya'],
  [/\buganda/i, 'Uganda'],
  [/\btanzania/i, 'Tanzania'],
  [/\brwanda/i, 'Rwanda'],
  [/\bethiopia/i, 'Ethiopia'],
  [/\bnigeria/i, 'Nigeria'],
  [/\bghana/i, 'Ghana'],
  [/\bsouth africa\b/i, 'South Africa'],
  [/\bsenegal/i, 'Senegal'],
  [/\bmalawi/i, 'Malawi'],
  [/\bzambia/i, 'Zambia'],
  [/\bmozambique/i, 'Mozambique'],
];

// "Foreign organizations are eligible", "non-U.S. entities may apply",
// "Non-domestic (non-US) Entities (Foreign Organizations)" and the like.
const FOREIGN_ELIGIBLE =
  /(foreign|non-?\s?u\.?\s?s\.?|non-?domestic|international|overseas)\s+(\(non-?u\.?s\.?\)\s+)?(organi[sz]ations?|entities|institutions?|applicants?|universities|ngos?|governments?|public international organi[sz]ations?)[^.;]{0,120}?\b(are|is|will be)?\s*(eligible|may apply|can apply|welcome)|non-?domestic \(non-?us\) entities|eligible applicants? (include|are)[^.;]{0,160}(foreign|non-?u\.?s\.?|international)/i;
const FOREIGN_INELIGIBLE =
  /(foreign|non-?\s?u\.?\s?s\.?|non-?domestic|international|overseas)\s+(organi[sz]ations?|entities|institutions?|applicants?|components?)[^.;]{0,80}?\b(are not|is not|not)\s+(eligible|allowed|permitted)|(only|limited to)[^.;]{0,60}\b(u\.?s\.?|domestic|united states)\b[^.;]{0,40}(organi[sz]ations?|entities|institutions?|applicants?)/i;

/**
 * Regions a call is open to, read from its eligibility and description
 * text, for sources that do not state regions themselves (Grants.gov lists
 * US federal calls, some of which accept foreign organisations).
 */
export function regionsFromEligibilityText(baseRegions: string[], text: string): string[] {
  const out = [...baseRegions];
  // "U.S." → "US", so its full stops do not read as sentence ends.
  const t = text.replace(/\s+/g, ' ').replace(/\bU\.\s?S\.(?=[\s,;)]|$)/gi, 'US');
  // A call can be *about* Africa yet open only to US organisations, so
  // African places count only once foreign applicants are allowed.
  if (!FOREIGN_ELIGIBLE.test(t) || FOREIGN_INELIGIBLE.test(t)) return out.slice(0, 30);
  out.push('International (non-U.S. organisations eligible)');
  for (const [re, name] of AFRICAN_PLACES) if (re.test(t) && !out.includes(name)) out.push(name);
  return out.slice(0, 30);
}
