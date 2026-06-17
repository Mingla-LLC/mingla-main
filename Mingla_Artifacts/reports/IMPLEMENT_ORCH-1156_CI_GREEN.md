# IMPLEMENT ORCH-1156 — CI-green cleanup of META-ORCH-1148 Venue Suite debt

**Status:** implemented and verified (both gates green, deno check clean).
**Worktree:** `~/Desktop/mingla-orchs/ci-green/` on branch `ci-green-main` (off origin/main, HEAD `36d4a3218`).
**Scope:** two isolated, safe CI-gate fixes. No deploy / merge / OTA. Migration written, NOT applied (orchestrator applies via MCP).

---

## 1. Summary

Two strict-grep CI gates were RED on `main`, both inherited from META-ORCH-1148 Venue Suite (per
COMMS-0038 + COMMS-0039). This ORCH makes both green without altering any Venue/RSVP runtime logic:

1. **Realtime publication pairing** (`orch-0854-tickets-realtime-publication-paired.mjs`) — the
   Venue hooks subscribe to `postgres_changes` on `reservations` and `venue_waitlist`, but neither
   table was in the `supabase_realtime` publication, so the subscriptions were silently no-op AND the
   gate failed for every PR. Fixed via a new idempotent publication-add migration + appending both
   tables to the gate's `BASELINE_PUBLICATION_TABLES` allowlist (the gate's sanctioned option (a)).
2. **Stripe idempotency on a read** (`i-proposed-r-stripe-idempotency-key.mjs`) — the gate flagged a
   `stripe.paymentIntents.retrieve(...)` call (a read/GET, inherently idempotent). Fixed via the
   gate's sanctioned allowlist comment. No idempotency key added to a retrieve (that would be wrong).

---

## 2. Gate / success-criteria coverage

| Criterion | Result | Evidence |
|-----------|--------|----------|
| BV gate (`orch-0854-tickets-realtime-publication-paired.mjs`) exits 0 / 0 violations | PASS | `BV EXIT=0`, `[PASS] every NEW subscribed table is in BASELINE_PUBLICATION_TABLES or has a paired publication-add migration.` |
| R gate (`i-proposed-r-stripe-idempotency-key.mjs`) exits 0 / 0 violations | PASS | `I-PROPOSED-R gate: scanned 487 .ts files · 0 violations · 0 read failures`, `R EXIT=0` |
| Migration adds both tables idempotently | PASS | `20261013000001_orch_1156_venue_realtime_publication.sql` — DO-block `pg_publication_tables` guard per table |
| Edge fn still type-checks | PASS | `deno check supabase/functions/venue-reservation-confirm/index.ts` → `DENO CHECK EXIT=0` |
| No Venue/RSVP runtime logic changed | PASS | diff is 1 migration + 1 gate-baseline array edit + 1 comment line |
| Only allowed files changed | PASS | `git status` = the 3 allowed files (+ this report) |

---

## 3. Files changed

| File | Change | Δ |
|------|--------|---|
| `supabase/migrations/20261013000001_orch_1156_venue_realtime_publication.sql` | NEW — idempotent `ALTER PUBLICATION supabase_realtime ADD TABLE` for `reservations` + `venue_waitlist` | +37 |
| `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs` | Append `"reservations"` and `"venue_waitlist"` to `BASELINE_PUBLICATION_TABLES` | +2 |
| `supabase/functions/venue-reservation-confirm/index.ts` | Add allowlist comment above the `paymentIntents.retrieve` call | +1 |

Migration VERSION written: **`20261013000001`** (strictly greater than the prior max `20261012000006`
and the sibling-worktree `20261013000000_orch_1155_*`).

---

## 4. Data-model changes applied

None applied (migration written, NOT run — orchestrator applies via MCP). The migration adds two
existing tables (`public.reservations`, `public.venue_waitlist`) to the `supabase_realtime`
publication so the Venue hooks' realtime subscriptions actually fire. Idempotent: each `ALTER
PUBLICATION ... ADD TABLE` is guarded by a `pg_publication_tables` membership check inside a `DO`
block, wrapped in `BEGIN/COMMIT`, so re-runs are no-ops.

---

## 5. Edge functions touched

- `venue-reservation-confirm` — comment-only change (allowlist annotation). `verify_jwt` value
  UNCHANGED. No deploy by implementor.

---

## 6. Regression tests

**BACKFILL-EXEMPT — reason:** zero product-code behavior change (one CI-gate baseline array entry, one
comment line, and a not-yet-applied DB-publication migration). The gates themselves are the
executable proof: both were RED before (2 BV FAILs + 1 R violation, captured) and are GREEN after
(both exit 0). The fails-on-revert is intrinsic — removing the migration or the baseline entries
re-reds the BV gate; removing the comment re-reds the R gate.

---

## 7. Old → New receipts

### `supabase/migrations/20261013000001_orch_1156_venue_realtime_publication.sql` (NEW)
**Before:** `reservations` and `venue_waitlist` were NOT in the `supabase_realtime` publication; the
Venue hooks' `postgres_changes` subscriptions were silently no-op.
**Now:** both tables are added to the publication idempotently (membership-guarded), pairing the
subscriptions so reservation/waitlist live-updates can fire.
**Why:** BV gate option (a) + the underlying broken-realtime bug noted in COMMS-0038.

### `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs`
**Before:** `BASELINE_PUBLICATION_TABLES` lacked `reservations` and `venue_waitlist` → 2 FAILs.
**Now:** both appended (alphabetical position preserved) → the gate matches the new migration's
publication membership.
**Why:** the gate's documented mechanism — append the table in the SAME PR as the publication-add migration.

### `supabase/functions/venue-reservation-confirm/index.ts`
**Before:** `stripe.paymentIntents.retrieve(...)` at line 167 had no allowlist annotation → R gate FAIL.
**Now:** `// orch-strict-grep-allow stripe-no-idempotency-key — paymentIntents.retrieve is a read/GET;
inherently idempotent, no mutation to dedupe` directly above the call (within the gate's 5-line
lookback window).
**Why:** retrieve is a read; idempotency keys are for mutations. The allowlist is the correct escape.

---

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | No | no consumer code touched |
| Consumer Android | No | no consumer code touched |
| Buyer/anon Web | No | no buyer-web code touched |
| Business iOS | Indirect (post-migration-apply) | Venue reservations/waitlist realtime begins firing once migration applied; no code change |
| Business Android | Indirect (post-migration-apply) | same |
| Admin Web (adjacent) | No | — |
| Business Web preview (adjacent) | No | — |

Parity: automatic (shared business RN codebase; realtime enablement is server-side via the publication).

---

## 9. Smoke result

- `node .github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs` → exit 0, `[PASS]`.
- `node .github/scripts/strict-grep/i-proposed-r-stripe-idempotency-key.mjs` → exit 0, `0 violations`.
- `deno check supabase/functions/venue-reservation-confirm/index.ts` → exit 0.
- `npx tsc -p tsconfig.json` (mingla-business): UNRUN — no `node_modules` installed in this fresh
  worktree (no toolchain). The changes are type-inert: one comment in a Deno edge fn (outside the
  business tsconfig), a `.mjs` gate edit, and a `.sql` file. `deno check` confirms the only
  TypeScript file touched still type-checks. No type risk.

---

## 10. Known issues / deferred

None. The 12 legacy WARN subscriptions in the BV gate output are pre-existing tracked debt
(LEGACY_KNOWN_UNPUBLISHED_SUBSCRIPTIONS), out of scope for ORCH-1156.

---

## 11. Operator action required

1. **Apply the migration via MCP** (dev migration-history is drift-corrupted, so MCP, not `db push`):
   `supabase/migrations/20261013000001_orch_1156_venue_realtime_publication.sql`. It is idempotent;
   safe to run even if the tables are already published.
2. No edge-function deploy required (comment-only change; deploy at orchestrator's discretion from
   merged main — `venue-reservation-confirm`, preserve its `verify_jwt`).
3. Resolve COMMS-0038 and COMMS-0039 (both now addressed by this work).

---

## 12. Discoveries for Orchestrator

- COMMS-0038 (I-PROPOSED-BV red) and COMMS-0039 (I-PROPOSED-R red) are both fully addressed by this
  ORCH. Acked this turn; recommend flipping both to RESOLVED once this PR merges + the migration is applied.
- The realtime publication migration also FIXES the underlying live-update bug COMMS-0038 flagged
  (subscriptions were silently no-op) — once applied, Venue reservation/waitlist live-updates will fire.
