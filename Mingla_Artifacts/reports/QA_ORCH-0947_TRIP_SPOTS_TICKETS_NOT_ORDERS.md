# QA Report — ORCH-0947 Trip Spots/Travelers Count Tickets, Not Orders

**Date:** 2026-05-24  
**Tester:** Codex `$tester` parity mirror  
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0947-[trip-spots-counts-tickets]/`  
**Branch:** `ORCH-0947-trip-spots-counts-tickets`  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0947_TRIP_SPOTS_TICKETS_NOT_ORDERS.md`  
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0947_TRIP_SPOTS_TICKETS_NOT_ORDERS.md`

## Verdict

**CONDITIONAL PASS**

The core ORCH-0947 contract is independently verified: the business trip dashboard data path now counts seat-holding `tickets` instead of buyer `orders`, the Spots KPI and Travelers subtitle consume the ticket count, partial refunds are excluded at the ticket-status level, and RPC errors fail loud.

The condition is the requested live simulator / web-preview parity gate. I could not honestly mark business iOS, Android, or web preview as visually verified because the Expo web preview in this per-ORCH worktree fails before app execution: the symlinked `mingla-business/node_modules -> /Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules` causes Metro to emit a web entry script path under `../../../mingla-main/...`; the browser receives a JSON 404 for that script and refuses to execute it. No product-code blocker was found for ORCH-0947, but the visual runtime gate remains a manual/operator gate.

## Findings

| ID | Severity | Status | Finding | Evidence | Required Action |
|---|---:|---|---|---|---|
| QA-0947-01 | P2 | Open condition | Requested live parity across business iOS, Android, and web preview is not completed. | `npx expo start --web --port 8094 --host localhost` and retry with `NODE_OPTIONS=--preserve-symlinks` on port `8095`; Playwright body stayed empty. Browser console: `Refused to execute script ... entry.bundle ... MIME type ('application/json')`; direct curl returned `UnableToResolveError` resolving `./mingla-main/mingla-business/node_modules/expo-router/entry` from the ORCH worktree. | Operator/tester should run visual parity in an environment with non-symlinked worktree dependencies or a known-good dev-client setup, then confirm Spots shows `3 / 4` and Travelers shows `3 travelers` on business iOS, Android, and web preview. |

No P0/P1 product blockers were found.

## Spec Compliance

| Spec Requirement | QA Result | Evidence |
|---|---|---|
| Add independent `biz_trip_tickets_sold(uuid)` RPC | Pass | `supabase/migrations/20260725000000_orch_0947_biz_trip_tickets_sold.sql:7` defines the function. |
| Mirror checkout capacity status set | Pass | New RPC counts `t.status IN ('valid', 'used', 'transferred')` at migration line 58; checkout capacity gate uses the same set at `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:222-226`. |
| Do not touch capacity storage | Pass | Diff review found no capacity-storage schema change; UI still reads existing `trip.businessTrip.capacity`. |
| Do not touch checkout RPC capacity gate | Pass | No diff in `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql`; only read for comparison. |
| Do not reuse or modify `biz_trip_sold_count_by_tier` | Pass | New migration body has no reference to `biz_trip_sold_count_by_tier`; existing ORCH-0876 helper untouched. |
| Do not add silent-zero RPC fallback | Pass | `getTrip()` throws on `soldResp.error` at `mingla-business/src/services/tripsService.ts:559`; the only `soldResp.data ?? 0` path is after no error, matching the spec's mapper default. |
| Add `ticketsSoldCount` to `Trip` | Pass | `mingla-business/src/services/tripsService.ts:112-118`. |
| Fetch RPC in `getTrip()` | Pass | `mingla-business/src/services/tripsService.ts:533-568` includes `supabase.rpc("biz_trip_tickets_sold", { p_event_id: eventId })`. |
| Spots KPI uses ticket count | Pass | `mingla-business/app/trip/[id]/index.tsx:290-302` derives `ticketsSold` from `trip.ticketsSoldCount` and renders `${ticketsSold} / ${capacity}`. |
| Travelers subtitle uses ticket count | Pass | `mingla-business/app/trip/[id]/index.tsx:407-411` renders `${ticketsSold} traveler(s)`. |
| Regression coverage exists | Pass | Focused service tests, dashboard parity tests, Deno SQL source tests, and strict-grep guard all pass. |
| Partial-refund adversarial T-A03 | Pass | Live local Supabase transaction seeded one 4-ticket partial-refund order with one `refunded` ticket; `public.biz_trip_tickets_sold(...)` returned `3`. |
| Business iOS live sim parity | Unverified | Blocked by live preview/dev-server environment; shared JS source path is verified. |
| Business Android live sim parity | Unverified | No connected Android device; AVD exists (`Pixel_8_Pro`) but visual app render was not completed. |
| Business web preview parity | Blocked | Expo web preview entry bundle 404/MIME failure caused blank body before app execution. |

## Hard-Guard Audit

- **No capacity storage changes:** Verified by diff review and touched-file review.
- **No checkout RPC capacity-gate changes:** Verified no diff in `20260610000002_tr3_ticket_checkout_session_installment_aware.sql`.
- **No reuse/modify of `biz_trip_sold_count_by_tier`:** Verified by `rg` and migration body review.
- **No silent-zero RPC fallback:** Verified `soldResp.error` throws before mapper default.
- **No `supabase db push`:** Not run. Local Supabase was used only for read/test evidence and local seed data.

## Command Evidence

| Check | Command | Result |
|---|---|---|
| Service regression | `npx jest src/services/__tests__/tripsService.test.ts src/services/__tests__/tripsService.ticketsSoldCount.test.ts --runInBand` from `mingla-business/` | Pass: 2 suites, 5 tests. |
| Dashboard parity | `npx jest --runTestsByPath 'app/trip/[id]/__tests__/dashboard-parity.test.tsx' 'app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx' --runInBand` from `mingla-business/` | Pass: 2 suites, 31 tests. |
| Migration source regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/migrations/__tests__/biz_trip_tickets_sold.test.ts` | Pass: 3 tests. |
| Strict-grep guard | `node .github/scripts/strict-grep/orch-0947-trip-spots-tickets-not-orders.mjs` | Pass: no `travelersCount` order-count path. |
| Typecheck, full package | `npx tsc --noEmit --pretty false` from `mingla-business/` | Fails on pre-existing unrelated errors in checkout buyer params, marketing rich editor, IconChrome/Sheet web styles, native payments module resolution, DraftEvent fixtures, and shared packages. No ORCH-0947-touched file errors in filtered check. |
| Touched-file type filter | `npx tsc --noEmit --pretty false 2>&1 \| rg "tripsService|usePublicTripBySlug|publicEventsService|dashboard-parity|trip/\\[id\\]/index|ORCH-0876|publishedTripEditGuards|biz_trip_tickets_sold" || true` | Pass: no output. |
| Lint, full package | `npm run lint -- --quiet` from `mingla-business/` | Fails on pre-existing unrelated lint errors. No ORCH-0947-specific lint error identified. |
| Local RPC existence | `docker exec supabase_db_gqnoajqerqhnvulmnyvv psql ... -c "select to_regprocedure('public.biz_trip_tickets_sold(uuid)')"` | Pass: function exists. |
| Partial-refund T-A03 | Local PostgreSQL transaction in Supabase container: 4 tickets on one `partial_refund` order, one ticket `refunded`, caller role `authenticated` | Pass: RPC returned `3`. |
| Auth fail-loud | Supabase JS anon client calling `biz_trip_tickets_sold` | Pass: `{ data: null, error: { message: "authentication_required", code: "P0001" } }`. |
| Live local RPC via Supabase JS | Signed-in local user calling `biz_trip_tickets_sold` on seeded trip | Pass: `{ rpcData: 3, rpcError: null, tripTitle: "ORCH 0947 Ticket Count Trip", capacity: 4 }`. |
| Web preview | `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=... npx expo start --web --port 8094 --host localhost`, plus retry with `NODE_OPTIONS=--preserve-symlinks` on port `8095` | Blocked: blank body; bundle entry JSON 404/MIME error from symlinked `node_modules`. |

## Partial-Refund T-A03 Detail

The live adversarial database setup used a local Supabase transaction with:

- One trip event with capacity `4`.
- One ticket type for the trip.
- One paid order marked `partial_refund`.
- Four ticket rows on that order: `valid`, `valid`, `transferred`, and `refunded`.
- Authenticated caller set to the brand owner/account owner.

Result:

```text
partial_refund_tickets_sold
---------------------------
3
```

This proves ORCH-0947 does not count orders and does not count refunded tickets. It also proves the new helper is aligned to ticket-level seat occupancy, which is the checkout-capacity semantic.

## Live Parity Notes

Source parity is strong because business iOS, Android, and web preview share `mingla-business/app/trip/[id]/index.tsx`. The source-level dashboard contract proves both render strings are fed by `trip.ticketsSoldCount`.

Visual parity remains unverified:

- **Business web preview:** blocked before app execution by the worktree `node_modules` symlink/Metro entry resolution issue.
- **Business iOS:** iOS simulators are available (`xcrun simctl list devices available` shows iPhone 17 variants), but no rendered app session was completed.
- **Business Android:** `adb devices` showed no connected devices; `emulator -list-avds` shows `Pixel_8_Pro`, but no rendered app session was completed.

Manual gate expected result on the seeded local trip `cccccccc-0947-4000-8000-000000000947`:

- Dashboard title: `ORCH 0947 Ticket Count Trip`
- Spots KPI: `3 / 4`
- Travelers subtitle: `3 travelers`

## Regression Coverage Assessment

Regression coverage is adequate for the code contract:

- `mingla-business/src/services/__tests__/tripsService.ticketsSoldCount.test.ts` verifies `getTrip()` calls `biz_trip_tickets_sold`, returns `ticketsSoldCount`, and throws RPC errors instead of masking them.
- `supabase/migrations/__tests__/biz_trip_tickets_sold.test.ts` pins the migration source contract: ticket statuses only, tickets table not orders, no `biz_trip_sold_count_by_tier`, and zero tickets return `0`.
- `mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx` pins the Spots and Travelers render templates to `ticketsSold`.
- `.github/scripts/strict-grep/orch-0947-trip-spots-tickets-not-orders.mjs` prevents the old `travelersCount` identifier from returning to the dashboard.

The remaining gap is visual/runtime parity, not automated contract coverage.

## Downstream Recommendation

Do not route as full PASS/CLOSE until the operator either:

1. Completes the live business iOS, Android, and web preview visual parity gate in an environment that can render the ORCH worktree bundle, or
2. Explicitly accepts this as a manual gate attached to a conditional close because the product code and database contract are already verified.

If the operator requires a strict all-green TEST verdict, route to infrastructure/orchestrator follow-up for worktree preview dependency isolation rather than product implementor rework; no ORCH-0947 product defect was found.

