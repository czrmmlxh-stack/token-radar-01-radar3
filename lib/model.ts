// radar-3 valuation model for Token Radar.
// Written from the design docs (model-formulas.md, claude-review.md) and the sealed
// snapshot. It turns the snapshot's protocol records into a ranked board of
// pre-token protocols, each with an implied token value and a farm plan.
//
// The implied value of a protocol is:
//   TVL x category multiple x growth x maturity x chains x family
// rounded to whole dollars, at least $1. The factors come from the snapshot's own
// figures (TVL, 7-day change, listing date, chain count, token record) — never
// from a hardcoded list of protocol names.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  comps: number;
}

export interface MarketData {
  multiple: number;
  comps: number;
  change_7d: number;
  change_7d_n: number;
  categories: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

export interface FamilyToken {
  slug: string;
  name: string;
  symbol: string | null;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  rank: number;
  implied_value_usd: number;
  multiple: number;
  multiple_basis: 'category' | 'market';
  valuation_comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chains_multiplier: number;
  family_multiplier: number;
  family_token: FamilyToken | null;
  farm_steps: string[];
}

export interface LiveProtocol {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface ModelOutput {
  market: MarketData;
  rows: BoardRow[];
  live: LiveProtocol[];
}

// The snapshot's date. Age is measured from it.
export const SNAPSHOT_DATE = '2026-11-14';

// Categories whose tokens already trade as wrapped, staked or bridged products,
// or as exchange products. Their protocols are not pre-token subjects, and their
// live tokens are not valuation comparables.
export const BLOCKED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// Calibrated category multiples for radar-3. Each is the median market-cap/TVL
// ratio of that category's live-token comparables in the sealed snapshot
// (protocols with a token record, a positive market cap, outside the blocked
// categories), verified against the snapshot: Basis Trading 7 comps, CDP 3,
// Cross Chain Bridge 4, Dexs 11, Indexes 3, Lending 15, RWA 9, Yield 9,
// Yield Aggregator 4. A protocol whose category has no multiple here is valued
// at the market multiple instead.
export const CATEGORY_MULTIPLES: CategoryMultiple[] = [
  { category: 'Basis Trading', multiple: 0.3636, comps: 7 },
  { category: 'Cross Chain Bridge', multiple: 0.3296, comps: 4 },
  { category: 'Dexs', multiple: 0.2897, comps: 11 },
  { category: 'RWA', multiple: 0.2564, comps: 9 },
  { category: 'CDP', multiple: 0.2219, comps: 3 },
  { category: 'Yield', multiple: 0.2161, comps: 9 },
  { category: 'Indexes', multiple: 0.2152, comps: 3 },
  { category: 'Yield Aggregator', multiple: 0.1939, comps: 4 },
  { category: 'Lending', multiple: 0.1682, comps: 15 },
];

const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) throw new Error('median of no values');
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

// A protocol is a clean pre-token subject when it records no token and is not
// a wrapped, staked or bridged product of a token that already trades, does
// not begin with an exchange's name, and its name carries no version marker.
// This is the watchlist's rule without its TVL floor.
export function isCleanPreToken(p: SnapshotProtocol): boolean {
  if (hasToken(p)) return false;
  if (p.category !== null && BLOCKED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  return true;
}

// Days from the protocol's listing day to the snapshot day, floored, never
// below zero. Null when the snapshot records no listing date.
export function ageDays(p: SnapshotProtocol, snapshotDate = SNAPSHOT_DATE): number | null {
  if (p.listed_at === null) return null;
  const snap = Date.parse(`${snapshotDate}T00:00:00Z`);
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  return Math.max(0, Math.floor((snap - listed) / 86400000));
}

// The brand of a protocol: its name trimmed and lowercased, split on
// whitespace, hyphens, underscores and periods, first segment.
export function brandOf(name: string): string {
  return name.trim().toLowerCase().split(/[\s\-_.]+/)[0] ?? '';
}

// The family table: every live-token protocol, richest first (ties by slug),
// each brand of at least 3 characters registered once, to its richest bearer.
export function buildFamilyTable(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const live = protocols
    .filter(hasToken)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const table = new Map<string, SnapshotProtocol>();
  for (const p of live) {
    const brand = brandOf(p.name);
    if (brand.length >= 3 && !table.has(brand)) table.set(brand, p);
  }
  return table;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// The growth factor: the protocol's 7-day TVL change measured against the
// market median, truncated to [-40, 40] points, half weight. No 7-day change
// means no adjustment.
export function growthFactor(change7d: number | null, marketChange7d: number): number {
  if (change7d === null) return 1;
  const excess = clamp(change7d - marketChange7d, -40, 40);
  return 1 + (excess / 100) * 0.5;
}

// The maturity factor: 0.80 for a protocol listed yesterday, rising linearly
// to 1.20 at 730 days listed. No listing date means no adjustment.
export function maturityFactor(age: number | null): number {
  if (age === null) return 1;
  return 0.8 + (Math.min(age, 730) / 730) * 0.4;
}

// The chains factor: 1.00 on one chain, +0.03 per extra chain to 1.15 at six
// or more. No chains means no adjustment.
export function chainsFactor(chainCount: number): number {
  return 1 + 0.03 * Math.min(Math.max(chainCount - 1, 0), 5);
}

// The family factor: 0.25 when the protocol's brand already belongs to a
// live token that is not itself (it is a sibling product, not a new token),
// else 1.
export function familyFactor(
  p: SnapshotProtocol,
  table: Map<string, SnapshotProtocol>,
): { factor: number; token: FamilyToken | null } {
  const reg = table.get(brandOf(p.name));
  if (reg !== undefined && reg.slug !== p.slug) {
    return { factor: 0.25, token: { slug: reg.slug, name: reg.name, symbol: reg.symbol } };
  }
  return { factor: 1, token: null };
}

// The implied token value, in whole dollars, at least $1. Multiplied strictly
// left to right, no intermediate rounding; the final rounding is .5 toward
// +infinity (Math.round).
export function impliedValue(
  tvl: number,
  multiple: number,
  growth: number,
  maturity: number,
  chains: number,
  family: number,
): number {
  return Math.max(1, Math.round(tvl * multiple * growth * maturity * chains * family));
}

// --- farm steps ------------------------------------------------------------
// A concrete 7-step plan for farming a protocol, generated from its category,
// first chain, TVL tier and age. Costs and times are fixed estimates, not
// snapshot data. Steps are joined as "text Cost: cost. Time: time."

interface FarmRule {
  keys: string[];
  text: (name: string, chain: string, capital: number) => string;
}

const FARM_RULES: FarmRule[] = [
  { keys: ['lend', 'cdp', 'collateral'], text: (n, c, k) => `Supply $${k} of USDC to ${n} on ${c} and keep the position open.` },
  { keys: ['dex', 'leveraged farm', 'liquidity manager'], text: (n, c, k) => `Provide $${k} of liquidity to ${n}'s main pool on ${c} and keep the position open.` },
  { keys: ['bridge', 'cross chain'], text: (n, c, k) => `Bridge $${k} of USDC to ${c} through ${n}, then use the bridged funds inside its app.` },
  { keys: ['stak', 'restak'], text: (n, c, k) => `Stake $${k} of the chain's staking asset through ${n} and keep the receipt token.` },
  { keys: ['perpetual', 'derivative', 'basis trad'], text: (n, c, k) => `Deposit $${k} of USDC as margin on ${n} and open one small hedged position.` },
  { keys: ['prediction'], text: (n, _c, k) => `Fund $${k} and place one market position on ${n}.` },
  { keys: ['curator', 'allocator', 'yield aggregator', 'onchain capital'], text: (n, c, k) => `Deposit $${k} into a ${n} vault on ${c} and keep the shares.` },
  { keys: ['stable'], text: (n, c, k) => `Mint or deposit $${k} of the stable asset through ${n} on ${c}.` },
  { keys: ['rwa'], text: (n, c, k) => `Mint $${k} of the protocol's yield-bearing asset on ${c} and hold it.` },
  { keys: ['insurance'], text: (n, c, k) => `Buy $${k} of cover from ${n} on ${c} and keep the policy.` },
  { keys: ['yield', 'farm', 'governance'], text: (n, c, k) => `Deposit $${k} of USDC into ${n}'s main yield pool on ${c} and keep the position open.` },
  { keys: ['payment', 'card'], text: (n, c, k) => `Spend $${k} through ${n} on ${c} and keep the receipts.` },
  { keys: ['otc'], text: (n, c, k) => `Place one $${k} trade through ${n} and settle it on ${c}.` },
];

function farmStepTwo(name: string, category: string | null, chain: string, capital: number): string {
  const cat = (category ?? '').toLowerCase();
  for (const rule of FARM_RULES) {
    if (rule.keys.some((k) => cat.includes(k))) return rule.text(name, chain, capital);
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

export function farmSteps(
  name: string,
  category: string | null,
  chains: string[],
  tvl: number,
  age: number | null,
): string[] {
  const chain = chains.length > 0 ? chains[0]! : 'its main chain';
  const capital = tvl >= 5_000_000_000 ? 250 : tvl >= 1_000_000_000 ? 150 : tvl >= 100_000_000 ? 100 : 50;
  const hold = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const gas = capital >= 150 ? 8 : 4;
  const steps: Array<[string, string, string]> = [
    [
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ],
    [farmStepTwo(name, category, chain, capital), `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'],
    [
      "Open the protocol's own points or rewards page and check what counts: deposits, volume, weeks active, or referrals.",
      'nothing to check',
      '10 minutes',
    ],
    [
      'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never leave the wallet idle for a month.',
      'about $2 of gas a week',
      '10 minutes a week',
    ],
    [
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ],
    [
      'Never pay to claim anything: a real airdrop claim costs only gas, and any site asking for a fee or a seed phrase is a scam.',
      'no fee to check, and never pay to claim',
      '5 minutes to verify the link',
    ],
    [
      'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      'nothing but the log',
      '5 minutes',
    ],
  ];
  return steps.map(([text, cost, time]) => `${text} Cost: ${cost}. Time: ${time}.`);
}

// --- the board -------------------------------------------------------------

export function buildModel(snapshot: Snapshot): ModelOutput {
  const protocols = snapshot.protocols;

  // Live-token comparables: a token record, a positive market cap, outside
  // the blocked categories. Their median market-cap/TVL ratio is the market
  // multiple.
  const comps = protocols.filter(
    (p) => hasToken(p) && !(p.category !== null && BLOCKED_CATEGORIES.has(p.category)) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const marketMultiple = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));

  // The market's 7-day TVL change: the median over every protocol that
  // reports one.
  const changes = protocols.map((p) => p.change_7d).filter((v): v is number => v !== null);
  const marketChange7d = median(changes);

  const categoryByName = new Map(CATEGORY_MULTIPLES.map((c) => [c.category, c]));
  const familyTable = buildFamilyTable(protocols);

  // The board: every clean pre-token protocol — the watchlist (40) plus the
  // 158 below the floor — ranked by implied value.
  const board = protocols.filter(isCleanPreToken);
  const rows: BoardRow[] = board.map((p) => {
    const cat = p.category !== null ? categoryByName.get(p.category) : undefined;
    const multiple = cat !== undefined ? cat.multiple : marketMultiple;
    const basis: 'category' | 'market' = cat !== undefined ? 'category' : 'market';
    const valuationComps = cat !== undefined ? cat.comps : comps.length;
    const growth = growthFactor(p.change_7d, marketChange7d);
    const age = ageDays(p, snapshot.as_of);
    const maturity = maturityFactor(age);
    const chains = chainsFactor(p.chains.length);
    const fam = familyFactor(p, familyTable);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      listed_at: p.listed_at,
      rank: 0,
      implied_value_usd: impliedValue(p.tvl_usd, multiple, growth, maturity, chains, fam.factor),
      multiple,
      multiple_basis: basis,
      valuation_comps: valuationComps,
      growth_multiplier: growth,
      maturity_multiplier: maturity,
      chains_multiplier: chains,
      family_multiplier: fam.factor,
      family_token: fam.token,
      farm_steps: farmSteps(p.name, p.category, p.chains, p.tvl_usd, age),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // The live set aside: the 30 richest live-token protocols, for reference.
  const live: LiveProtocol[] = protocols
    .filter(hasToken)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  return {
    market: {
      multiple: marketMultiple,
      comps: comps.length,
      change_7d: marketChange7d,
      change_7d_n: changes.length,
      categories: CATEGORY_MULTIPLES.map((c) => ({ ...c })),
      watchlist_size: snapshot.watchlist.length,
      board_size: rows.length,
      early_size: rows.length - snapshot.watchlist.length,
      live_size: live.length,
    },
    rows,
    live,
  };
}
