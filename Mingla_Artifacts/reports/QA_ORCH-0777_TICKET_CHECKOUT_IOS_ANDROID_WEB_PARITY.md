# QA ORCH-0777 — Ticket Checkout iOS + Android + Web Parity

Date: 2026-05-11
Owner: Claude `mingla-tester` (canonical TEST per 2026-05-10 reversal of META-ORCH-0755 / DEC-133)
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Dispatch: parity pass following `LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` (backend GREEN end-to-end)
Verdict: **CONDITIONAL PASS** — code-side parity proven across all three surfaces; backend transactions already proven end-to-end by the live-fire matrix; remaining gap is operator-hands-on UI interaction (PaymentSheet card entry, camera QR scan, real inbox/SMS receipt). This skill cannot drive simulator/emulator taps from Bash, so the interactive portion is BLOCKED on a 15-minute operator hands-on run on iOS Simulator + Android Emulator. Web paid-checkout is correctly N/A by design (ORCH-0778). Web scanner is correctly N/A by design (organizer scans from mobile-native camera, not browser).

## Hard-Guard Compliance

- No raw Resend API key, Twilio auth token, Stripe restricted key, Stripe secret key, Stripe client secret, PaymentIntent client_secret, full provider message id, full email body, QR payload string, buyer status token, QR pepper value, or pepper digest body printed or artifacted in this report.
- No database migration applied, no edge function deployed during this QA pass — read-only verification only.

## Inputs Read

- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`
- `Mingla_Artifacts/prompts/OPERATOR_ORCH-0777_PROVIDER_CONFIG_AND_LIVE_FIRE_RERUN.md`
- `mingla-business/app/checkout/[eventId]/index.tsx`, `buyer.tsx`, `payment.tsx`, `confirm.tsx`, `_layout.tsx`
- `mingla-business/app/event/[id]/scanner/index.tsx`
- `mingla-business/src/services/ticketCheckoutService.ts`, `scanTicketService.ts`
- `mingla-business/src/payments/stripePaymentSheet.web.ts`, `stripePaymentSheet.native.ts`, `stripePaymentSheet.ts`
- `supabase/functions/ticket-checkout-create/index.ts`, `_shared/ticketCheckout.ts`
- `supabase/functions/scan-ticket/index.ts`
- `supabase/config.toml`

## Static Verification (PASS)

### Bundle parity across iOS / Android / Web

| Surface | Build | Buyer routes shipped | Scanner route shipped | Notes |
| --- | --- | --- | --- | --- |
| Web | `npx expo export --platform web` → 38 routes, no error | `/checkout/[eventId]`, `/checkout/[eventId]/buyer`, `/checkout/[eventId]/payment`, `/checkout/[eventId]/confirm`, `/e/[brandSlug]/[eventSlug]`, `/o/[orderId]` | `/event/[id]/scanner` (39.1 kB) | ORCH-0778 native Stripe import gate holds — web bundle ships without crashing on `@stripe/stripe-react-native`. HTTP GET of `/event/%5Bid%5D/scanner.html` returns 200 with full Expo SSR shell. |
| iOS | `npx expo export --platform ios` → 8.84 MB Hermes bytecode (`entry-3db3a1cc...hbc`), no error | Same buyer routes inside Hermes bundle | Same scanner route inside Hermes bundle | Bundle compiles cleanly against iOS 26.4 simulator runtime. |
| Android | `npx expo export --platform android` → 8.85 MB Hermes bytecode (`entry-2b86e1d3...hbc`), no error | Same buyer routes inside Hermes bundle | Same scanner route inside Hermes bundle | Bundle compiles cleanly against the booted emulator-5554 runtime. |

All three exports completed in a single pass — no per-platform compile-time regression in any of the ORCH-0777 ticket-checkout / scanner code paths.

### Unit tests

| Suite | Result |
| --- | --- |
| `mingla-business/src/services/__tests__/ticketCheckoutService.test.ts` | PASS |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | PASS |
| `mingla-business/src/constants/__tests__/publicUrls.test.ts` | PASS |
| `supabase/functions/_shared/__tests__/ticketCheckout.test.ts` (Deno) | PASS (5 tests — `qrTokenPepper` reject/accept paths, notification-provider classification, Stripe PaymentIntent create failure classification, paid-checkout persist-failure cancel scope) |

13 Jest + 5 Deno = 18 ticket-checkout assertions GREEN on this working tree.

### Edge function ACTIVE versions (production)

| Function | Matrix says | Production says | verify_jwt | Match |
| --- | --- | --- | --- | --- |
| `ticket-checkout-create` | v12 | v12 | true (anon JWT from buyer's supabase-js client) | ✅ exact |
| `ticket-confirmation-dispatch` | v10 | v11 | true | ✅ at-or-above |
| `ticket-checkout-status` | v8 | v11 | false (per `config.toml` `[functions.ticket-checkout-status]`) | ✅ at-or-above |
| `stripe-webhook` | v15 | v16 | false (per `config.toml`) | ✅ at-or-above |
| `twilio-message-status` | v9 | v11 | false (per `config.toml`) | ✅ at-or-above |
| `scan-ticket` | v8 | v11 | true (scanner-user JWT required, line 13-17 of `index.ts`) | ✅ at-or-above |

All three `verify_jwt = false` overrides for the third-party / anon-buyer surfaces are committed in `supabase/config.toml` and the deployed functions reflect that. No regression in the gateway contract.

### Migration state (production)

`supabase_migrations.schema_migrations` confirms all four ORCH-0777 migrations present:

| Version | Name | Status |
| --- | --- | --- |
| `20260515000013` | `orch_0777_ticket_checkout_core` | applied |
| `20260515000015` | `orch_0777_b2_ticket_qr_credential_rls` | applied |
| `20260515000016` | `orch_0777_qr_pepper_service_role_rpc` | applied |
| `20260515000017` | `orch_0777_scan_wrong_event_result` | applied |

### Migration 17 wrong-event branch — LIVE-VERIFIED in `pg_proc`

The deployed `public.biz_ticket_scan(p_event_id uuid, p_qr_payload text, p_scanner_user_id uuid, p_qr_token_pepper text)` body in production contains the exact branch:

```sql
v_scan_event_id := CASE
  WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id
  ELSE p_event_id
END;
```

This upgrades the matrix row "wrong_event — CODE FIX VERIFIED, LIVE-FIRE PENDING" to **CODE-LIVE-VERIFIED in production SQL**. The matrix's outstanding empirical re-probe (requires a scanner-user JWT + a paid ticket for one event submitted against a different event) is still hands-on but the deployed SQL is the migration 17 source verbatim.

### B2 QR credential RLS — LIVE-VERIFIED in `pg_proc`

`public.biz_ticket_checkout_assert_qr_pepper(text)` body rejects: NULL, empty, `< 32 chars`, and the literal `'local-ticket-pepper'` fallback — verified by reading `prosrc`. Migration 16 contract is intact in production.

### Scanner authorization gate — LIVE-VERIFIED in `pg_proc`

`public.biz_ticket_scan` first checks `event_scanners` for the operator user_id under the event_id with `removed_at IS NULL` AND `(permissions ->> 'scan')::boolean` true (default true). Anonymous JWTs cannot satisfy this — the function raises `scanner_not_authorized`. This means the dispatch's "authenticated scanner-user JWT for the leggothis brand team" is a strict gate at the SQL layer, not just at the function wrapper.

## Surface-by-Surface Parity Reading

### Web (mingla-business export)

| Scenario | UI behavior | Verdict |
| --- | --- | --- |
| Buyer arrives at `/checkout/{eventId}` for free event `b1ab659e-...` | `app/checkout/[eventId]/index.tsx` lists visible tickets, "Reserve free ticket" CTA | PASS (route shipped, bundle compiles) |
| Buyer continues to `/buyer` and submits anon details | Reserves at `ticket-checkout-create` v12, gets `kind=free_completed`, recorded into cart | PASS (service hits the same endpoint backend already proved with order `869bee74-...`) |
| Buyer arrives at `/checkout/{eventId}/payment` for paid event `a3f71d85-...` | `app/checkout/[eventId]/payment.tsx` line 140-145 + `stripePaymentSheet.web.ts` returns `isPaymentSheetSupported: false`. UI displays "Ticket payments are not available on web yet. Please complete checkout in the Mingla Business mobile app." | PASS by-design — this is the intentional ORCH-0778 contract |
| Buyer scanner from web | `/event/[id]/scanner` route ships but uses `expo-camera CameraView` (mobile-native). Web requires WebRTC + HTTPS + user gesture; not a real organizer scanner surface | N/A by-design — organizers scan from native iOS/Android |

### iOS Simulator (iPhone 17 Pro booted)

| Scenario | Static evidence | Hands-on evidence |
| --- | --- | --- |
| Free checkout | iOS Hermes bundle ships `/checkout/[eventId]` + service code identical to web/Android | NOT EXERCISED — requires Simulator tap-through |
| Paid checkout | `stripePaymentSheet.native.ts` returns `isPaymentSheetSupported: true` with real `@stripe/stripe-react-native` `useStripe()` adapter | NOT EXERCISED — requires Stripe test card 4242 4242 4242 4242 entered into PaymentSheet UI |
| Scanner first/duplicate/wrong-event | Scanner route ships; `scanTicketService.scanTicket` invokes `scan-ticket` v11 (verify_jwt true) and requires scanner-user JWT for leggothis brand event | NOT EXERCISED — requires camera + a QR image to scan |

### Android Emulator (emulator-5554)

| Scenario | Static evidence | Hands-on evidence |
| --- | --- | --- |
| Free checkout | Android Hermes bundle identical | NOT EXERCISED — requires Emulator tap-through |
| Paid checkout | Same native PaymentSheet adapter | NOT EXERCISED |
| Scanner first/duplicate/wrong-event | Same scanner route | NOT EXERCISED |

## Live-Fire Backend Evidence (inherited from the matrix)

The live-fire matrix already proved the **complete backend contract** end-to-end against production Supabase `gqnoajqerqhnvulmnyvv`:

- Free order `869bee74-0025-4dde-9d68-1e22187017bb` (event `b1ab659e-...`) — `payment_status=paid`, 1 valid ticket, `confirmed_at == created_at`.
- Paid order `6ad119af-dee2-4a4d-b21e-eae2d91011f3` (event `a3f71d85-...`) — `payment_status=paid`, `payment_method=online_card`, 1 valid ticket, webhook processed in ~3s, `notification_status=sent`.
- Resend email row for `6ad119af-...` — `status=sent`, `provider=resend`, `provider_message_id` present.
- Twilio SMS row — `status=sent`, `provider=twilio`, `provider_message_id` present; 3 callbacks captured (`sent` → `queued` → `undelivered` ErrorCode 30032 toll-free verification in flight).
- Webhook `evt_3TVkS5...` processed=true with `payment_webhook_events` row in place for idempotent replay short-circuit.
- Scanner first scan + duplicate — empirical PASS on a prior ticket; wrong-event branch now SQL-verified in `biz_ticket_scan`.

The UI surfaces wrap exactly that backend contract via the shared `createTicketCheckout` / `pollTicketCheckoutStatus` / `scanTicket` service code, which has matching unit tests passing on this tree.

## What's NOT Verified (BLOCKED on operator hands-on)

This skill operates in Bash and cannot drive simulator/emulator taps. The following five steps are operator-hands-on:

1. **iOS Simulator buyer free checkout** for event `b1ab659e-...` — load Expo dev build, walk `/checkout/{eventId}` → `/buyer` → `/confirm`, confirm QR carousel renders and shows server-issued ticket.
2. **iOS Simulator buyer paid checkout** for event `a3f71d85-...` — same flow plus PaymentSheet, enter `4242 4242 4242 4242` / any future expiry / any 3-digit CVC / any 5-digit ZIP, confirm finalization in < 15s and the confirmation screen shows paid ticket.
3. **Android Emulator buyer free + paid checkout** — same two flows on `emulator-5554`.
4. **iOS or Android scanner first / duplicate / wrong-event** — sign in as a leggothis brand-team scanner user, navigate to `/event/{eventId}/scanner` for `a3f71d85-...`, scan the paid ticket from the test order, expect `success` overlay; rescan same QR, expect `duplicate`; scan against `b1ab659e-...` (the free event), expect `wrong_event`.
5. **Inbox + SMS receipt evidence** — one platform with operator's real email + phone; verify the branded ticket email arrives at the verified `tickets@usemingla.com` sender and the SMS shows ErrorCode 30032 in Twilio (accepted as PASS on system contract per dispatch).

Steps 1-4 each take < 3 minutes; step 5 piggybacks on whichever surface uses real credentials. Total: ~15 minutes of operator time at the device.

## Discoveries for Orchestrator

- **Matrix can be updated to LIVE-VERIFIED on the wrong-event branch** — production `pg_proc.prosrc` for `biz_ticket_scan` matches migration 17 verbatim. The empirical re-probe is still hands-on but the SQL is in place.
- **Web is intentionally a free-checkout-only surface for ORCH-0777**, by ORCH-0778 design. Suggest the matrix row "iOS Simulator + Android Emulator + Web parity" be amended to document: "Web paid checkout = redirect-to-mobile-app message (by design); Web scanner = N/A (organizer scans from native mobile camera)."
- **Deployed function versions are at-or-above the matrix**. No version mismatch surfaced. Confirms operator-side deploys settled correctly.

## No Code Regression Surfaced

Per the dispatch's routing rule ("On any FAIL, route to Codex implementor-mingla only if a code regression is proven"), this QA pass surfaced **no code regression**. The static + SQL + edge-function + bundle-compile evidence is GREEN. The only outstanding gate is hands-on UI interaction, which is not a code defect.

## Verdict and Routing

**CONDITIONAL PASS** with operator-hands-on dependency. Two routes possible:

1. **Recommended (high confidence)**: Operator runs the five hands-on steps above (~15 min) and reports back here. On PASS, this skill emits CLOSE handoff to Codex `orchestrator-mingla`. On any UI-level FAIL (e.g., PaymentSheet does not present, QR carousel does not render, scanner crashes), route to Codex `implementor-mingla` with the failing platform + step cited.

2. **Acceptable (operator-accepted residual risk)**: Operator accepts the strength of the static + backend live-fire + SQL-verified evidence and routes directly to Codex `orchestrator-mingla` for CLOSE ORCH-0777, deferring the hands-on tap-through to post-CLOSE smoke at TestFlight / Play internal track.

Default recommendation is route 1 — 15 minutes of operator hands-on guarantees the launch-grade contract and eliminates any "did the surface really render correctly?" residual risk before CLOSE.
