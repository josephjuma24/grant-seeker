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
