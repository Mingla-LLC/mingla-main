# SPEC — ORCH-0842 [Fold Tickets into Active + render real ticket PDF in bottom sheet with venue/QR/Save]

**Owner:** Claude `mingla-forensics` (SPEC mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-16
**Investigation input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0842_TICKETS_INTO_ACTIVE_AND_PDF_SHEET.md`
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0842_TICKETS_INTO_ACTIVE_AND_PDF_SHEET.md`
**Pipeline next:** Codex `implementor-mingla` → orchestrator deploy → Claude `mingla-tester`.

---

## 1. Scope, Non-Goals, Assumptions

### 1.1 Scope (in)

1. Server: persist the ticket PDF that `ticket-confirmation-dispatch` builds into a private Supabase Storage bucket (`ticket-pdfs`), keyed by order id, after successful render. Idempotent on Resend retry.
2. Server: new edge function `ticket-pdf-fetch` returning a 60-second signed URL to the stored object for the order's buyer, with lazy backfill (re-render + upload on first miss for paid orders).
3. Server: one migration adding column `orders.ticket_pdf_path text` (nullable), bucket `ticket-pdfs` (private, no public read), and three new invariants codified in code comments.
4. Mobile (`app-mobile/`): extend `CalendarService.fetchUserBusinessEventOrders` SELECT to include venue fields and surface them on `BusinessEventCalendarRow`.
5. Mobile: delete the standalone "Tickets" block at [CalendarTab.tsx:1767-1786](app-mobile/src/components/activity/CalendarTab.tsx#L1767-L1786) and sort-merge `businessOrders` into the Active and Archive accordions using a discriminated-union pattern (no homogenisation upstream).
6. Mobile: extend `BusinessEventCalendarRow.tsx` to (a) keep the existing tap-to-open behaviour but route to a new `TicketPdfSheet`, (b) preserve "Finalizing…" pending guard.
7. Mobile: new `TicketPdfSheet.tsx` component rendering venue block, QR strip, embedded PDF view, and Save/Share action — using existing raw RN `<Modal>` pattern.
8. Mobile: new `TicketService.fetchTicketPdfUrl(orderId)` calling `ticket-pdf-fetch`.
9. Mobile: 4 new dependencies — `react-native-pdf`, `react-native-blob-util`, `expo-file-system`, `expo-sharing`. No others.
10. Native build cycle: new `eas build` for iOS + Android dev profiles, then production. NOT OTA-shippable. iOS dev-build uses [IOS_DEV_BUILD_REBUILD_RUNBOOK.md](Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md).
11. CI: 2 new strict-grep gates per [feedback_strict_grep_registry_pattern.md](.claude/projects/...) registry pattern — one for invariant I-PROPOSED-AK, one for I-PROPOSED-AL.

### 1.2 Non-goals (explicit)

- **No new sheet primitive.** Reuse raw RN `<Modal>` pattern from `BusinessEventCalendarRow.tsx:128-181`. A `BottomSheet.tsx` would need separate orchestrator approval (DEC-080/DEC-152 govern TopSheet only; no BottomSheet ruling exists).
- **No new mobile deps beyond the 4 named.** If the implementor discovers a 5th peer dep, STOP and surface as a blocker.
- **No backend deps.** `pdf-lib` is already present in `_shared/ticketPdf.ts`.
- **No changes to `_shared/ticketPdf.ts` PDF format / branding / fields.** Whatever ships in the buyer's email must be byte-equivalent to what renders in the sheet (single source of truth).
- **No changes to `mingla-business/`** (buyer-anon checkout / web preview). Out of surface scope.
- **No changes to `mingla-admin/`.** Admin has no consumer-ticket viewer.
- **No batch backfill job.** Lazy backfill on first fetch is the strategy; pre-cutover paid orders get one slow open then are warm.
- **No Photos / MediaLibrary save path.** PDF → standard share sheet (iOS "Save to Files", Android share intent).
- **No haptic added to View CTA in this ORCH** (investigation D-1 deferred to future polish ORCH).
- **No retry-with-backoff on `useBusinessEventOrders`** (investigation D-2 deferred).
- **No changes to QR generation, scan-ticket validation, or `tickets.qr_code` schema.**

### 1.3 Assumptions

- `events.location_text` (text) and `events.location_geo` (point) exist and are populated for the majority of brand-published events. Confirmed via `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7799-7800` — both fields present on baseline.
- `events.is_online` (boolean) and `events.online_url` (text) exist for online events. Confirmed `:7801-7802`.
- The buyer's auth.uid() === orders.buyer_user_id when calling `ticket-pdf-fetch`. Anonymous buyers (no Supabase user) are out-of-scope for in-app PDF viewing in THIS ORCH — they still get the email PDF as today. (Anonymous-buyer in-app viewing would require account claim + order linking; flag follow-up ORCH if needed.)
- Expo SDK 54 + RN 0.81.x is the current toolchain. `react-native-pdf@^7` and `react-native-blob-util@^0.22` are the compatible peer matrix; implementor verifies during install.
- Resend retries are idempotent on `ticket-confirmation-dispatch` invocation; the upload step must therefore be idempotent (`upsert: true`, deterministic path).

---

## 2. Cross-Surface Impact

| # | Surface | Covered? | What changes | Files touched | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | YES | Tickets fold into Active/Archive accordions; tap-to-open new PDF sheet with venue + QR strip + embedded PDF + Save action | `app-mobile/src/components/activity/CalendarTab.tsx`, `BusinessEventCalendarRow.tsx`, new `TicketPdfSheet.tsx`, `services/calendarService.ts`, new `services/ticketService.ts` method, `package.json` | Shared code with Android |
| 2 | Consumer Android | YES | Same as iOS | Same files | Shared code; success criteria SC-08..SC-10 explicitly call out Android-specific share-intent behaviour |
| 3 | Buyer/anonymous Web (`mingla-business/checkout/...` etc.) | NO | Buyer still receives PDF via Resend email as today. Anon buyers don't have in-app PDF viewing because they have no Supabase session to authenticate against `ticket-pdf-fetch`. | none | n/a |
| 4 | Business iOS | NO | Business app does NOT render consumer ticket calendars. | none | n/a |
| 5 | Business Android | NO | Same as #4. | none | n/a |
| 6 | Admin Web | NO | Admin has no buyer-ticket viewer surface. | none | n/a |
| 7 | Business Web preview | NO | Same as #4. | none | n/a |

**Parity model:** all consumer-app code is shared between iOS and Android (single React Native source). Native parity risk concentrates on `react-native-pdf` rendering (iOS PDFKit vs Android PdfiumAndroid) and `Sharing.shareAsync` semantics (Files app on iOS vs share intent on Android). Tester MUST exercise both platforms; tests SC-08-iOS / SC-08-Android, SC-09-iOS / SC-09-Android are split for the platform-divergent surfaces.

---

## 3. Layered Specification

### 3.1 Database layer

**One migration file:** `supabase/migrations/<YYYYMMDDhhmmss>_orch_0842_ticket_pdf_storage.sql`

Naming: follow existing convention. Latest migration prefix as of dispatch = `20260605000002`. Use prefix `20260606000000` (or next free) plus `_orch_0842_ticket_pdf_storage.sql`.

```sql
-- ORCH-0842: persist ticket PDFs to private storage so the buyer can view
-- the actual emailed PDF inside the consumer app. Single source of truth =
-- supabase/functions/_shared/ticketPdf.ts (per invariant I-PROPOSED-AL).

-- 1) Storage bucket — private; only signed URLs (60s TTL) issued by
-- `ticket-pdf-fetch` are allowed to read.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-pdfs',
  'ticket-pdfs',
  false,
  6 * 1024 * 1024,  -- 6 MB cushion above the ticketPdf 5 MB cap
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- No public SELECT policy. Object reads happen via signed URL only,
-- generated server-side by `ticket-pdf-fetch` after owner check. No INSERT
-- policy for client roles: uploads happen via service-role from
-- `ticket-confirmation-dispatch` and `ticket-pdf-fetch` (lazy backfill).
-- Service-role bypasses RLS, so no explicit policy needed.

-- 2) Pointer column on orders so the fetch endpoint can short-circuit
-- head-check. Nullable because backfill happens lazily.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ticket_pdf_path text;

COMMENT ON COLUMN public.orders.ticket_pdf_path IS
  'ORCH-0842: path within the private `ticket-pdfs` storage bucket where the rendered ticket PDF is stored (e.g. `tickets/<order_id>.pdf`). NULL until first successful upload; populated by `ticket-confirmation-dispatch` on send, or by `ticket-pdf-fetch` on lazy backfill. The PDF binary is generated by `supabase/functions/_shared/ticketPdf.ts` and MUST be byte-equivalent to the PDF attached to the buyer''s confirmation email.';
```

**No changes** to `orders` RLS policies. Existing select policy (`biz_can_read_order_for_caller` per `calendarService.ts:268-272` comment) is unchanged. The `ticket-pdf-fetch` function operates with service-role and does its OWN ownership check.

**No new policies** on `storage.objects` for the `ticket-pdfs` bucket. Service-role bypasses RLS; client roles MUST NOT have any read/write access. Verification: in the SPEC tester checklist, attempt `supabase.storage.from('ticket-pdfs').download(...)` with an anon and an authenticated session — both must fail.

### 3.2 Edge function layer — modify `ticket-confirmation-dispatch`

**File:** `supabase/functions/ticket-confirmation-dispatch/index.ts`
**Touch points:** lines `361-394` (render block) and `:448-460` (Resend attach). Add a storage upload step between render and email-send.

**Required behaviour after change:**

1. After `buildTicketPdf(...)` returns successfully, BEFORE invoking Resend:
   - Path = `tickets/${order.id}.pdf` (no nesting, deterministic).
   - Convert `contentBase64` → `Uint8Array` (Deno: `Uint8Array.from(atob(b64), c => c.charCodeAt(0))`).
   - `supabase.storage.from('ticket-pdfs').upload(path, bytes, { contentType: 'application/pdf', upsert: true })`.
   - On upload success: `UPDATE public.orders SET ticket_pdf_path = $1, updated_at = now() WHERE id = $2` (service-role client; no RLS concern).
   - On upload failure: **log warning, continue to Resend**. Email is the customer-facing artifact; the in-app sheet can lazy-backfill on first open. Do NOT fail the whole dispatch.
2. The existing Resend attach call (`:448-460`) is **unchanged** — same `filename`, same `contentBase64`. Email continues to ship with PDF attached exactly as today.
3. Idempotency: `upsert: true` is safe for Resend retries (overwrites the same byte-equivalent file). The `UPDATE orders SET ticket_pdf_path` is also idempotent (always the same path value).

**Error matrix:**

| Failure | Behaviour |
|---|---|
| Upload throws | Log `"[ticket-confirmation-dispatch] storage upload failed for order=<id>: <err>"`, swallow, continue to Resend. |
| UPDATE orders throws | Log, swallow, continue. Lazy backfill on fetch will re-run upload + UPDATE. |
| Resend send fails | Existing behaviour preserved (retryable). |

**Hard guard for implementor:** the upload step must NOT block or delay the Resend send by more than 500ms. If implementor sees a way to upload in parallel with Resend (e.g., `Promise.allSettled`), that's acceptable AS LONG AS the UPDATE orders step waits on upload completion.

### 3.3 Edge function layer — new `ticket-pdf-fetch`

**File:** `supabase/functions/ticket-pdf-fetch/index.ts`
**Verify-JWT:** `true` (this is a user-authenticated endpoint — buyer must be signed in).
**`config.toml` entry:** add `[functions.ticket-pdf-fetch]` matching the `verify_jwt = true` pattern of `scan-ticket` or other user-authed functions.

**Request shape:**

```ts
POST /functions/v1/ticket-pdf-fetch
Authorization: Bearer <user JWT>
Content-Type: application/json

{
  "orderId": string  // UUID
}
```

**Response shape (success):**

```ts
HTTP 200
{
  "signedUrl": string,           // 60-second signed URL to ticket-pdfs/tickets/<orderId>.pdf
  "expiresAt": string,           // ISO 8601 UTC
  "filename": string,            // "tickets-<shortId>.pdf" — matches email attachment filename
  "byteLength": number           // size of stored object (informational)
}
```

**Error matrix:**

| Condition | HTTP | Body |
|---|---|---|
| Missing/invalid JWT | 401 | `{ "error": "unauthorized" }` |
| Body missing `orderId` or invalid UUID | 400 | `{ "error": "bad_request", "field": "orderId" }` |
| Order does not exist | 404 | `{ "error": "not_found" }` |
| `orders.buyer_user_id !== auth.uid()` | 403 | `{ "error": "forbidden" }` |
| `orders.payment_status !== 'paid'` | 409 | `{ "error": "not_paid", "paymentStatus": "<actual>" }` |
| `payment_status === 'refunded' \| 'cancelled'` | 410 | `{ "error": "gone", "paymentStatus": "<actual>" }` |
| Lazy backfill fails (render or upload) | 500 | `{ "error": "render_failed", "detail": "<err msg>" }` |

**Procedure:**

1. Parse JWT, extract `auth.uid()`. Build service-role supabase client for DB ops, but verify ownership BEFORE touching storage.
2. `SELECT id, buyer_user_id, payment_status, ticket_pdf_path, event_id, buyer_name FROM orders WHERE id = $1`.
3. If row missing → 404. If `buyer_user_id !== auth.uid()` → 403. If `payment_status === 'pending' | 'failed'` → 409. If `'refunded' | 'cancelled' | 'partial_refund'` → 410.
4. If `ticket_pdf_path` is non-null: head-check object existence via `supabase.storage.from('ticket-pdfs').list('tickets', { search: '<orderId>.pdf' })` (or equivalent). If present, skip to step 6.
5. Lazy backfill: load full order + event + tickets + brand (mirror the inputs `_shared/ticketPdf.ts` expects), call `buildTicketPdf(...)`, upload bytes to `tickets/<orderId>.pdf`, UPDATE `orders.ticket_pdf_path`. On any error → 500.
6. `supabase.storage.from('ticket-pdfs').createSignedUrl(path, 60)` → returns `{ signedUrl, ... }`.
7. Return 200 with body shape above. `filename` is computed as `tickets-${order.id.slice(0, 8)}.pdf` to match the email attachment filename format from `_shared/ticketPdf.ts`.

**Hard guards:**

- MUST call `buildTicketPdf` from `_shared/ticketPdf.ts` for lazy backfill — no parallel renderer (invariant I-PROPOSED-AL).
- MUST verify `auth.uid()` ownership before any storage operation (invariant I-PROPOSED-AK).
- MUST NOT return the signed URL on a non-paid order (prevents leaking pre-payment PDFs).
- MUST NOT return the signed URL on a refunded/cancelled order (PDF is no longer a valid claim).

### 3.4 Mobile service layer

**File:** `app-mobile/src/services/calendarService.ts`

**Extend `fetchUserBusinessEventOrders` SELECT** (currently at `:286`):

```ts
.select(`
  id, event_id, payment_status, created_at, ticket_pdf_path,
  events!inner (
    id, title, slug, cover_media_url, timezone,
    location_text, location_geo, is_online, online_url,
    brand:brands!inner ( id, slug, name ),
    event_dates!left ( id, start_at, end_at, is_master )
  ),
  tickets:tickets ( id, ticket_type_id, qr_code, status, attendee_name, attendee_email )
`)
```

**Extend `BusinessEventCalendarRow` type** (currently `:64-84`):

```ts
export interface BusinessEventVenue {
  // Hierarchy: prefer locationText for display. If absent, hint with isOnline.
  locationText: string | null;     // free-text address as set by event creator
  locationGeoLat: number | null;   // parsed from PostGIS point; null if unset
  locationGeoLng: number | null;   // parsed from PostGIS point; null if unset
  isOnline: boolean;
  onlineUrl: string | null;        // present iff isOnline === true and creator set one
}

export interface BusinessEventCalendarRow {
  // ...existing fields...
  ticketPdfPath: string | null;    // null pre-cutover or pre-render; truthy after first send
  venue: BusinessEventVenue;       // derived from events.location_*
}
```

**Parse PostGIS point**: `location_geo` arrives as a string like `"(lng,lat)"` (PostGIS point text form when selected via PostgREST). Parse defensively:

```ts
function parseLocationGeo(raw: unknown): { lat: number | null; lng: number | null } {
  if (typeof raw !== "string") return { lat: null, lng: null };
  const match = raw.match(/^\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?$/);
  if (!match) return { lat: null, lng: null };
  const lng = parseFloat(match[1]);  // PostGIS point is (x,y) = (lng,lat)
  const lat = parseFloat(match[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { lat: null, lng: null };
  return { lat, lng };
}
```

Implementor MUST verify the actual shape PostgREST returns for `point` columns — if it returns `{ x, y }` object form instead of string, adjust the parser. Verification step: call the SELECT once against a paid order with a known venue, log the raw value, branch from there.

**New `TicketService` method** — recommended new file `app-mobile/src/services/ticketService.ts` (or extend an existing service if one is the natural home; implementor's call):

```ts
export interface TicketPdfFetchResponse {
  signedUrl: string;
  expiresAt: string;   // ISO
  filename: string;
  byteLength: number;
}

export class TicketService {
  static async fetchTicketPdfUrl(orderId: string): Promise<TicketPdfFetchResponse> {
    const { data, error } = await supabase.functions.invoke<TicketPdfFetchResponse>(
      "ticket-pdf-fetch",
      { body: { orderId } },
    );
    if (error) {
      // Use the shared edgeFunctionError utility per project pattern
      throw await mapEdgeFunctionError(error);
    }
    if (!data) throw new Error("Empty response from ticket-pdf-fetch");
    return data;
  }
}
```

**Hard guard:** error path MUST use the existing `app-mobile/src/utils/edgeFunctionError.ts` utility per the established RN polyfill memory (`Supabase Error Handling in React Native`). Do NOT use `instanceof Response`. Do NOT call `.json()` directly.

### 3.5 Hook layer

**No new hook required.** `useBusinessEventOrders` (per investigation, at `app-mobile/src/hooks/.../calendarEntries.ts:71`) continues to drive the listing. The PDF fetch is per-tap, on-demand — not a list-level concern.

**TicketPdfSheet manages its own state** with local `useState` for: `{ status: 'idle' | 'loading' | 'ready' | 'error', signedUrl: string | null, localUri: string | null, error: string | null }`. The PDF URL is fetched on sheet open, the file is downloaded into `FileSystem.cacheDirectory + 'ticket-pdf-<orderId>.pdf'`, and `react-native-pdf` renders from the local URI.

**React Query is not used** for the PDF fetch because the signed URL has 60s TTL — caching it would expire mid-session. The local file IS cached on the filesystem under `cacheDirectory` so re-opens within the same session don't re-download. If the local file exists AND the cached URL is < 60s old, skip the fetch.

### 3.6 Component layer

#### 3.6.1 `CalendarTab.tsx` — sort-merge into Active/Archive

**Delete:** `app-mobile/src/components/activity/CalendarTab.tsx:1767-1786` (the standalone Tickets block).

**Modify the Active/Archive partition** (currently `:184-207`): split `businessOrders` into past vs. future using `masterDateUtc` (null → treat as future per UX rule below). Then merge each partition with the corresponding `CalendarEntry` partition.

**Discriminated-union row type** (local to CalendarTab.tsx; do NOT add to calendarService.ts):

```ts
type UnifiedActiveRow =
  | { kind: "calendar"; key: string; sortAt: number; entry: CalendarEntry }
  | { kind: "ticket"; key: string; sortAt: number; row: BusinessEventCalendarRow };
```

**Sort key:**
- Calendar entries: `scheduledDate.getTime()` (existing behaviour).
- Tickets: `masterDateUtc ? Date.parse(masterDateUtc) : Number.POSITIVE_INFINITY`.
- Sort ascending (soonest first). Nulls go to bottom of Active.

**Filter parity rules (per operator Q2 in dispatch):**

| Filter | Calendar entries | Tickets |
|---|---|---|
| `searchQuery` | Existing matchesSearch | match `row.eventTitle` OR `row.brandName` case-insensitive |
| `selectedWhen` ('today'/'this_week'/'this_month'/'upcoming'/'all') | Existing | Apply same window using `masterDateUtc`. Null-date tickets pass ONLY when `selectedWhen === 'all'`. |
| `selectedCategory` (Mingla taxonomy) | Existing | **Always pass** (tickets are business events, not Mingla cards). |
| `selectedTier` (price tier) | Existing | **Always pass.** |

**Stable keys:**
- Calendar: `key = "calendar:" + entry.id`
- Ticket: `key = "ticket:" + row.orderId`

**Header count:** `unifiedActiveRows.length` (replaces the existing `filteredActiveEntries.length`).

**Empty state:** show "no upcoming…" message only when BOTH source arrays are empty for that partition.

**Animation:** existing `getCardAnimation(index, count)` system applies to the unified array using `index = unifiedActiveRows.indexOf(row)`. Both row types animate identically.

**Render switch:**

```tsx
{unifiedActiveRows.map((row, index) => {
  const anim = getCardAnimation(index, unifiedActiveRows.length);
  return row.kind === "calendar"
    ? renderCalendarEntry(row.entry, index, anim)            // existing fn
    : <BusinessEventCalendarRow                              // existing component, updated handler
        key={row.key}
        entry={row.row}
        animation={anim}
      />;
})}
```

**Archive mirror:** identical structure for the Archive accordion. Past-date paid orders (`masterDateUtc < now` AND `paymentStatus !== 'pending'`) drop into Archive.

#### 3.6.2 `BusinessEventCalendarRow.tsx` — route tap to new sheet

**Existing behaviour to preserve:**
- Pending-payment guard (`:108-124`) — "Finalizing…" pill replaces View CTA; tap on pending row does NOTHING.
- Visual layout (cover image, title, brand, date row) — unchanged.

**Change:** when the "View ticket" CTA is tapped on a paid order, open `<TicketPdfSheet />` instead of the current QR modal. The existing QR modal code at `:128-181` is DELETED (replaced by the new sheet). The new sheet provides the same QR content + much more.

**Animation prop (new):** accept optional `animation?: { opacity: Animated.Value, translateY: Animated.Value }` passed by CalendarTab so the row participates in the staggered entrance.

#### 3.6.3 New component: `TicketPdfSheet.tsx`

**Path:** `app-mobile/src/components/activity/TicketPdfSheet.tsx`

**Props:**

```ts
interface TicketPdfSheetProps {
  visible: boolean;
  onClose: () => void;
  entry: BusinessEventCalendarRow;  // full row — gives us tickets, venue, title, etc.
}
```

**Layout (top → bottom):**

1. **Sheet container.** Raw RN `<Modal animationType="slide" transparent statusBarTranslucent visible={visible} onRequestClose={onClose}>` matching `BusinessEventCalendarRow.tsx:128-181` pattern. Flex-end backdrop with `rgba(0,0,0,0.5)`. Card has `maxHeight: '92%'`, `borderTopLeftRadius: 24, borderTopRightRadius: 24`, white background.

2. **Drag-handle** — 4px tall × 40px wide grey pill, centred, 12px from top.

3. **Header row** — close X (left), event title (centre, truncate), brand name (small grey beneath title).

4. **Venue block** — wrapped in a single `View` with 16px horizontal padding. Display logic:

   | Condition | Render |
   |---|---|
   | `venue.isOnline === true` | "Online event" label + (if `onlineUrl`) "Open link" button → `Linking.openURL(onlineUrl)` |
   | `venue.locationText` non-empty | Address text (multi-line OK) + (if `locationGeoLat` && `locationGeoLng`) "Open in Maps" button → `Linking.openURL(buildMapsUrl(lat, lng, locationText))` |
   | `locationText` empty AND not online | "Venue details in your email" (italic, grey) |

   `buildMapsUrl(lat, lng, label)` helper:
   ```ts
   function buildMapsUrl(lat: number, lng: number, label?: string | null): string {
     const q = encodeURIComponent(label ?? "");
     return Platform.OS === "ios"
       ? `maps://?q=${q}&ll=${lat},${lng}`
       : `geo:${lat},${lng}?q=${lat},${lng}(${q})`;
   }
   ```
   No new dep needed — `Linking` is React Native built-in.

5. **QR strip** (always visible). Title "Show at door" (small, bold). Horizontal `ScrollView` with `showsHorizontalScrollIndicator={false}`. Each ticket renders as a card:
   - 140x140 QR using existing `react-native-qrcode-svg` `<QRCode value={ticket.qrCode} size={140} />` (same lib the current QR modal uses — already installed).
   - Below QR: attendee name (truncate at 1 line) OR "Guest #N" fallback.
   - Below name: ticket-type label IF derivable (skip if not — investigation didn't surface a ticket-type-name lookup; if implementor finds one via `ticket_types` table join, add it; otherwise omit).
   - Status pill: green "Valid" / grey "Used" / red "Void" — same colour map as current row.

6. **PDF view** (primary, takes remaining vertical space). States:
   - `idle` / `loading`: centred `<ActivityIndicator size="large" />` + label "Loading ticket PDF…".
   - `ready`: `<Pdf source={{ uri: localUri }} style={{ flex: 1 }} enablePaging horizontal={false} />`. Default `react-native-pdf` controls (scroll, pinch-zoom) enabled. No custom paging UI.
   - `error`: centred error icon + message "Couldn't load ticket PDF." + "Try again" button (re-runs fetch) + "View on web" button if `publicBuyerUrl` is non-null (opens via `expo-web-browser.openBrowserAsync(publicBuyerUrl)`).

7. **Action row** (bottom, sticky). Single button "Save / Share". Behaviour:
   - Disabled while `state.status !== 'ready'`.
   - On press: `Sharing.shareAsync(localUri, { mimeType: 'application/pdf', dialogTitle: 'Save ticket', UTI: 'com.adobe.pdf' })`.
   - iOS routes to native share sheet → "Save to Files" available.
   - Android routes to share intent → file managers, Drive, email, etc.
   - **MUST render inside the parent `<Modal>` children** per invariant I-RN-SUB-SHEET-INSIDE-PARENT — `Sharing.shareAsync` is a native OS-level call (not a JS sibling Modal), so no children-vs-sibling concern, but if implementor ever adds a confirmation toast or share menu of their own, it MUST live inside the parent `<Modal>`'s children tree.

**Fetch + download flow on sheet open:**

```
useEffect when visible flips false → true:
  1. setState { status: 'loading' }
  2. const { signedUrl, filename } = await TicketService.fetchTicketPdfUrl(entry.orderId)
  3. const localUri = FileSystem.cacheDirectory + `ticket-pdf-${entry.orderId}.pdf`
  4. await FileSystem.downloadAsync(signedUrl, localUri)
  5. setState { status: 'ready', localUri, signedUrl }
  On any throw: setState { status: 'error', error: err.message }
```

**Local-cache short-circuit:** before step 2, check `FileSystem.getInfoAsync(localUri)`. If exists AND `mtimeMs > Date.now() - 50_000` (50s, comfortably under the 60s signed-URL TTL — but we're using a local file, the TTL doesn't matter; the 50s is a "freshness" heuristic for re-opens within the same session), skip to `status: 'ready'` directly.

**Cleanup on unmount:** keep the cache file (Expo manages `cacheDirectory` lifecycle). Do NOT delete on close — the next tap on the same ticket should be instant.

**Pending guard:** `TicketPdfSheet` MUST NOT be reachable from a pending-payment row. The pending guard lives in `BusinessEventCalendarRow.tsx` (the View CTA is replaced by "Finalizing…"). The sheet itself trusts that any tap into it represents a paid order, but it still surfaces a clean error if `ticket-pdf-fetch` returns 409 (not_paid).

### 3.7 Native module configuration

**`app-mobile/package.json`** — add to `dependencies`:

```json
"react-native-pdf": "<implementor pins compatible version>",
"react-native-blob-util": "<implementor pins compatible version>",
"expo-file-system": "~19.0.22",
"expo-sharing": "<implementor pins Expo SDK 54 compatible version>"
```

Implementor MUST verify Expo SDK 54 / RN 0.81.x compatibility for `react-native-pdf` and `react-native-blob-util` and pin to a known-good version. If incompatible, STOP and flag.

**`app-mobile/app.json` plugins array** — add Expo config plugins if the packages provide them:
- `react-native-pdf` (verify if a plugin exists for autolinking — typically autolinks without a plugin in RN 0.71+).
- `expo-file-system` — no plugin needed; first-party.
- `expo-sharing` — no plugin needed; first-party.

**iOS:** native rebuild via [IOS_DEV_BUILD_REBUILD_RUNBOOK.md](Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md). Do NOT use `npx expo run:ios` (Expo SDK 54 + Xcode 26 devicectl regression).

**Android:** `eas build --profile development --platform android` then production. Pixel-emulator verification.

**Bundle size delta:** implementor logs the .ipa / .apk size before and after in the implementation report.

### 3.8 Edge function deployment

After implementor returns, orchestrator deploys both functions:

```bash
/Users/sethogieva/bin/supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy ticket-pdf-fetch --project-ref gqnoajqerqhnvulmnyvv
```

Verify versions via `mcp__supabase__list_edge_functions`. `verify_jwt` settings: `ticket-confirmation-dispatch` preserves its existing setting (typically `false` for webhook-triggered functions; implementor MUST NOT flip it); `ticket-pdf-fetch` ships with `verify_jwt: true`.

### 3.9 CI gates — strict-grep registry pattern

**File:** `.github/workflows/strict-grep-mingla-business.yml` — add 2 jobs.

**Gate 1: I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER**
Script: `.github/scripts/strict-grep/i-ticket-pdf-owner-check.mjs`
Verifies that `supabase/functions/ticket-pdf-fetch/index.ts` contains BOTH:
- A reference to `auth.uid()` or equivalent JWT user-id extraction.
- A comparison against `buyer_user_id` (string match).
Fails the build if either is absent.

**Gate 2: I-PROPOSED-AL TICKET_PDF_SINGLE_SOURCE_OF_TRUTH**
Script: `.github/scripts/strict-grep/i-ticket-pdf-single-renderer.mjs`
Verifies that `pdf-lib` is imported ONLY in `supabase/functions/_shared/ticketPdf.ts`. Greps all `supabase/functions/**/*.ts` for `from "https://esm.sh/pdf-lib"` or `from "pdf-lib"` — fails the build if any match outside `_shared/ticketPdf.ts`.

Add both jobs to the matrix in `strict-grep-mingla-business.yml` following the existing one-script-one-job pattern. Do NOT create a new workflow file.

---

## 4. Success Criteria

Each criterion is observable, testable, and unambiguous. Per-platform suffix (`-iOS` / `-Android`) is used where parity is manual or platform-divergent.

| # | Criterion | Verification |
|---|---|---|
| SC-01 | The standalone "Tickets" block above the Active accordion is gone. | Visual: scroll the Likes → Calendar tab on a user with paid orders — no separate "Tickets" header is visible. Code: `app-mobile/src/components/activity/CalendarTab.tsx:1767-1786` is deleted. |
| SC-02 | Paid future-dated orders appear inside the Active accordion, sorted chronologically with saved-card calendar entries. | Visual: on a user with both a saved-card scheduled for next Friday and a paid ticket for next Wednesday, Active shows Wednesday-ticket first, Friday-card second. |
| SC-03 | Paid past-dated orders appear inside the Archive accordion. | Visual: a paid order whose `masterDateUtc` is < now is in Archive, not Active. |
| SC-04 | The Active header count equals (filtered calendar entries) + (filtered tickets). | Open Active with 3 calendar entries + 2 tickets visible → header reads "(5)". |
| SC-05 | Filter chips behave per the parity table in §3.6.1. | Apply `selectedTier=bougie` → tickets remain visible (always pass tier). Apply `searchQuery="rooftop"` → only entries whose title or brand contains "rooftop" remain. |
| SC-06 | Pending-payment tickets render "Finalizing…" and are NOT tappable into the PDF sheet. | Tap a pending row → nothing happens; "Finalizing…" pill is visible. |
| SC-07 | Tapping "View ticket" on a paid order opens a bottom sheet (not the old QR modal). | Visual: sheet slides up from bottom, fills ~92% of screen. |
| SC-08-iOS | The sheet renders the actual emailed PDF inline on iOS. | On a paid order, open sheet → after loading spinner, PDF page(s) render; pinch-zoom works; swipe scrolls between pages on multi-ticket orders. |
| SC-08-Android | The sheet renders the actual emailed PDF inline on Android. | Same as SC-08-iOS, exercised on Android emulator. |
| SC-09-iOS | "Save / Share" → iOS share sheet → "Save to Files" present. | Tap Save → share sheet appears with "Save to Files" option; save into Files app; reopen file → matches the emailed PDF byte-for-byte. |
| SC-09-Android | "Save / Share" → Android share intent → file managers / Drive / email present. | Tap Save → share intent picker appears with at least one file-handling option; save to Downloads → reopen → matches the emailed PDF. |
| SC-10 | The sheet displays venue info: address (or "Online event" or "Venue details in your email") plus "Open in Maps" / "Open link" when applicable. | For an event with `location_text="14 Foo St, London"` and a non-null `location_geo`: address text visible, "Open in Maps" button visible, tap → native Maps opens with pin. For `is_online=true`: "Online event" label + "Open link" button. For missing-everything: "Venue details in your email". |
| SC-11 | The sheet displays a QR strip with one QR per ticket, scrollable horizontally if N > 2. | For a 3-ticket order: 3 QR cards visible, horizontal scroll reveals all 3; each QR scans correctly via the scanner app (same `qr_code` value as today). |
| SC-12 | New paid orders (post-cutover) have their PDF persisted to storage on dispatch; `orders.ticket_pdf_path` is populated. | Buy a ticket → confirmation email arrives with PDF AS TODAY → SQL: `SELECT ticket_pdf_path FROM orders WHERE id=$1` returns non-null path. |
| SC-13 | Pre-cutover paid orders (with `ticket_pdf_path = null`) lazy-backfill on first sheet open and subsequent opens are fast. | Pick a paid order with `ticket_pdf_path = null`. Open sheet → first open: ~2-5s render (lazy backfill). Close, reopen → < 500ms (warm cache). SQL: `ticket_pdf_path` is now populated. |
| SC-14 | The in-sheet PDF is byte-equivalent to the email PDF. | Save in-sheet PDF, compare SHA256 to email attachment SHA256 → identical. |
| SC-15 | Ownership is enforced: user A cannot fetch user B's PDF. | Manually invoke `ticket-pdf-fetch` with user A's JWT + user B's orderId → response is 403. |
| SC-16 | Refunded orders return 410 from fetch (and the sheet shows a clear error message, not a stuck spinner). | Manually refund a paid order, attempt to open sheet → error state "This ticket is no longer valid" (or similar). |
| SC-17 | Storage bucket is private: anon and authenticated clients cannot download from `ticket-pdfs` directly. | Run `supabase.storage.from('ticket-pdfs').download('tickets/<knownOrderId>.pdf')` from app context → fails. Only the signed URL from `ticket-pdf-fetch` resolves. |
| SC-18 | Resend retries of `ticket-confirmation-dispatch` do NOT corrupt the stored PDF. | Simulate Resend retry by invoking the function twice for the same order → storage object is overwritten with the same bytes (idempotent); single row in `orders` continues to have `ticket_pdf_path` populated. |
| SC-19 | Two new strict-grep CI gates pass on the implementor's branch. | `gh pr checks <PR#>` shows both `i-ticket-pdf-owner-check` and `i-ticket-pdf-single-renderer` jobs green. |
| SC-20 | No new mobile dependencies beyond `react-native-pdf`, `react-native-blob-util`, `expo-file-system`, `expo-sharing`. No new backend dependencies. | `git diff app-mobile/package.json` shows exactly 4 added lines under `dependencies`; `git diff supabase/functions/` shows no `import_map.json` additions. |

---

## 5. Venue Data Sourcing (operator-required deep-dive)

**Question:** what columns on `events` hold venue name / address / lat-lng? Do they exist?

**Answer (proven, from migration grep):**

| Field | Column | Type | Migration | Confirmed |
|---|---|---|---|---|
| Free-text address | `events.location_text` | `text` (nullable) | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7799` | YES |
| Lat / lng | `events.location_geo` | `point` (PostGIS, nullable) | `:7800` | YES |
| Is online? | `events.is_online` | `boolean NOT NULL DEFAULT false` | `:7802` | YES |
| Online URL | `events.online_url` | `text` (nullable) | `:7801` | YES |

**No new column required.** The spec's §3.4 SELECT extension is the only mobile-side change needed to surface this data. No migration is needed for venue (the §3.1 migration only adds `orders.ticket_pdf_path` and the storage bucket).

**Fallback hierarchy (from operator dispatch):**

1. `is_online === true` → render "Online event" + (if `online_url`) "Open link" button.
2. `location_text` non-empty → render address + (if `location_geo` present) "Open in Maps" deep-link button.
3. All venue fields empty → render italic grey "Venue details in your email" — explicit acknowledgement that we don't have it on-server.

**Why not pull from `brands` location?** The investigation noted "brand location" as a possible deeper fallback. Rejecting: a brand can host events at multiple venues, so brand location is misleading. Better to be honest with "Venue details in your email" than to mislead the buyer to the wrong address.

**`location_geo` parsing:** `point` columns are returned by PostgREST as either string `"(x,y)"` or object `{x, y}` depending on PostgREST version. The spec mandates a defensive parser (§3.4); implementor verifies actual return shape on first integration run and adjusts the parser to match.

---

## 6. Invariants

### 6.1 Preserved (existing — must not break)

| ID | Invariant | How preserved |
|---|---|---|
| I-PROPOSED-AG | TICKET_PDF_PRIVACY (no qr_token_hash, no payment ids, no phone) | Lazy backfill calls `_shared/ticketPdf.ts` unchanged — same redaction rules apply. CI: existing strict-grep on the PDF generator stays green. |
| I-RN-SUB-SHEET-INSIDE-PARENT | Any sub-sheet must render inside parent Modal children | `TicketPdfSheet` is the parent Modal. Its Save action calls `Sharing.shareAsync` (native OS sheet, not a JS sibling Modal — no children-vs-sibling concern). Any future addition of a JS confirmation toast MUST render inside the `<Modal>` children. |
| I-PROPOSED-J | Zustand persist holds IDs, not server records | The `signedUrl` and `localUri` for the PDF are LOCAL state inside the sheet component (`useState`), not Zustand. Persisted state holds no PDF data. |
| Edge function error handling pattern | Use `app-mobile/src/utils/edgeFunctionError.ts` | `TicketService.fetchTicketPdfUrl` uses the shared utility per §3.4. |
| Active/Archive partition existing behaviour | Saved-card scheduled entries continue to render and animate identically | The discriminated-union merge in §3.6.1 keeps the calendar-entry render path untouched. Stagger animation uses unified index. |

### 6.2 New (established by this ORCH)

| ID | Invariant | CI Gate |
|---|---|---|
| I-PROPOSED-AK | TICKET_PDF_FETCHABLE_BY_OWNER — only `auth.uid() === orders.buyer_user_id` may fetch a signed URL for that order's PDF. | New script `.github/scripts/strict-grep/i-ticket-pdf-owner-check.mjs` — verifies `ticket-pdf-fetch/index.ts` contains both an `auth.uid()` extraction and a `buyer_user_id` comparison. |
| I-PROPOSED-AL | TICKET_PDF_SINGLE_SOURCE_OF_TRUTH — `pdf-lib` may be imported ONLY from `supabase/functions/_shared/ticketPdf.ts`. All edge functions render via that module. | New script `.github/scripts/strict-grep/i-ticket-pdf-single-renderer.mjs` — greps `supabase/functions/**/*.ts` for pdf-lib imports outside `_shared/ticketPdf.ts`. |
| I-PROPOSED-AM | TICKET_PDF_STORAGE_BUCKET_PRIVATE — the `ticket-pdfs` bucket has `public = false` and zero client-role policies on `storage.objects` for it. | Manual / migration-review gate. The §3.1 migration explicitly sets `public = false` and adds no client policies. A follow-up CI gate could grep migrations for any future `CREATE POLICY ... ON storage.objects ... FOR ... TO authenticated ... WHERE bucket_id = 'ticket-pdfs'` and fail. Optional in this ORCH; flag as follow-up. |

Orchestrator adds I-PROPOSED-AK and I-PROPOSED-AL to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE. I-PROPOSED-AM is flagged but optional for this CLOSE.

---

## 7. Test Cases (tester-facing)

Tester reads §4 success criteria as gates. Below are concrete test scenarios mapping to each gate.

| Test | Scenario | Input | Expected | Gate |
|---|---|---|---|---|
| T-01 | Tickets block removed | Open Likes → Calendar with paid orders | No standalone "Tickets" header above Active | SC-01 |
| T-02 | Sort merge future | User has saved card scheduled Friday + paid ticket Wednesday | Active shows ticket Wed first, card Fri second | SC-02 |
| T-03 | Sort merge past | Paid order with masterDate yesterday | Appears in Archive accordion | SC-03 |
| T-04 | Header count | Active = 3 cards + 2 tickets visible | Header reads "(5)" | SC-04 |
| T-05 | Filter tier | Apply tier=bougie | Tickets remain; cards filter normally | SC-05 |
| T-06 | Filter when | Apply when=today | Only entries whose date is today remain | SC-05 |
| T-07 | Search | Search "rooftop" | Tickets matching title/brand "rooftop" remain | SC-05 |
| T-08 | Pending guard | Pending order in list | "Finalizing…" pill; tap does nothing | SC-06 |
| T-09 | Open sheet | Tap paid ticket View CTA | Bottom sheet slides up | SC-07 |
| T-10-iOS | PDF renders iOS | Open sheet for 1-ticket paid order | PDF page visible after spinner; pinch-zoom works | SC-08-iOS |
| T-10-Android | PDF renders Android | Same on Android emu | PDF page visible; pinch-zoom works | SC-08-Android |
| T-11 | Multi-page PDF | Open sheet for 3-ticket order | 3 pages, swipe between | SC-08 |
| T-12-iOS | Save iOS | Tap Save in sheet | iOS share sheet with "Save to Files" present | SC-09-iOS |
| T-12-Android | Save Android | Tap Save on Android | Android share intent; save to Downloads succeeds | SC-09-Android |
| T-13 | Venue address | Event with `location_text="14 Foo St, London"` + `location_geo` | Address visible + "Open in Maps" → native Maps opens | SC-10 |
| T-14 | Online event | Event with `is_online=true` + `online_url` | "Online event" + "Open link" → opens URL | SC-10 |
| T-15 | No venue data | Event with `location_text=null, is_online=false` | "Venue details in your email" italic grey | SC-10 |
| T-16 | QR strip | 3-ticket order sheet | 3 QR cards scrollable; each scans via scanner | SC-11 |
| T-17 | New order persisted | Buy ticket today | Email arrives + `SELECT ticket_pdf_path` is non-null | SC-12 |
| T-18 | Lazy backfill | Pick paid order with `ticket_pdf_path = null` | First open ~2-5s; subsequent < 500ms; column now non-null | SC-13 |
| T-19 | Byte equivalence | Save in-sheet PDF, compare SHA256 to email attachment | Hashes identical | SC-14 |
| T-20 | Ownership 403 | User A's JWT + user B's orderId | HTTP 403 | SC-15 |
| T-21 | Refunded 410 | Refund paid order, open sheet | Sheet shows clear error, not stuck spinner | SC-16 |
| T-22 | Bucket private — anon | `supabase.storage.from('ticket-pdfs').download(...)` from anon client | Fails | SC-17 |
| T-23 | Bucket private — auth | Same from authenticated non-owner client | Fails | SC-17 |
| T-24 | Resend retry idempotent | Invoke dispatch twice for same paid order | Storage has 1 object with correct bytes; `orders` row stable | SC-18 |
| T-25 | CI gates green | Open PR | Both new strict-grep jobs pass | SC-19 |
| T-26 | Dep count | `git diff package.json` | Exactly 4 new dependencies | SC-20 |
| T-27 | Regression — saved card render | Active accordion with calendar entry only | Renders + animates exactly as before ORCH-0842 | (regression) |
| T-28 | Regression — empty state | Empty Active accordion | Empty-state copy renders | (regression) |

**Tester MUST exercise iOS Simulator + Android Emulator per parity invariant.** Source-only PASS forbidden per `mingla-forensics` Prime Directive 7.

**Live-fire blockers** (tester surfaces if encountered): native build not yet cut, Resend test account not configured, no paid test order available, signed URL endpoint not yet deployed.

---

## 8. Implementation Order

Recommended sequence (database first, services second, components last):

1. Write + apply migration `<timestamp>_orch_0842_ticket_pdf_storage.sql`. **Operator runs `supabase db push --linked`** per `feedback_orchestrator_deploys_edge_functions.md` ownership split.
2. Modify `supabase/functions/ticket-confirmation-dispatch/index.ts` — add upload step + UPDATE orders.
3. Create `supabase/functions/ticket-pdf-fetch/index.ts` + `config.toml` entry.
4. Add 2 strict-grep scripts under `.github/scripts/strict-grep/` and register 2 jobs in `strict-grep-mingla-business.yml`.
5. Extend `app-mobile/src/services/calendarService.ts` — SELECT + row type + venue parser.
6. Create `app-mobile/src/services/ticketService.ts` (or extend existing) — `fetchTicketPdfUrl`.
7. Install 4 new mobile deps (`pnpm add ...` or yarn equivalent — implementor uses the project's package manager).
8. Create `app-mobile/src/components/activity/TicketPdfSheet.tsx`.
9. Modify `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx` — route tap to new sheet; delete old QR modal block.
10. Modify `app-mobile/src/components/activity/CalendarTab.tsx` — delete standalone Tickets block; add unified Active/Archive sort-merge.
11. Run `npm run typecheck` + any existing test suite. Fix any type errors.
12. Write implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0842_TICKETS_INTO_ACTIVE_AND_PDF_SHEET.md` with old→new receipts.
13. Hand back to orchestrator for edge function deploys + tester dispatch.

**Orchestrator owns** (per `feedback_orchestrator_deploys_edge_functions.md`):
- After step 12: deploy `ticket-confirmation-dispatch` + `ticket-pdf-fetch`.
- Verify versions bumped via `mcp__supabase__list_edge_functions`.
- Then dispatch tester.

**Native build cycle:**
- Tester request: `eas build --profile development --platform ios` + `--platform android`.
- iOS dev-build verification: `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`.
- For CLOSE: production builds for both stores. Implementor does NOT cut prod builds — operator does, per ownership.

---

## 9. Regression Prevention

| Risk class | Prevention |
|---|---|
| Forgetting to upload on dispatch | Test T-17 catches it. Strict-grep gate I-PROPOSED-AL keeps a single renderer, ensuring the upload site is unambiguous. |
| Future PDF-rendering edge function created with parallel `pdf-lib` import | CI gate I-PROPOSED-AL fails the build. |
| Ownership check forgotten on future ticket-pdf-* endpoints | CI gate I-PROPOSED-AK fails the build (extend the script to match any `ticket-pdf-*` function name pattern in a follow-up if more such functions are added). |
| Implementor accidentally swaps `Modal` for a sibling Fragment Sheet | Visual review during code review. The PDF sheet is the parent Modal so this risk is low for this ORCH; broader risk addressed by I-RN-SUB-SHEET-INSIDE-PARENT memory. |
| Pre-cutover order's lazy backfill silently fails forever | Tester T-18 exercises lazy backfill. If failure: 500 response surfaces in the sheet's error state with retry CTA. Implementor adds structured log `[ticket-pdf-fetch] lazy_backfill_failed order=<id>` so Supabase logs can be filtered for monitoring. |
| Storage bucket accidentally flipped to public in a future migration | Recommended follow-up: a third strict-grep gate that asserts the migration text never contains `bucket_id = 'ticket-pdfs'` with `public = true` or any public-read storage policy. Flagged but optional in this ORCH. |
| Venue parser breaks on unexpected PostgREST format | Defensive parser returns `{ lat: null, lng: null }` on any non-matching shape; sheet falls back to "Venue details in your email" gracefully. |

---

## 10. Operator-decided open questions (recap from dispatch)

All 7 are answered in the dispatch and codified above:

1. Archive parity — **YES**, past-date paid orders go to Archive (§3.6.1).
2. Filter parity — **tickets pass category + tier unconditionally**; when applies via `masterDateUtc`; search matches title + brand (§3.6.1 filter table).
3. Path A vs B — **Path A** storage-write on dispatch (§3.2).
4. Backfill — **lazy on first fetch** (§3.3).
5. Download UX — **standard share sheet** via `Sharing.shareAsync` (§3.6.3 #7).
6. `react-native-pdf` native build accepted — **YES** (§1.1 #10).
7. QR grid in sheet — **YES**, always-visible compact strip (§3.6.3 #5).

Plus operator add-on: **venue info in the expanded sheet** — answered in §3.6.3 #4 + §5.

---

## 11. Discoveries for orchestrator (side issues, not in scope)

- **D-1** — Anonymous-buyer in-app PDF viewing is not in scope. Anon buyers (no Supabase user) cannot authenticate against `ticket-pdf-fetch`. Today they continue to receive the email PDF. If we ever want anon buyers to view PDFs in some web flow, that's a separate ORCH (requires account-claim / order-link mechanic).
- **D-2** — `ticket-pdf-fetch` 500 logging suggested as `[ticket-pdf-fetch] lazy_backfill_failed order=<id>` — could grow into a Supabase log alarm with low-effort follow-up.
- **D-3** — Backfill could be batched as a one-time admin job if monitoring shows lazy backfill latency hurts UX. Lazy is good enough at typical order volume (1-4 tickets, <1s render) — revisit only if telemetry says otherwise.
- **D-4** — A `react-native-pdf` page-counter UI ("page 2 of 3") could be a polish ORCH. Not in scope here.
- **D-5** — The `ticket_types` table may hold a human-readable name that would enrich the QR strip caption ("VIP", "Early Bird"). Investigation didn't trace this join; if implementor finds it cheaply, add it; otherwise omit. Not a SC.
- **D-6** — Investigation D-1 (no haptic on View CTA) and D-2 (no retry-with-backoff on `useBusinessEventOrders`) remain deferred to a future polish ORCH.
- **D-7** — Optional third CI gate for I-PROPOSED-AM (storage bucket privacy) could be added in a future ORCH.

---

## 12. Confidence

| Section | Confidence | Basis |
|---|---|---|
| §3.1 migration | proven | schema confirmed via baseline migration grep; bucket pattern matches existing `event-cover-uploads`-style usage |
| §3.2 dispatch modification | proven | source lines `:361-394` and `:448-460` confirmed in investigation; upload pattern is standard supabase-js |
| §3.3 ticket-pdf-fetch | probable | function does not yet exist; behaviour spec is complete but lazy-backfill data assembly (reconstructing `TicketPdfInput`) needs implementor to read `_shared/ticketPdf.ts` input shape and assemble from order+event+tickets joins |
| §3.4 mobile service | proven | calendarService SELECT shape confirmed at `:286`; venue parser defensive enough |
| §3.6 components | probable | sheet pattern mirrors `BusinessEventCalendarRow:128-181`; venue/QR/PDF layout is fresh UX, implementor + reviewer should sanity-check on first build |
| §5 venue sourcing | proven | columns confirmed at baseline migration `:7799-7802` |
| §4 success criteria | proven | each maps to an observable / queryable / measurable check |
| §6 invariants | proven | gates are concrete grep scripts; pattern matches existing strict-grep registry |

No simulator live-fire was performed for this SPEC turn — SPEC is architectural, not a sim-repro situation. The TEST phase after implementation MUST include iOS sim + Android emulator parity per `mingla-forensics` Prime Directive 7.
