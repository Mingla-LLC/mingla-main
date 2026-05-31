#!/usr/bin/env node

/**
 * I-BOTTOMSHEET-INLINE-SCROLL-BINDING (ORCH-1016 invariant)
 *
 * THE BUG (root-caused + measured on-device, ORCH-1016): gorhom's
 * `BottomSheetScrollView` only gets a bounded viewport — and therefore only
 * scrolls — when it is effectively the DIRECT child of `BottomSheetContent`.
 * The moment a sheet wraps its scroll in a gorhom `BottomSheetView` (which is
 * what BaseBottomSheet's `header`, `stickyFooter`, or `bodyContainerStyle`
 * branches do), gorhom sizes the sheet to that wrapper's CONTENT height, so the
 * scroll viewport == content, maxScroll == 0, and the body FREEZES — the last
 * row / Buy / Reserve CTA can never be reached. Proven: trip detail 1319/1319,
 * ticket sheet 1017/1017, all maxScroll 0.
 *
 * This is INVISIBLE for sheets rendered via `wrapInRNModal` (the RN Modal gives
 * gorhom a bounded full-screen parent, so the wrapped scroll still binds) — so
 * the bug only bites INLINE sheets (rendered below the floating GlassBottomNav).
 *
 * THE RULE: an INLINE BaseBottomSheet (no `wrapInRNModal`) MUST NOT wrap its
 * scroll. It must use a BARE `scrollMode="scroll"` (scroll = direct child) and,
 * if it has a Buy/Reserve CTA, `hidesBottomNav` so the CTA isn't painted over.
 * If a `header` / `stickyFooter` / `bodyContainerStyle` is genuinely needed on an
 * inline sheet, the file must carry an explicit `@sheet-scroll-ok: <reason>`
 * directive certifying it was verified to scroll on-device (e.g. content is
 * always short and never overflows).
 *
 * This gate is BOTH the alarm (lists every at-risk sheet) and the preventor
 * (fails CI on any NEW inline wrapped-scroll sheet).
 *
 * Scope: app-mobile/src (the consumer app).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_DIR = "app-mobile/src";

// Files explicitly certified safe (verified on-device, or content always short).
// Add a file here ONLY after proving it scrolls end-to-end on a real device,
// and prefer the `@sheet-scroll-ok:` in-file directive for traceability.
const ALLOWLIST = new Set([
  // ExpandedBusinessEventSheet injects a scroll into the shared PublicEventPage
  // (scrollMode="view") but passes NO header/stickyFooter/bodyContainerStyle, so
  // the injected scroll is the direct child — verified bound on-device (ORCH-1016).
  "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
]);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      yield* walk(full);
    } else if (e.name.endsWith(".tsx")) {
      yield full;
    }
  }
}

const violations = [];
const root = path.join(repoRoot, TARGET_DIR);

for (const file of walk(root)) {
  const rel = path.relative(repoRoot, file);
  if (ALLOWLIST.has(rel)) continue;
  const src = fs.readFileSync(file, "utf8");

  // Only sheets matter.
  if (!src.includes("BaseBottomSheet")) continue;
  // In-file opt-out for genuinely-short verified sheets.
  if (src.includes("@sheet-scroll-ok")) continue;
  // wrapInRNModal (real prop, not a comment) gives gorhom a bounded parent → safe.
  if (/^\s*wrapInRNModal\b/m.test(src) || /\bwrapInRNModal=\{?true/.test(src))
    continue;

  // Inline + a scroll-WRAPPING prop = the frozen-scroll anti-pattern.
  const wrappers = [];
  if (/\bstickyFooter=\{/.test(src)) wrappers.push("stickyFooter");
  if (/\bbodyContainerStyle=\{/.test(src)) wrappers.push("bodyContainerStyle");
  if (/\bheader=\{/.test(src) && src.includes("BottomSheetScrollView"))
    wrappers.push("header+scroll");
  if (wrappers.length > 0) {
    violations.push({ rel, wrappers });
  }
}

if (violations.length > 0) {
  console.error(
    "\nFAIL [I-BOTTOMSHEET-INLINE-SCROLL-BINDING]: inline BaseBottomSheet(s) wrap their scroll",
  );
  console.error(
    "  → gorhom won't bind a wrapped scroll inline → frozen body / unreachable CTA.",
  );
  console.error(
    "  FIX: bare scrollMode=\"scroll\" (scroll = direct child) + hidesBottomNav, OR",
  );
  console.error(
    '  use wrapInRNModal, OR add `// @sheet-scroll-ok: <verified reason>` if content is always short.\n',
  );
  for (const v of violations) {
    console.error(`  ✗ ${v.rel}  [${v.wrappers.join(", ")}]`);
  }
  console.error(`\n  ${violations.length} at-risk inline sheet(s).\n`);
  process.exit(1);
}

console.log(
  "OK [I-BOTTOMSHEET-INLINE-SCROLL-BINDING]: no inline BaseBottomSheet wraps its scroll.",
);
