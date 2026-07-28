#!/usr/bin/env node
// I-ZUSTAND-PERSIST-DEBOUNCED — ORCH-0675 Wave 1 protection.
//
// The Zustand persist storage adapter MUST use the debounced wrapper (not raw
// AsyncStorage), and an AppState 'change' listener MUST flush pending writes on
// background/inactive so app-kill mid-debounce does not lose recent state.
//
// PORTED from check-zustand-persist-debounced.sh to .mjs (issue #967 D-8
// dark-gate triage) so meta-1383 P11 sweeps it and run-batch enforces it.
//
// Negative-control: replace `createJSONStorage(() => debouncedAsyncStorage)`
// with `createJSONStorage(() => AsyncStorage)` → run this gate → exit 1 →
// revert → exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..", ".."); // app-mobile/
const TARGET = "src/store/appStore.ts";

export function check(read) {
  const failures = [];
  const src = read(TARGET);
  if (src == null) { failures.push(`I-ZUSTAND-PERSIST-DEBOUNCED: ERROR — ${TARGET} not found`); return failures; }
  if (!src.includes("debouncedAsyncStorage")) failures.push(`I-ZUSTAND-PERSIST-DEBOUNCED violation: debouncedAsyncStorage wrapper not found in ${TARGET}.`);
  if (!src.includes("createJSONStorage(() => debouncedAsyncStorage)")) failures.push("I-ZUSTAND-PERSIST-DEBOUNCED violation: createJSONStorage must reference debouncedAsyncStorage.");
  if (src.includes("createJSONStorage(() => AsyncStorage)")) failures.push("I-ZUSTAND-PERSIST-DEBOUNCED violation: raw AsyncStorage adapter still present (bypasses debounce).");
  if (!/(AppState|RNAppState)\.addEventListener\(['"]change['"]/.test(src)) failures.push("I-ZUSTAND-PERSIST-DEBOUNCED violation: AppState background flush listener missing. Pending writes are LOST on app kill.");
  if (!src.includes("flushPendingWrites")) failures.push("I-ZUSTAND-PERSIST-DEBOUNCED violation: flushPendingWrites function missing.");
  return failures;
}

function realRun() {
  const read = (rel) => {
    try { return fs.readFileSync(path.join(APP_ROOT, rel), "utf8"); } catch { return null; }
  };
  const failures = check(read);
  if (failures.length) { for (const f of failures) console.error(f); console.error(`\nI-ZUSTAND-PERSIST-DEBOUNCED: ${failures.length} violation(s).`); process.exit(1); }
  console.log("I-ZUSTAND-PERSIST-DEBOUNCED: PASS");
}

function selfTest() {
  const cases = [];
  const t = (name, read, shouldFail) => {
    const f = check(read);
    cases.push({ name, ok: (f.length > 0) === shouldFail, f });
  };
  const good = `const debouncedAsyncStorage = wrap();
storage: createJSONStorage(() => debouncedAsyncStorage),
RNAppState.addEventListener('change', () => flushPendingWrites());
function flushPendingWrites() {}`;
  t("compliant store passes", () => good, false);
  t("raw AsyncStorage adapter fails", () => good.replace("() => debouncedAsyncStorage)", "() => AsyncStorage)") + "\ncreateJSONStorage(() => AsyncStorage)", true);
  t("missing AppState listener fails", () => good.replace(/RNAppState\.addEventListener[^\n]*\n/, ""), true);
  t("missing flushPendingWrites fails", () => good.replace(/flushPendingWrites/g, "noop"), true);
  t("missing file fails", () => null, true);
  let bad = 0;
  for (const c of cases) { console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`); if (!c.ok) { bad++; console.log(JSON.stringify(c.f)); } }
  if (bad) { console.error(`\nself-test FAILED: ${bad}/${cases.length}`); process.exit(1); }
  console.log(`\ncheck-zustand-persist-debounced self-test: ${cases.length}/${cases.length} PASS`);
}

if (process.argv.includes("--self-test")) selfTest();
else realRun();
