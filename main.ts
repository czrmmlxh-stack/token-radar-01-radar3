// Token Radar radar-3: the entrypoint.
// Reads the sealed snapshot, builds the ranked board, writes the dashboard's
// data beside the page, copies the dashboard and screenshots to the output
// directory, and writes the dossier the judge reads.
//
// Usage: node main.ts --input /input/snapshot.json
//   The output directory is MAKEFUN_OUTPUT_DIR, default /output.
//   Locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildModel } from './lib/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input: string } {
  let input = '/input/snapshot.json';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[++i]!;
  }
  return { input };
}

function main(): void {
  const { input } = parseArgs(process.argv.slice(2));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  const snapshot = JSON.parse(readFileSync(input, 'utf8'));
  const model = buildModel(snapshot);

  // A fresh, deterministic output tree.
  const dashOut = join(outDir, 'dashboard');
  const shotsOut = join(outDir, 'screenshots');
  for (const dir of [dashOut, shotsOut]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(outDir, { recursive: true });

  // The dashboard and its screenshots, as shipped.
  cpSync(join(HERE, 'dashboard'), dashOut, { recursive: true });
  cpSync(join(HERE, 'screenshots'), shotsOut, { recursive: true });

  // The dashboard's data, beside the page. The page reads every number from
  // window.RADAR and nothing else; the farm steps are written here verbatim
  // by the model, so the page only displays them.
  const radar = {
    snapshotDate: snapshot.as_of,
    modelVersion: 'radar-3',
    market: model.market,
    rows: model.rows,
    live: model.live,
  };
  writeFileSync(join(dashOut, 'data.js'), `window.RADAR = ${JSON.stringify(radar)};\n`, 'utf8');

  // The ranked board.
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: model.rows }, null, 2)}\n`, 'utf8');

  // The dossier the judge reads: the screenshots plus the dashboard's source.
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

  console.log(
    `token-radar radar-3: ${model.rows.length} rows, market ${model.market.multiple.toFixed(4)} ` +
      `(${model.market.comps} comps), top ${model.rows[0]?.slug} $${model.rows[0]?.implied_value_usd}`,
  );
}

main();
