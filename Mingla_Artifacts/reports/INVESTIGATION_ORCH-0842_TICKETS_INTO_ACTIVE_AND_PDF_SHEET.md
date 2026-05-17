# INVESTIGATION — ORCH-0842 [Tickets relocate to Active + PDF bottom sheet with download]

**Mode:** INVESTIGATE (code-audit + architectural)
**Owner:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0842_TICKETS_INTO_ACTIVE_AND_PDF_SHEET.md`

## Summary (layman)

Today, when a buyer purchases tickets to a Mingla business event, the tickets appear in the Likes page → Calendar tab as a separate "Tickets" block sitting ABOVE the "Active" accordion. Tapping "View ticket" opens a half-screen modal that shows the ticket's QR code and a status line — **but not the actual PDF that was emailed to them**. Operator wants two changes:

1. **Stop having a separate Tickets block.** Fold ticket purchases into the same Active list that holds upcoming saved/scheduled cards, so the buyer sees their event timeline as one unified feed.
2. **Tap a ticket → bottom sheet renders the actual ticket PDF, with a download/save action.**

The good news: the **ticket PDF already exists** — the `ticket-confirmation-dispatch` edge function builds a real PDF (`pdf-lib`, A4, one page per ticket, branded with Mingla wordmark and QR) and attaches it to the buyer's confirmation email. The bad news: **that PDF is never persisted anywhere**. It's rebuilt in memory per email and discarded. The mobile app has no way to fetch it. To render the PDF in a sheet, we need a fetch path (new edge function OR a storage-write on dispatch). That, plus an Android-capable PDF viewer, is the bulk of the new work.

## Five-Truth-Layer Findings

### Layer 1 — Docs / Specs

- ORCH-0829-A close (`Mingla_Artifacts/CLOSE_NOTE_ORCH-0784.md` and related) introduced the Tickets section ABOVE the Active accordion by deliberate choice ("rendered above the legacy Active section so the user sees their most recently purchased tickets first" — comment at `app-mobile/src/components/activity/CalendarTab.tsx:1767-1770`).
- ORCH-0785 produced `ticketPdf.ts` and the I-PROPOSED-AG TICKET_PDF_PRIVACY invariant: the PDF must NOT contain `qr_token_hash`, QR pepper, stripe payment ids, or buyer phone numbers. The QR encodes the same `tickets.qr_code` string that `scan-ticket` validates.
- No design spec exists for a PDF-rendering buyer sheet. This is greenfield UX.

### Layer 2 — Schema / Backend

**Order + ticket data model** (`supabase/migrations/` — confirmed via `app-mobile/src/services/calendarService.ts:64-84` + the SELECT at `:286`):

`orders` row joined with:
- `tickets` (1..N rows, one per seat) — fields used by mobile: `id`, `ticket_type_id`, `qr_code`, `status` (`valid`|`used`|`void`|`transferred`|`refunded`), `attendee_name`, `attendee_email`.
- `events` and `event_dates` — to get `masterDateUtc` and `timezone`.
- `brands` — for `brandName`, `brandSlug`.

Mobile-side row shape (`BusinessEventCalendarRow`, calendarService.ts:64):

| Field | Type | Notes |
|---|---|---|
| `orderId` | string | order PK |
| `eventId` | string | event PK |
| `eventTitle` | string | |
| `brandName` | string | |
| `brandSlug` | string | |
| `coverMediaUrl` | string \| null | event cover |
| `masterDateUtc` | string \| null | ISO UTC; CAN BE NULL ("date to be announced") |
| `timezone` | string | for local-time formatting |
| `paymentStatus` | enum | `pending`/`paid`/`failed`/`refunded`/`partial_refund`/`cancelled` |
| `ticketCount` | number | |
| `ticketCountValid` | number | |
| `tickets` | `ConsumerTicketRow[]` | the seats |
| `publicBuyerUrl` | string \| null | already-built public buyer URL — relevant for fallback |

**PDF source of truth — VERDICT: PARTIAL.** Walking the pipeline:

1. `supabase/functions/_shared/ticketPdf.ts:85` — `buildTicketPdf({ event, order, tickets, attendeeNameHint, logoUrl }): Promise<TicketPdfResult>` returns `{ filename: "tickets-${shortId}.pdf", contentBase64, pageCount, byteLength }`. 5 MB size cap. Branded, A4, one page per ticket, QR embedded.
2. `supabase/functions/ticket-confirmation-dispatch/index.ts:361-394` — render is invoked once per dispatch; failures are RETRYABLE.
3. `:448-460` — the rendered base64 PDF is converted to a Resend email attachment and dispatched.
4. **NO write to Supabase Storage anywhere.** Grep confirms zero `supabase.storage.from(...)` or bucket references in the dispatch function or in `ticketPdf.ts`.
5. **NO `ticket-pdf-fetch` or equivalent edge function exists** to re-render on demand. `supabase/functions/` lists only: `ticket-checkout-create`, `ticket-confirmation-dispatch`, `ticket-checkout-status`, `scan-ticket`, `ticketmaster-events`.

So the PDF generator exists and is correct, but the PDF lives only in the buyer's email inbox.

### Layer 3 — Code (mobile)

**Current "Tickets" block** (`app-mobile/src/components/activity/CalendarTab.tsx:1767-1786`):

```tsx
{businessOrders.length > 0 && (
  <View style={styles.businessEventSection}>
    <View style={styles.businessEventHeader}>
      <Text style={styles.accordionTitle}>Tickets</Text>
      <Text style={styles.accordionCount}>
        ({businessOrders.length})
      </Text>
    </View>
    {businessOrders.map((entry) => (
      <BusinessEventCalendarRow key={`business:${entry.orderId}`} entry={entry} />
    ))}
  </View>
)}
```

Sits as a separate non-accordion block immediately ABOVE the Active accordion. No filter integration (CardFilterBar doesn't apply to it). No animation entrance (the `getCardAnimation` system applies only to `filteredActiveEntries`).

**Current Active accordion** (`:1788-1839`) — renders `filteredActiveEntries.map(...)` with per-card opacity/slide animation, accordion-collapse toggle, and an empty-state fallback. Header shows `(filteredActiveEntries.length)`.

**Active/Archive partition** (`:184-207`) — splits `calendarEntries` (legacy saved-card calendar rows, NOT business orders) by whether scheduled date is past `now`. Currently `businessOrders` are NOT considered in this partition.

**Row component** (`app-mobile/src/components/activity/BusinessEventCalendarRow.tsx`) — uses raw RN `<Modal>` with `animationType="slide"`, half-screen card (`maxHeight: 85%`), `ScrollView` with `entry.tickets.map(ticket => <QRCode value={ticket.qrCode} size={200} />)`. No PDF anywhere in this file. No download action. The "View ticket" CTA only opens the QR modal.

**Bottom-sheet primitive** — none in `app-mobile/src/components/ui/`. App-wide pattern for half-screen sheets is raw `<Modal>` + flex-end backdrop, used here and elsewhere. No `Sheet.tsx` / `BottomSheet.tsx` exists. (Distinct from `mingla-business` which has a `TopSheet`.)

**PDF rendering capability** — `react-native-webview@13.15.0` is the only viewer in the manifest. No `react-native-pdf`, no `@react-pdf/renderer` (web-only anyway), no `expo-print` (that's a producer, not a viewer). No `expo-file-system`, no `expo-sharing`, no `expo-document-picker` (the picker is installed but it's a picker, not a viewer).

**Multi-ticket per order** — confirmed: `tickets` is an array; one order can hold N seats. The existing PDF generator handles this (one PDF page per ticket, single PDF file).

### Layer 4 — Runtime

Not exercised this turn (architectural investigation; described behaviour is fully covered by code reads above). Suspected runtime behaviours to verify in TEST:

- Tap "View ticket" on a paid order → QR modal opens with N QR codes (one per seat) and status line "Valid · Show at door". (suspected, source-only)
- Pending-payment order → "Finalizing…" pill renders instead of the View CTA; tap is impossible until `payment_status` transitions to `paid`. (proven via source — see BusinessEventCalendarRow.tsx:108-124)
- Buyer email arrives with PDF attached. (proven — implementation report for ORCH-0777 cites this.)

### Layer 5 — Data

Not queried this turn (read-only architectural investigation). One real production row shape is fully recoverable from the typed schema in §Layer 2; querying a live row would only confirm field presence/nullability that the TypeScript types already pin down.

## Findings (classified)

### 🔴 R-1 — Server-rendered PDF is ephemeral; mobile has no fetch path

| Field | Detail |
|---|---|
| File + line | `supabase/functions/ticket-confirmation-dispatch/index.ts:361-394` (render), `:448-460` (Resend attachment dispatch) |
| Code | Renders `buildTicketPdf(...)`, attaches `{filename, content: contentBase64}` to email; **no `supabase.storage.from(...).upload(...)` anywhere** |
| Current behaviour | PDF lives only in the buyer's email inbox |
| Required behaviour | Mobile client must be able to fetch the PDF bytes for the same order it owns |
| Causal chain | Buyer taps "View ticket" in app → no PDF source exists in the mobile data path → cannot render PDF in sheet |
| Verification | `grep -rn "storage.from" supabase/functions/ticket-confirmation-dispatch/ supabase/functions/_shared/ticketPdf.ts` returns zero matches; `ls supabase/functions/` shows no `ticket-pdf-*` fetch function |

Confidence: **proven** (source).

### 🔴 R-2 — No PDF rendering library is installed in app-mobile

| Field | Detail |
|---|---|
| File + line | `app-mobile/package.json` deps list |
| Code | Only `react-native-webview@13.15.0` exists; no `react-native-pdf`, no `expo-print`, no `expo-file-system`, no `expo-sharing` |
| Current behaviour | Even if we obtained PDF bytes, the app has no way to display them |
| Required behaviour | PDF viewer that works on **both iOS and Android** |
| Causal chain | Bytes arrive → no renderer → no PDF visible |
| Verification | `grep -E "pdf\|print\|sharing\|file-system" app-mobile/package.json` — only matches `react-native-webview` |

Confidence: **proven** (source).

**Renderer options:**

| Option | iOS | Android | Native rebuild? | Notes |
|---|---|---|---|---|
| `react-native-webview` only (data: URI or remote URL) | ✅ native PDFKit | ❌ Android WebView does NOT render PDF natively | No (already installed) | Android workaround = Google Docs viewer `https://docs.google.com/gview?embedded=true&url=<signedUrl>` — requires public-fetchable URL and is slow / privacy-questionable |
| `react-native-pdf` (pdfium) | ✅ | ✅ | **Yes — `eas build`** | The cross-platform answer. Stable, widely deployed. New native dep. |
| Open PDF in external app via `expo-sharing` / `Linking` | ✅ Quick Look | ✅ Intent picker | No (just adds expo modules) | Doesn't render IN the sheet — leaves the app. Operator explicitly asked for "rendered in the sheet." Inadequate by itself; OK as fallback. |

### 🔴 R-3 — Active-section merge model: option (b) sort-merge-at-render is the right call

Evaluated against the requirements:

**Option (a) — Homogenise upstream into `CalendarEntry[]`.**
Pros: single render path, single filter pass.
Cons: `CalendarEntry` shape (`app-mobile/src/services/calendarService.ts:13-35`) and `BusinessEventCalendarRow` are fundamentally different concepts (saved-card with optional schedule vs. paid order with N seats + payment lifecycle); coercing tickets into `CalendarEntry` shape would either fabricate fields or balloon the type into a discriminated union — touches the parent prop flow (AppStateManager → LikesPage → CalendarTab), AppStateManager scheduled-card detection logic, and every consumer of `CalendarEntry`. Blast radius is significantly larger than the operator-requested change.

**Option (b) — Sort-merge inside CalendarTab Active render block.**
Pros: blast radius scoped to `CalendarTab.tsx` only; both arrays retain native types; rendering each row picks the right component (`renderCalendarEntry` for `CalendarEntry`, `BusinessEventCalendarRow` for orders); filter behaviour can be made consistent (search by title, when/category/tier filters — see §Filter parity below); animation system works unchanged because each row has a stable id.
Cons: Active accordion now mixes two row shapes — must ensure visual consistency. The empty-state computation (`renderEmptyComponent("active")`) needs to consider both arrays.

**Option (c) — Nested group inside Active (Tickets sub-header).**
Pros: keeps tickets visually distinct.
Cons: defeats the operator's stated goal of unified Active feed; adds an accordion-within-accordion problem.

**Recommendation: option (b).** Concretely:

- Inside the Active render block, build a unified `unifiedActiveRows` array:
  - From `filteredActiveEntries`: `{ kind: "calendar", sortAt: scheduledDate ?? +∞, row: entry }`
  - From `businessOrders` filtered through (matchesSearch by `eventTitle`, matchesWhen by `masterDateUtc`, matchesCategory = "all"/skip — see below, matchesTier = skip): `{ kind: "ticket", sortAt: masterDateUtc ?? +∞, row: order }`
- Sort ascending by `sortAt` (soonest first), tickets with null date go to bottom.
- Render via `kind` switch.
- Active header count = `unifiedActiveRows.length`.

**Filter parity decisions** (operator should confirm in spec phase):
- `selectedCategory` and `selectedTier` filters target Mingla category/price-tier — irrelevant for a business event ticket. Apply only to `CalendarEntry`. Tickets always pass these filters.
- `selectedWhen` filter (`today`/`this_week`/`this_month`/`upcoming`) — should apply uniformly using `masterDateUtc` for tickets. Tickets with `masterDateUtc === null` ("date to be announced") only show under `all`.
- `searchQuery` — match `eventTitle` and `brandName` for tickets.

**Archive section** — for symmetry, past-date tickets (`masterDateUtc < now` AND `paymentStatus !== "pending"`) should also drop into the Archive accordion using the same merge. Operator hasn't explicitly asked but this is the natural extension; flag in spec for confirm.

Confidence: **probable** (design recommendation, not yet validated against operator-confirmed UX flow).

### 🟠 C-1 — Pending-payment tickets should not be tappable for PDF view

Per `BusinessEventCalendarRow.tsx:108-124`, pending orders render "Finalizing…" instead of the View CTA. This is correct — there are no tickets yet. The new bottom-sheet flow must preserve this: tap on a pending row does nothing OR shows a status-only sheet. The PDF endpoint will reject pending orders (no `tickets` rows yet).

Confidence: proven.

### 🟠 C-2 — `attendeeNameHint` and `logoUrl` must flow to the fetch path

The existing `buildTicketPdf` input takes `attendeeNameHint` and an optional `logoUrl` (Mingla wordmark PNG, fallback to text). The current dispatch passes these from order/buyer metadata. The new fetch path must reconstruct the same `TicketPdfInput` so the rendered PDF matches what was emailed. Otherwise buyers will see a "different ticket" in the app vs. their inbox.

Confidence: proven (source).

### 🟡 H-1 — I-RN-SUB-SHEET-INSIDE-PARENT invariant applies

Per memory `feedback_rn_sub_sheet_must_render_inside_parent.md`: any sub-sheet (e.g., a confirmation toast or share menu rendered from inside the PDF sheet) must render INSIDE the parent `<Modal>`'s children, NOT as a Fragment sibling. Cycle 12 `CreatorStep5Tickets.tsx:1368-1386` is the verbatim pattern. The PDF sheet's "Save to Files" action share-sheet (if used) must obey this.

### 🟡 H-2 — Pattern: stay on raw RN `<Modal>` (no formal Sheet primitive)

The Active-list change should NOT introduce a new `<BottomSheet>` primitive without orchestrator approval (DEC-080 / DEC-152 govern TopSheet usage; there's no `BottomSheet` equivalent ruling because none exists). The PDF sheet should mirror the existing pattern in `BusinessEventCalendarRow.tsx:128-181` (raw `<Modal animationType="slide" transparent>` + flex-end backdrop + 85%-max-height card). Operator can flag if a primitive is wanted; that's a separate ORCH.

### 🔵 O-1 — `publicBuyerUrl` already exists on the row

`BusinessEventCalendarRow` shape has `publicBuyerUrl: string | null`. This is the same URL used in the buyer email's web fallback. Could be used as a "View on web" tertiary action inside the PDF sheet, useful if `react-native-pdf` ever fails to load.

### 🔵 O-2 — `entry.tickets[].qrCode` is the live QR — keep it accessible

If the PDF is slow to load or the buyer's phone is offline at the door, the existing QR-grid view is the failsafe. Recommend keeping a "Show QR codes" toggle/secondary action in the new sheet (collapsed by default; PDF is primary).

## Recommended Path (architectural plan for SPEC phase)

### Path A — Storage-write on dispatch (recommended)

1. **Edge function change**: in `ticket-confirmation-dispatch`, after `buildTicketPdf` succeeds, upload to a private bucket `ticket-pdfs/<orderId>.pdf` BEFORE sending the email. On idempotent retries (already-uploaded), use head-check to skip re-upload.
2. **New bucket**: `ticket-pdfs`, private, RLS: SELECT allowed only to the order owner (`auth.uid() = orders.buyer_user_id`). Or skip RLS and use signed URLs from edge function (simpler).
3. **New edge function** `ticket-pdf-fetch(orderId)`: validates caller owns the order, returns a 60-second signed URL to the storage object. Optionally: 404 if `payment_status !== 'paid'`.
4. **Mobile**: new service method `TicketService.fetchTicketPdfUrl(orderId)` → calls the edge function → returns signed URL.
5. **Backfill**: existing paid orders pre-cutover have no stored PDF. Two sub-options:
   - (i) Lazy-build on `ticket-pdf-fetch`: if storage object missing, run `buildTicketPdf` inline, upload, then return signed URL. One-time slow path. **Recommended.**
   - (ii) Backfill job: iterate paid orders, render-and-upload. Bigger lift; do only if needed.

### Path B — Pure on-demand re-render (no storage)

1. New edge function `ticket-pdf-fetch(orderId)`: validates ownership, re-runs `buildTicketPdf`, streams the bytes as `application/pdf` directly.
2. Mobile: downloads into a temp file via `expo-file-system`, then displays via `react-native-pdf` from local path.
3. Pros: zero storage cost, zero retention question, simpler.
4. Cons: re-renders on every open (250-500ms latency depending on tickets count); duplicates work; slightly more CPU on the function.

**Recommendation: Path A with lazy-build backfill (5.i).** Best of both worlds — first-open warms storage, subsequent opens are instant CDN fetches.

### Recommended client stack

- **PDF renderer**: `react-native-pdf` (cross-platform, native rebuild required).
- **Download/save**: `expo-file-system` (download to cache) + `expo-sharing.shareAsync(localUri)` (iOS Files / Android share intent).
- **Sheet primitive**: stay on raw RN `<Modal>` matching current pattern.
- **Native rebuild gate**: this is NOT OTA-able. The operator must accept that ORCH-0842 ships via a new `eas build` for both iOS and Android. Follow `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` for the iOS dev-build flow during TEST.

### Active-section merge

Option (b) sort-merge inside CalendarTab, with the filter-parity rules listed in R-3. Delete the standalone Tickets block at lines 1767-1786. Active header count = unified count. Empty-state shows when BOTH arrays are empty.

## PDF-source verdict

**Partial.** The renderer (`_shared/ticketPdf.ts`) is production-grade and the dispatch path uses it correctly. The gap is persistence + fetch — currently the PDF only reaches the buyer via Resend email attachment. SPEC must add either a storage upload step in the dispatch OR an on-demand re-render endpoint. Recommended: Path A above.

## Bottom-sheet + PDF-render library recommendation

- **Sheet:** mirror existing raw `<Modal animationType="slide" transparent statusBarTranslucent>` pattern from `BusinessEventCalendarRow.tsx:128-181`. No new primitive.
- **PDF renderer:** `react-native-pdf` (custom dev-client rebuild required; Expo SDK 54 + Xcode 26 — use IOS_DEV_BUILD_REBUILD_RUNBOOK). WebView-only is rejected because Android WebView does not render PDFs natively, and the Google Docs Viewer fallback requires a publicly-fetchable URL (privacy regression) and is slow.
- **Loading:** placeholder spinner (matches existing `<ActivityIndicator>` usage) while PDF bytes load.
- **Error path:** if PDF fetch fails, fall back to the existing QR grid + `publicBuyerUrl` as "View on web".

## Download-action recommendation

- Add `expo-file-system` and `expo-sharing` to the build.
- Download button in sheet → `FileSystem.downloadAsync(signedUrl, cacheUri)` → `Sharing.shareAsync(cacheUri, { mimeType: "application/pdf", dialogTitle: "Save ticket" })`.
- iOS: routes to share sheet → "Save to Files" available natively.
- Android: routes to share intent → file managers, Drive, email all available.
- No Photos / MediaLibrary save (PDF is not an image; standard share is the right pattern).
- Filename = `tickets-${order.shortId}.pdf` (matches email attachment filename).

## Open questions for operator (must answer in SPEC phase)

1. **Archive section parity** — should past-date paid orders also appear in the Archive accordion (parallel to past-date calendar entries), or only ever in Active? Default recommendation: yes, mirror Active behaviour using the same merge.
2. **Filter parity** — confirm tickets pass `selectedCategory` / `selectedTier` filters unconditionally (those filters target Mingla taxonomy and don't apply to business events). Default: yes.
3. **Path A vs Path B** — storage-write on dispatch (recommended) vs on-demand re-render. Storage choice has small monthly cost but better latency.
4. **Backfill** — accept lazy-on-first-open backfill for pre-cutover paid orders (recommended), or run a backfill job? Lazy is simpler; one-time slow open per existing order.
5. **Download UX** — confirm "Save to Files / share-sheet" is what you want, or do you want a more bespoke "saved!" toast with a deep-link to the local file? Default: standard share sheet, matches platform conventions.
6. **`react-native-pdf` adds native deps** — confirm acceptance that ORCH-0842 ships via a new `eas build`, not OTA. Cycle time ~30-40 min iOS + Android.
7. **Should the PDF sheet also expose the QR grid?** Recommendation: yes, as a collapsed secondary action — useful if PDF fails or buyer is offline at the door.

## Discoveries for orchestrator

- **D-1** — `BusinessEventCalendarRow.tsx` has no haptic on the View CTA. Minor UX gap. Not in scope for ORCH-0842; consider a polish ORCH.
- **D-2** — `useBusinessEventOrders` has `retry: false` (calendarEntries.ts:71). On flaky networks the section silently empties. Consider lightweight retry-with-backoff in a future polish pass.
- **D-3** — There's an implicit invariant that should be added: I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER — the PDF for an order must be fetchable by `auth.uid() = orders.buyer_user_id` and ONLY that user. Worth codifying when ORCH-0842 closes.
- **D-4** — `_shared/ticketPdf.ts` has a 5 MB size cap. Edge-function streaming for very large group orders (>50 tickets) may approach this — verify in SPEC. Today the typical order is 1-4 tickets.

## Confidence per finding

| Finding | Confidence | Basis |
|---|---|---|
| R-1 PDF ephemeral | **proven** | source: grep + read of dispatch + ticketPdf.ts |
| R-2 no renderer installed | **proven** | source: package.json grep |
| R-3 merge model recommendation | **probable** | architectural reasoning; needs operator UX confirmation on filter behaviour |
| C-1 pending tickets non-tappable | **proven** | source: BusinessEventCalendarRow.tsx |
| C-2 attendee/logo must flow to fetch | **proven** | source: ticketPdf.ts input shape |
| H-1 sub-sheet invariant | **proven** | memory + Cycle 12 reference |
| H-2 raw Modal pattern | **probable** | local-pattern observation |
| Path A vs Path B | **probable** | recommendation; either is buildable |
| Renderer choice (`react-native-pdf`) | **probable** | based on Android WebView limitation; operator may have a stronger preference |

No `proven`-level sim repro was performed this turn because the dispatch is architectural; nothing in the current UI is "broken in a way you need to see" — the existing QR modal works as designed and the Tickets section renders as documented. The TEST phase after implementation MUST include iOS sim + Android emulator live-fire per the platform-parity mandate.
