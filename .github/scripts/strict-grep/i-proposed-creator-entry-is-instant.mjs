#!/usr/bin/env node
/**
 * I-PROPOSED-CREATOR-ENTRY-IS-INSTANT strict-grep gate.
 *
 * Every `mingla-business/app/**\/create.tsx` route MUST mount its
 * creator UI without an entry-blocking server mutation. The route MAY
 * mint a client-side `d_<ts36>` id (or equivalent) via the synchronous
 * `useDraftEventStore.createDraft(brandId)` action or `generateDraftId()`
 * helper, and `router.replace` to the resume route. Server-side draft
 * rows are created lazily on the first user-meaningful edit by the
 * resume route's autosave wrapper (event side) or eagerly by the
 * resume route's d_* mount migration (trip side, narrowed-scope —
 * see DISC-0893-TRIP-FIRST-EDIT for follow-up to first-edit-trigger).
 *
 * Forbidden tokens inside any `mingla-business/app/**\/create.tsx`:
 *   - `useMutation`
 *   - `mutateAsync`
 *   - `useCreateServerDraft`
 *   - `useCreateTripDraft`
 *   - `createServerDraft`
 *   - `createTripDraft`
 *
 * Allowlist comment grammar (immediately preceding line, or up to 5
 * lines back to handle multi-line statements):
 *   `// orch-strict-grep-allow creator-entry-is-instant — <reason>`
 *
 * Rationale: ORCH-0893 [Eager server-draft on creator entry — replace
 * with client-id + lazy autosave] established this invariant after the
 * operator-reported "loader on web" symptom traced to a 4-round-trip
 * eager-mutation chain at `app/event/create.tsx` + a 6-round-trip
 * chain at `app/trip/create.tsx`. The reference good patterns are
 * `app/(tabs)/marketing/campaigns/compose.tsx` (lazy auto-save via
 * `useComposerDraft`) and `app/venue/create.tsx` (client-side Zustand
 * draft + 3-phase UI, no entry mutation).
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 *
 * Established by: ORCH-0893 implementation, 2026-05-20.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const APP_ROOT = join(REPO_ROOT, "mingla-business", "app");

const FORBIDDEN_TOKENS = [
  "useMutation",
  "mutateAsync",
  "useCreateServerDraft",
  "useCreateTripDraft",
  "createServerDraft",
  "createTripDraft",
];

const ALLOWLIST_TAG = "orch-strict-grep-allow creator-entry-is-instant";

let violations = 0;
let filesScanned = 0;

function* walkForCreateTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkForCreateTsx(full);
    } else if (entry === "create.tsx") {
      yield full;
    }
  }
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Skip comment lines.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const token of FORBIDDEN_TOKENS) {
      // Match as a word boundary to avoid matching e.g. `createTripDraftMutation`
      // inside a non-creator-route file — but here we already restrict scan to
      // `create.tsx` files, so any occurrence in non-comment code is a real hit.
      const re = new RegExp(`\\b${token}\\b`);
      if (!re.test(line)) continue;
      // Allowlist check — scan up to 5 lines back.
      let allowlisted = false;
      for (let k = i - 1; k >= Math.max(0, i - 5); k -= 1) {
        if (lines[k].includes(ALLOWLIST_TAG)) {
          allowlisted = true;
          break;
        }
      }
      if (allowlisted) continue;
      violations += 1;
      console.error(
        `[I-PROPOSED-CREATOR-ENTRY-IS-INSTANT] ${relative(REPO_ROOT, file)}:${i + 1}: forbidden token \`${token}\` in creator entry route.`,
      );
      console.error(
        `  Creator entry routes (mingla-business/app/**/create.tsx) MUST mount the wizard without an entry-blocking server mutation. Mint a client-side d_<ts36> id (useDraftEventStore.createDraft(brandId) or generateDraftId()) and router.replace to the resume route. Server-side rows are created lazily on first user-meaningful edit.`,
      );
      console.error(
        `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-CREATOR-ENTRY-IS-INSTANT.`,
      );
      console.error(
        `  To allow with reason: prepend \`// ${ALLOWLIST_TAG} — <reason>\` on the immediately previous line.`,
      );
    }
  }
}

for (const file of walkForCreateTsx(APP_ROOT)) {
  filesScanned += 1;
  checkFile(file);
}

if (violations === 0) {
  console.log(
    `[I-PROPOSED-CREATOR-ENTRY-IS-INSTANT] OK — scanned ${filesScanned} create.tsx files; 0 violations.`,
  );
  process.exit(0);
} else {
  console.error(
    `[I-PROPOSED-CREATOR-ENTRY-IS-INSTANT] FAIL — ${violations} violation(s) across ${filesScanned} create.tsx files.`,
  );
  process.exit(1);
}
