// #2829 W7b — §7 checks 1–4 for every captured page: height, pixel mismatch,
// 64×64 tile guard, with only the declared exclusion boxes masked. Writes the
// diff PNGs and report.json into --out (private; never the repository).
//
//   node e2e/ys-parity/compare.mjs --baseline <dir> --out <run dir>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { compareScreens, PARITY_LIMITS } from "../parity-metrics.mjs";
import { args, assertOutsideRepo, exclusionBoxes } from "./lib.mjs";

const options = args(process.argv.slice(2), ["baseline", "out"]);
const out = assertOutsideRepo(resolve(options.out));
const capture = JSON.parse(readFileSync(resolve(out, "capture.json"), "utf8"));
const styles = existsSync(resolve(out, "styles.json")) ? JSON.parse(readFileSync(resolve(out, "styles.json"), "utf8")) : null;
const semantics = existsSync(resolve(out, "semantics.json")) ? JSON.parse(readFileSync(resolve(out, "semantics.json"), "utf8")) : null;

const rows = [];
for (const page of capture.pages) {
  const key = `${page.name}-${page.width}`;
  const boxes = exclusionBoxes(page.boxes, page.width);
  const result = compareScreens(readFileSync(resolve(options.baseline, `${key}.png`)), readFileSync(resolve(out, `${key}.png`)), { boxes });
  writeFileSync(resolve(out, `${key}.diff.png`), result.diffPng);
  rows.push({
    page: page.name,
    width: page.width,
    status: page.status,
    height: { baseline: result.baselineHeight, ours: result.oursHeight, delta: result.heightDelta },
    mismatch_pct: Number((result.mismatchRatio * 100).toFixed(3)),
    mismatch_limit_pct: result.mismatchLimit * 100,
    worst_tile: { x: result.worstTile.x, y: result.worstTile.y, pct: Number((result.worstTile.ratio * 100).toFixed(1)) },
    tiles_over_limit: result.tilesOver,
    exclusion_boxes: boxes,
    pass: result.pass,
    ok: result.pass.height && result.pass.pixels && result.pass.tiles && page.status === 200 || (page.name === "404" && page.status === 404 && result.pass.height && result.pass.pixels && result.pass.tiles),
  });
}
const report = {
  limits: PARITY_LIMITS,
  consent_state: capture.consent_state,
  origin: capture.origin,
  captured_at: capture.captured_at,
  offsite_requests: capture.offsite_requests,
  pages: rows,
  styles: styles ? { pass: styles.pass, failing: styles.entries.filter((e) => !e.ok), dropped: styles.dropped, fonts_ok: styles.fonts.every((f) => f.ok), third_party_scripts: styles.scripts.flatMap((s) => s.third_party) } : null,
  semantics,
  pass: rows.every((row) => row.ok) && (styles ? styles.pass : false) && (semantics ? semantics.pass : false) && capture.offsite_requests.length === 0,
};
writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write("page                  width  h.base  h.ours  Δh   mism%  limit  worst tile (x,y,%)   tiles>20%  ok\n");
for (const row of rows) {
  process.stdout.write(`${row.page.padEnd(22)}${String(row.width).padEnd(7)}${String(row.height.baseline).padEnd(8)}${String(row.height.ours).padEnd(8)}${String(row.height.delta).padEnd(5)}${String(row.mismatch_pct).padEnd(7)}${String(row.mismatch_limit_pct).padEnd(7)}${`${row.worst_tile.x},${row.worst_tile.y},${row.worst_tile.pct}`.padEnd(21)}${String(row.tiles_over_limit).padEnd(11)}${row.ok ? "PASS" : "FAIL"}\n`);
}
process.stdout.write(`styles: ${styles ? (styles.pass ? "PASS" : "FAIL") : "not run"}; semantics: ${semantics ? (semantics.pass ? "PASS" : "FAIL") : "not run"}; offsite requests: ${capture.offsite_requests.length}; overall ${report.pass ? "PASS" : "FAIL"}\n`);
