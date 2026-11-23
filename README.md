# Token Radar — radar-3

A radar for pre-token DeFi protocols: it estimates what each protocol's token
would be worth if it launched today, ranks all 198 of them, and gives each one
a concrete 7-step farm plan. Everything is computed from a sealed snapshot of
758 protocols (as of 2026-11-14); the page runs fully offline and never
contacts the network.

## The model

A protocol's implied token value is:

```
implied value = TVL x multiple x growth x maturity x chains x family
```

- **TVL** — the protocol's total value locked, from the snapshot.
- **Multiple** — the median market-cap/TVL ratio of that category's live-token
  comparables (94 in all). Categories with too few comparables fall back to
  the market multiple, 0.241x. The nine category multiples are Basis Trading
  0.364x, Cross Chain Bridge 0.330x, Dexs 0.290x, RWA 0.256x, CDP 0.222x,
  Yield 0.216x, Indexes 0.215x, Yield Aggregator 0.194x, Lending 0.168x.
- **Growth** — the protocol's 7-day TVL change measured against the market
  median (-8.23%), truncated to [-40, +40] points, at half weight.
  No 7-day change means no adjustment.
- **Maturity** — 0.80 for a protocol listed yesterday, rising linearly to 1.20
  at 730 days listed. No listing date means no adjustment.
- **Chains** — 1.00 on one chain, +0.03 per extra chain, capped at 1.15
  (six or more chains).
- **Family** — 0.25 when the protocol's brand already belongs to a live token
  that is not itself (it is a sibling product, not a new token), else 1.00.

The result is rounded to whole dollars, at least $1. The board covers all 198
clean pre-token protocols: the 40-protocol watchlist (TVL at or above the
$50M floor) plus the 158 below it. The 30 richest live-token protocols are set
aside as reference, not ranked.

Top of the board: Steakhouse Financial ($863.0M), Sentora Curator ($780.3M),
Gauntlet ($513.2M), Veda ($496.5M), USDD ($289.5M).

## The farm plan

Each protocol gets 7 steps, generated from its category, first chain, TVL tier
and age: a fresh wallet, the one operation that fits its category (supply,
provide liquidity, bridge, stake, deposit margin, and so on), checking what
the protocol's own rewards page counts, one qualifying action a week, holding
for 30–60 days, never paying to claim, and keeping a farm log. Costs and times
are fixed estimates, not snapshot data, and the plan says so.

## The dashboard

`dashboard/` is a plain HTML/CSS/JS page with no framework, no external font
or library, and no network access. It reads every number from `data.js`
(`window.RADAR`), which the backend writes beside the page — including the
farm steps, verbatim. The page re-implements the valuation at full precision
and reproduces the board's implied values exactly; the protocol inspector
shows the recomputation ladder step by step.

The board view shows the ranked table with a top-10 bar chart and the
category multiples. The detail view opens the inspector on the #1 protocol.
The filtered view applies the Dexs category filter. Use `?shot=board`,
`?shot=detail`, or `?shot=filtered` to jump straight to each view.

## How it runs

`main.ts` (Node 22, standard library only) reads the snapshot, builds the
board, writes `board.json` and the dashboard's `data.js`, copies `dashboard/`
and `screenshots/` to the output directory, and writes `dossier.json` with
the kit's `vendor/makefun-board.ts`. Run it locally with:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## Files

- `main.ts` — entrypoint: read snapshot, write board, data, dossier.
- `lib/model.ts` — the radar-3 valuation model and farm-plan generator.
- `dashboard/` — the offline page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — the three board captures (1440x900 each).
- `vendor/makefun-board.ts` — the kit's dossier library (copied verbatim).
