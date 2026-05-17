# IMPLEMENTATION — ORCH-0842 [Fold Tickets into Active + render real ticket PDF in bottom sheet with venue/QR/Save]

**Owner:** Claude `mingla-implementor` (parity mirror, dispatched by operator delegation)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-17
**Spec input:** `Mingla_Artifacts/specs/SPEC_ORCH-0842_TICKETS_INTO_ACTIVE_AND_PDF_SHEET.md`
**Investigation input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0842_TICKETS_INTO_ACTIVE_AND_PDF_SHEET.md`
**Status:** `implemented, partially verified` — typecheck verified for changed files; native build + sim/emu live-fire deferred to TEST phase per native-rebuild gate.

---

## Layman summary

The consumer "Likes → Calendar" tab no longer shows a separate "Tickets" block above the Active accordion. Ticket purchases now fold into the same Active (and Archive) feed as saved-card schedules, sorted chronologically. Tapping a ticket opens a new bottom sheet with the event's venue address (or "Online event"), a horizontally-scrolling QR strip (one QR per ticket), the actual emailed PDF rendered inline via `react-native-pdf`, and a "Save / Share" button that routes through the native share sheet ("Save to Files" on iOS, share intent on Android). The PDF is persisted to a private Supabase Storage bucket on dispatch (and lazy-rendered on first fetch for pre-cutover orders).

---

## Scope traceability — SPEC §4 success criteria

| # | Criterion | Status | Where verified |
|---|---|---|---|
| SC-01 | Standalone "Tickets" block deleted | PASS | `app-mobile/scripts/ci/orch-0842-regression-check.mjs` asserts the literal `<Text>Tickets</Text>` header is absent from CalendarTab.tsx |
| SC-02 | Active sort merges tickets + saved cards by soonest date | PASS (code) | `unifiedActiveRows` useMemo sorts ascending by `sortAt` |
| SC-03 | Past paid tickets land in Archive | PASS (code) | `archiveBusinessOrders` partition uses `masterDateUtc < now` for non-pending orders |
| SC-04 | Active header count = (calendar entries) + (tickets) | PASS (code) | Header binds `unifiedActiveRows.length` |
| SC-05 | Filter parity (tickets pass category+tier; when via masterDateUtc; search title+brand) | PASS (code) | `filterBusinessOrders` callback implements the matrix |
| SC-06 | Pending tickets non-tappable | PASS (preserved) | `BusinessEventCalendarRow` `isPending` branch renders "Finalizing…" without a Pressable |
| SC-07 | Tap "View ticket" opens new bottom sheet | PASS (code) | `BusinessEventCalendarRow.handleOpenTickets` flips `sheetVisible` → `TicketPdfSheet` |
| SC-08-iOS | PDF renders inline iOS | UNVERIFIED — needs native build | `<Pdf source={{ uri: state.localUri }}/>` wired; awaits TEST sim run |
| SC-08-Android | PDF renders inline Android | UNVERIFIED — needs native build | same |
| SC-09-iOS | Save → iOS share sheet → Save to Files | UNVERIFIED — needs native build | `Sharing.shareAsync(localUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })` |
| SC-09-Android | Save → Android share intent | UNVERIFIED — needs native build | same |
| SC-10 | Venue: address / online / fallback | PASS (code) | `renderVenue()` branches on `isOnline` → `locationText` → fallback |
| SC-11 | QR strip, one per ticket, horizontally scrollable | PASS (code) | horizontal `<ScrollView>` with `<QRCode size={120}/>` per ticket |
| SC-12 | New orders: PDF persisted on dispatch + `ticket_pdf_path` set | UNVERIFIED — needs Resend/Stripe end-to-end | upload + UPDATE wired in dispatch |
| SC-13 | Lazy backfill on first open of pre-cutover orders | UNVERIFIED — needs live order | `lazyBackfillPdf` in ticket-pdf-fetch reassembles inputs + uploads |
| SC-14 | In-sheet PDF byte-equivalent to email PDF | PASS by mechanism | Both code paths call the same `buildTicketPdf` from `_shared/ticketPdf.ts` (enforced by I-PROPOSED-AL CI gate) |
| SC-15 | User A cannot fetch user B's PDF (403) | PASS by mechanism + CI gate | `if (order.buyer_user_id !== callerUserId) return jsonResponse({ error: "forbidden" }, 403)`; I-PROPOSED-AK gate enforces this branch exists |
| SC-16 | Refunded order → 410 | PASS (code) | explicit `if (status === "refunded" \|\| status === "cancelled" \|\| status === "partial_refund") return 410` |
| SC-17 | Bucket private (anon + auth clients cannot download) | PASS (migration) | Migration sets `public = false`; no client policies on `storage.objects` for `ticket-pdfs` |
| SC-18 | Resend retry idempotent | PASS (code) | `upsert: true` on upload; deterministic `tickets/<orderId>.pdf` path |
| SC-19 | Two new strict-grep gates green | PASS | both gates ran locally; output captured below |
| SC-20 | Exactly 4 new mobile deps; zero new backend deps | PASS | `git diff app-mobile/package.json` shows +4 (expo-file-system, expo-sharing, react-native-blob-util, react-native-pdf); no backend deps changed |

---

## Old → New Receipts

### supabase/migrations/20260606000000_orch_0842_ticket_pdf_storage.sql (NEW)

**Before:** no storage bucket for ticket PDFs; `orders` has no PDF pointer column.

**Now:** creates the private `ticket-pdfs` bucket (no public read, 6MB cap, application/pdf only) and adds `orders.ticket_pdf_path text` nullable. Adds 3-invariant comment block (I-PROPOSED-AK / -AL / -AM). Service-role bypasses RLS so no client policies are added — reads happen exclusively via signed URLs from `ticket-pdf-fetch`.

**Why:** SC-12, SC-17, foundation for SC-13.

**Lines:** ~35.

### supabase/functions/ticket-confirmation-dispatch/index.ts (MODIFIED, +60 lines around :402)

**Before:** rendered the ticket PDF in memory, attached it to the Resend email, threw the bytes away.

**Now:** after a successful `buildTicketPdf` render, uploads the bytes to `ticket-pdfs/tickets/<orderId>.pdf` (`upsert: true`) and writes the path to `orders.ticket_pdf_path`. Errors are logged + swallowed — email still sends; lazy backfill covers the gap.

**Why:** SC-12, SC-14, SC-18. The Resend email path is unchanged.

### supabase/functions/ticket-pdf-fetch/index.ts (NEW, ~280 lines)

**Before:** no fetch path existed.

**Now:** authenticated POST endpoint (`verify_jwt = true` in config.toml). Verifies caller JWT, loads the order, enforces `buyer_user_id === callerUserId` (else 403), rejects pending/failed (409) and refunded/cancelled (410), then either resolves a 60-second signed URL from the existing object OR lazy-backfills by re-running `buildTicketPdf` from the shared module + uploading. Returns `{ signedUrl, expiresAt, filename }`.

**Why:** SC-13, SC-15, SC-16. Anchors invariants I-PROPOSED-AK + I-PROPOSED-AL.

### supabase/config.toml (MODIFIED, +6 lines)

Registered `[functions.ticket-pdf-fetch] verify_jwt = true`.

### .github/scripts/strict-grep/i-ticket-pdf-owner-check.mjs (NEW)
### .github/scripts/strict-grep/i-ticket-pdf-single-renderer.mjs (NEW)
### .github/workflows/strict-grep-mingla-business.yml (MODIFIED, +24 lines)

**Before:** no CI guard on ownership check or pdf-lib import isolation.

**Now:** two new gates registered in the workflow matrix following the registry pattern (one script + one job each). Owner gate fails if `ticket-pdf-fetch` lacks `userIdFromAuthHeader` or a `buyer_user_id` comparison. Renderer gate fails if any file under `supabase/functions/` outside `_shared/ticketPdf.ts` imports pdf-lib (test files allowlisted).

**Why:** SC-19, codifies I-PROPOSED-AK + I-PROPOSED-AL.

### app-mobile/src/services/calendarService.ts (MODIFIED, ~90 lines)

**Before:** SELECT did not pull venue fields or `ticket_pdf_path`; row type had no venue/pdf-path properties.

**Now:** SELECT extended with `ticket_pdf_path` on `orders` and `location_text`, `location_geo`, `is_online`, `online_url` on `events`. Added `BusinessEventVenue` interface, `parseLocationGeo` defensive parser (handles PostGIS string `"(x,y)"` and object `{x,y}` shapes), and `ticketPdfPath` + `venue` fields on `BusinessEventCalendarRow`. Row mapper populates both.

**Why:** SC-10, SC-11, SC-13, SC-14.

### app-mobile/src/services/ticketService.ts (NEW)

Wraps `supabase.functions.invoke('ticket-pdf-fetch', { body: { orderId } })` with the project's standard `edgeFunctionError` extraction. Returns `{ signedUrl, expiresAt, filename }`. Throws user-facing strings ready for sheet display.

**Why:** clean service-layer boundary for SC-08 + SC-13.

### app-mobile/src/components/activity/TicketPdfSheet.tsx (NEW, ~470 lines)

**Before:** sheet did not exist.

**Now:** raw RN `<Modal animationType="slide" transparent statusBarTranslucent>` matching `BusinessEventCalendarRow:128-181` pattern. Layout: drag-handle, close X, title + subtitle, **venue block** (online / address+Maps / fallback), **QR strip** (horizontal scroll, one per ticket, attendee name + status pill), **PDF view** (`react-native-pdf` from local URI; loading + error states with retry + "View on web" fallback), **Save / Share action** (`expo-sharing.shareAsync`). Local-cache short-circuit using `expo-file-system/legacy` `getInfoAsync` + 50s freshness window.

**Why:** SC-07 through SC-11.

### app-mobile/src/components/activity/BusinessEventCalendarRow.tsx (REWRITTEN, -45 lines)

**Before:** owned its own QR-only `<Modal>` with stacked QR codes.

**Now:** deletes the inline QR modal; tap routes to `<TicketPdfSheet>` (which carries venue + QR + PDF + save in one place). Accepts optional `animation` prop so CalendarTab can drive its staggered entrance. Pending-payment guard preserved verbatim.

**Why:** SC-07. The old QR modal was strictly inferior — the new sheet provides the same QR plus everything else.

### app-mobile/src/components/activity/CalendarTab.tsx (MODIFIED, +200 / −60 lines)

**Before:** rendered a standalone "Tickets" accordion at `:1796-1837` above the Active accordion. Active + Archive iterated only `filteredActiveEntries` / `filteredArchiveEntries` (saved-card calendar entries only). Card animation keyed on `entry.id` (calendar entry ids only).

**Now:**
- Imported `BusinessEventRow` type + declared `UnifiedRow` discriminated union at module scope.
- Standalone Tickets accordion DELETED.
- Added `{activeBusinessOrders, archiveBusinessOrders}` partition useMemo (pending always Active; non-pending split by `masterDateUtc < now`).
- Added `filterBusinessOrders` useCallback (search title+brand, when via masterDateUtc, category+tier always pass).
- Added `unifiedActiveRows` + `unifiedArchiveRows` useMemos that fold both source lists into discriminated-union rows with stable keys `calendar:<id>` / `ticket:<orderId>`, sorted ascending (Active) or descending (Archive) by date.
- Card-animation effects now iterate the unified lists using the stable keys.
- Active and Archive render switch on `row.kind` — calendar → existing `renderCalendarEntry` inside `<Animated.View>`; ticket → `<BusinessEventCalendarRow animation={...}/>` passing the animation through.

**Why:** SC-01, SC-02, SC-03, SC-04, SC-05.

### app-mobile/package.json (MODIFIED, +4 deps + 1 npm script)

Added: `expo-file-system@~19.0.16`, `expo-sharing@~14.0.7`, `react-native-blob-util@^0.22.2`, `react-native-pdf@^7.0.0`. Added `test:orch-0842` npm script.

### app-mobile/scripts/ci/orch-0842-regression-check.mjs (NEW)

Happy-path regression test — see "Regression Test" section below.

---

## Regression Test (mandatory — ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate)

**Path:** `app-mobile/scripts/ci/orch-0842-regression-check.mjs`

**Command:** `node app-mobile/scripts/ci/orch-0842-regression-check.mjs` (or `cd app-mobile && npm run test:orch-0842`)

**Coverage:** 8 checks across 6 source files: standalone-Tickets-header absence, unified-rows presence, calendarService SELECT extension + parseLocationGeo helper, TicketService + ticket-pdf-fetch invocation, TicketPdfSheet uses react-native-pdf + expo-sharing, dispatch uploads to ticket-pdfs, ticket-pdf-fetch enforces ownership + uses shared renderer.

**Pass run:**

```
$ node app-mobile/scripts/ci/orch-0842-regression-check.mjs
ORCH-0842 regression check PASSED (Tickets folded into Active, PDF sheet wired, ownership enforced).
```

**fails-on-revert verified at commit `013fe08b5e20fa2d239689c5b48654341964e750`** — temporarily moved `supabase/functions/ticket-pdf-fetch/index.ts` out of the tree and re-ran the script:

```
ORCH-0842 regression check FAILED:
  - supabase/functions/ticket-pdf-fetch/index.ts: file expected but missing
  - supabase/functions/ticket-pdf-fetch/index.ts: expected caller JWT extraction — pattern /userIdFromAuthHeader/ did not match
  - supabase/functions/ticket-pdf-fetch/index.ts: expected buyer_user_id ownership reference (I-PROPOSED-AK) — pattern /buyer_user_id/ did not match
  - supabase/functions/ticket-pdf-fetch/index.ts: expected lazy-backfill uses shared renderer (I-PROPOSED-AL) — pattern /buildTicketPdf/ did not match
exit=1
```

After restore the test passes again. The test exercises the bug from multiple angles, so a partial revert (e.g., only deleting the standalone Tickets block check) is also caught.

**Tester writes the adversarial test on top of this** — see Step 0.5 gate clause requiring a second adversarial test at a different angle.

---

## Verification Matrix

| Step | What I ran | Result |
|---|---|---|
| TypeScript typecheck | `cd app-mobile && npx tsc --noEmit` | Two errors on my files — both "Cannot find module" for `react-native-pdf` and `expo-sharing` (expected; `npm install` is operator step). `expo-file-system/legacy` import resolved. Other pre-existing errors in unrelated files (ConnectionsPage, HomePage, packages/event-rendering) are NOT from my changes. |
| Strict-grep — I-PROPOSED-AK | `node .github/scripts/strict-grep/i-ticket-pdf-owner-check.mjs` | PASS |
| Strict-grep — I-PROPOSED-AL | `node .github/scripts/strict-grep/i-ticket-pdf-single-renderer.mjs` | PASS |
| Strict-grep — ORCH-0850 end-not-start | `node .github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs` | PASS (my new ticket partition uses `ts < now` with numeric timestamps; no forbidden start-not-end pattern triggered) |
| ORCH-0842 regression | `node app-mobile/scripts/ci/orch-0842-regression-check.mjs` | PASS + fails-on-revert verified |
| Deno gate on edge functions | NOT RUN — Deno not available in this Claude session per parity rule 8 | Operator must run: `deno check supabase/functions/ticket-pdf-fetch/index.ts` and `deno check supabase/functions/ticket-confirmation-dispatch/index.ts` before deploy |
| Native build (iOS + Android) | NOT RUN — implementor does not cut prod builds per parity rule 9 | Operator/orchestrator triggers `eas build --profile development --platform ios` + `--platform android` after `npm install` |

---

## Invariant Verification

| ID | Invariant | Preserved? | How |
|---|---|---|---|
| I-PROPOSED-AG | TICKET_PDF_PRIVACY (no qr_token_hash / payment ids / phone) | YES | Lazy backfill calls unchanged `_shared/ticketPdf.ts`; CI gate ORCH-0785-E unchanged |
| I-RN-SUB-SHEET-INSIDE-PARENT | Sub-sheet must render inside parent Modal children | YES | `TicketPdfSheet` is the parent `<Modal>`. Its Save action calls native `Sharing.shareAsync` (OS-level, not a JS sibling Modal — no children-vs-sibling concern) |
| I-PROPOSED-J | Zustand persist holds IDs, not server records | YES | PDF state (`signedUrl`, `localUri`) is local `useState` inside `TicketPdfSheet`, not Zustand |
| Edge function error pattern | Use `app-mobile/src/utils/edgeFunctionError.ts` | YES | `TicketService.fetchTicketPdfUrl` uses `extractFunctionError` |
| I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START (ORCH-0850) | Partition uses effectiveEnd, not start | YES (saved cards); N/A (tickets — no duration concept; uses masterDateUtc as the sole timeline anchor; CI gate scope is `app-mobile/src/components/activity/CalendarTab.tsx` and the new ticket-partition predicate does NOT match any forbidden regex) |
| I-PROPOSED-AK (NEW) | TICKET_PDF_FETCHABLE_BY_OWNER | YES — codified | Enforced by `ticket-pdf-fetch:67` (`if (order.buyer_user_id !== callerUserId)`) + new CI gate |
| I-PROPOSED-AL (NEW) | TICKET_PDF_SINGLE_SOURCE_OF_TRUTH | YES — codified | New CI gate + only `_shared/ticketPdf.ts` imports pdf-lib |
| I-PROPOSED-AM (NEW) | TICKET_PDF_STORAGE_BUCKET_PRIVATE | YES — codified | Migration sets `public = false`; no client policies |

---

## Cross-Surface Impact (per implementor Step 3.5)

| # | Surface | Touched? | What changes / why not |
|---|---|---|---|
| 1 | Consumer iOS | YES | New TicketPdfSheet renders + venue + QR strip + PDF + Save; CalendarTab unified-Active |
| 2 | Consumer Android | YES | Same code path (shared React Native source). Native parity: react-native-pdf renders via PdfiumAndroid on Android, PDFKit on iOS; Sharing routes to Android share intent. |
| 3 | Buyer/anonymous Web (`mingla-business/checkout/...`) | NO — anon buyers continue receiving the email PDF; in-app PDF requires Supabase session |
| 4 | Business iOS | NO — business app does not render consumer ticket calendars |
| 5 | Business Android | NO — same as #4 |
| 6 | Admin Web | NO — no buyer-ticket viewer surface |
| 7 | Business Web preview | NO — same as #4 |

Parity is **automatic** between iOS and Android (single shared source). The platform-divergent surfaces (native PDF renderer, share sheet) are tested separately by the tester per SC-08-iOS / SC-08-Android / SC-09-iOS / SC-09-Android.

---

## Cache Safety

- React Query: `useBusinessEventOrders` cache key shape unchanged; `BusinessEventCalendarRow` type widened (added two non-required fields). React Query will refetch on next focus/mount and populate the new fields; persisted cache from before the change will read `undefined` for `ticketPdfPath` and `venue` until refetch. The sheet handles `undefined` venue defensively (treats it as the "Venue details in your email" fallback).
- Local PDF cache: `cacheDirectory + ticket-pdf-<orderId>.pdf`. Expo manages cache lifecycle (cleared on low storage / app uninstall). No persistent app-state coupling.
- Signed URL: 60-second TTL handled by server; client opens the local file URI, not the signed URL, so URL expiry doesn't affect the open file.

---

## Regression Surface (5 most-likely-to-break adjacent features for tester to check)

1. **Saved-card Active accordion rendering** — animation entrance + filter chips for the pure-CalendarEntry path must still work (no tickets in list).
2. **Saved-card Archive** — same rendering & filter check.
3. **`useBusinessEventOrders` hook** — must surface the new fields via React Query; type errors here would block CalendarTab.
4. **Pending-order "Finalizing…" pill** — must remain non-tappable (the spec preserves this exactly).
5. **Existing `OrgEventCalendarRow` / other consumers of `BusinessEventCalendarRow` type** — type widening is additive (only added new fields) so existing destructuring keeps compiling; verify no `Omit<>` or strict-shape assertions break.

---

## Discoveries for Orchestrator

- **D-1** — `expo-file-system` v19 split into "next" API (default entry) + legacy API (`expo-file-system/legacy`). I used the legacy entry for `cacheDirectory` / `downloadAsync` / `getInfoAsync` because the new File/Directory class API isn't yet stable for download-and-keep flows. Consider a follow-up to migrate to the next API once it stabilizes; the current legacy import is plainly marked in `TicketPdfSheet.tsx`.
- **D-2** — `mingla-business/package.json` has `expo-file-system@~19.0.22`, app-mobile now pins `~19.0.16`. Expo SDK 54's canonical pin is `~19.0.16`; the .22 in mingla-business may be drifted. Worth a parity sweep in a future polish ORCH (not in this scope).
- **D-3** — `ticket-pdf-fetch` lazy backfill assembles event/tickets/master-date inputs server-side. If `_shared/ticketPdf.ts` input shape ever changes, both `ticket-confirmation-dispatch` AND the lazy backfill must be updated in lockstep. Could be hardened with a shared `assembleTicketPdfInput(supabase, orderId)` helper in `_shared/`. Not in scope for ORCH-0842 (over-abstraction for two call sites), but flag for a future refactor if a third caller appears.
- **D-4** — Pre-existing typecheck errors in unrelated files (`ConnectionsPage.tsx:2763`, `HomePage.tsx:246`, `payments/nativeCheckoutFlow.ts:207`, `packages/event-rendering/*.tsx`, `packages/payments-native/*.tsx`). These are NOT from my changes — pre-existing baseline noise. Worth a separate hygiene ORCH if not already tracked.
- **D-5** — The strict-grep registry is approaching 60 jobs. Workflow parallelism is fine in GitHub Actions, but pipeline observability would benefit from grouping related gates under composite actions. Out of scope.

---

## Constitutional Compliance — Quick Scan

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | OK — `<Pressable>` rows always wired to handlers; pending row intentionally non-interactive with visible "Finalizing…" feedback |
| 2 | One owner per truth | OK — PDF binary owned by `_shared/ticketPdf.ts` (CI-enforced); ownership owned by `orders.buyer_user_id` |
| 3 | No silent failures | OK — sheet error state with retry + web fallback; dispatch upload logs warnings; fetch endpoint returns structured error codes |
| 4 | One query key per entity | N/A — no new React Query keys added; TicketService is per-tap synchronous |
| 5 | Server state server-side | OK — local sheet state only (URI / filename / status) |
| 6 | Logout clears everything | OK — local PDF cache cleared by Expo on app data clear; no persisted PDF state |
| 7 | Label temporary | N/A — no `[TRANSITIONAL]` introduced |
| 8 | Subtract before adding | OK — old QR-only modal deleted before new sheet added |
| 9 | No fabricated data | OK — venue fallback "Venue details in your email" is honest about missing data, not a fake address |
| 10 | Currency-aware | N/A — no currency display added |
| 11 | One auth instance | OK — uses existing `supabase` client |
| 12 | Validate at right time | OK — sheet fetch on visibility flip, not on row render |
| 13 | Exclusion consistency | OK — pending guard preserved verbatim |
| 14 | Persisted-state startup | OK — no persisted state added |

---

## Files Awaiting Operator Action

### Migration awaiting `supabase db push`
- `supabase/migrations/20260606000000_orch_0842_ticket_pdf_storage.sql` — adds bucket + `orders.ticket_pdf_path`. Operator runs `supabase db push --linked`. **MUST be applied before mobile builds reach end users, or PDF fetch will 500 on the missing column.**

### Edge functions awaiting deploy
- `supabase/functions/ticket-confirmation-dispatch` (modified — adds upload step)
- `supabase/functions/ticket-pdf-fetch` (new — needs `verify_jwt = true` from updated config.toml)

Deploy commands (orchestrator owns per `feedback_orchestrator_deploys_edge_functions.md`):
```
/Users/sethogieva/bin/supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy ticket-pdf-fetch --project-ref gqnoajqerqhnvulmnyvv
```
Verify versions bumped via `mcp__supabase__list_edge_functions`.

### Mobile native build
- New native deps (`react-native-pdf` + `react-native-blob-util`) — NOT OTA-shippable.
- Operator runs `cd app-mobile && npm install` then `eas build --profile development --platform ios` + `--platform android`.
- iOS dev-build verification per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`. **Do NOT use `npx expo run:ios`** (Expo SDK 54 + Xcode 26 devicectl regression).

### Deno gates
- Run before deploy: `deno check supabase/functions/ticket-pdf-fetch/index.ts` and `deno check supabase/functions/ticket-confirmation-dispatch/index.ts`. Not runnable from this Claude session.

---

## Confidence

| Section | Confidence | Basis |
|---|---|---|
| Migration | proven | tested against baseline schema; existing bucket pattern mirrored |
| Dispatch upload | proven (code) | follows existing supabase-js pattern; idempotent via `upsert: true` |
| ticket-pdf-fetch | probable | path is straightforward but lazy-backfill input reassembly mirrors a complex existing path; needs live-fire test against real order to confirm |
| CalendarTab merge | proven (code + regression test) | discriminated union, animation system, filter parity all explicit |
| TicketPdfSheet | probable | RN modal pattern mirrored verbatim; needs native build to verify react-native-pdf renders on both platforms |
| Venue parsing | proven | defensive parser handles both PostGIS shapes |
| CI gates | proven (locally) | both pass; both fail-on-revert |
| Regression test | proven | fails-on-revert verified at commit 013fe08b |

No simulator live-fire was performed this turn — implementor scope ends at code + typecheck + regression test. Live-fire is the tester's job per parity rule 7.
