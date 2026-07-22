#!/usr/bin/env node
/**
 * I-1047-BIZ-CREATE-HYDRATION-GATE  (issue #1047)
 *
 * Re-homes the Zustand-persist hydration gate previously pinned by
 * `mingla-business/src/utils/__tests__/orch_0893a_hydration_gate.test.ts`
 * (ORCH-0893 REWORK Part A). That jest file also pinned drifted label copy + an
 * unrelated edit.tsx merge shape and is now quarantined; this additive gate keeps
 * the load-bearing hydration-gate rule (Constitution #14) enforced.
 *
 * THE RULE (fixes the operator-reported "wizard shows up and immediately closes"
 * bug): app/event/create.tsx must NOT mint the d_<ts36> client draft until Zustand
 * persist has hydrated, else hydration's setState replaces the drafts array and
 * wipes the just-minted draft. It must:
 *   - read useDraftEventStore.persist.hasHydrated() + subscribe to onFinishHydration, AND
 *   - short-circuit the mint effect while not hydrated (`if (!hydrated) return`), AND
 *   - mint via useDraftEventStore.getState().createDraft(...) (no subscription staleness).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = fs.readFileSync(path.join(REPO, "mingla-business/app/event/create.tsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violations = [];
if (!/useDraftEventStore\.persist\.hasHydrated\(\)/.test(code)) {
  violations.push("create.tsx no longer reads useDraftEventStore.persist.hasHydrated() — the initial-paint hydration read is gone.");
}
if (!/useDraftEventStore\.persist\.onFinishHydration/.test(code)) {
  violations.push("create.tsx no longer subscribes to useDraftEventStore.persist.onFinishHydration — the post-mount gate flip is gone.");
}
if (!/if\s*\(\s*!hydrated\s*\)\s*return/.test(code)) {
  violations.push("the mint effect no longer short-circuits with `if (!hydrated) return` — the wizard-wipes-draft bug returns.");
}
if (!/useDraftEventStore\.getState\(\)\.createDraft\(/.test(code)) {
  violations.push("create.tsx no longer mints via useDraftEventStore.getState().createDraft(...) — a subscribed selector re-introduces mint-time staleness.");
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-CREATE-HYDRATION-GATE]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-CREATE-HYDRATION-GATE]: hasHydrated + onFinishHydration + !hydrated gate + getState mint intact.");
