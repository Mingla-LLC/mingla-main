# IMPLEMENT — META-ORCH-1161 Sub-B [marketing SMS send]

**Status:** implemented and self-verified (text-dark — ships with SMS off).
**Branch:** `ORCH-1161-marketing-sms`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1161-[marketing-sms]/`
**Commits:** `3aa7bcab8` (backend + composer + tests), `e3c39b284` (client audience mirror).
**Scope:** the marketing SMS SEND path only (per dispatch). The notification-preferences matrix UI (slice a), the bundled-consent UX changes (DEC-186 OTP box + checkout T&C sheet), and the Sub-C transactional moments are explicitly OUT and noted as backlog.

---

## 1. Summary (plain English)

A brand can now compose an SMS blast: the SMS tab is enabled, the composer shows the truthful SMS reach plus a per-recipient segment count and a campaign cost estimate before send. On send, `marketing-send` dispatches via the Sub-A `smsAdapter` to non-suppressed phones, honoring marketing quiet hours, branded `/m/` tracking links, and throughput throttling — but ONLY when the per-market kill-switch is flipped on. The switch defaults OFF, so this ships **text-dark**: composing/scheduling is live UI, but zero Twilio HTTP fires until an operator sets `SMS_LIVE_ENABLED_US=true`.

The phone-suppression gap is fixed: `reach.reachable_sms` was computed off an email-keyed unsubscribe set only, so a phone STOP / `channel_suppressions` row was silently ignored. Now both the server resolver and the client preview exclude phone-suppressed numbers.

---

## 2. SPEC §6 / dispatch success-criteria coverage

| SC | Item | Status | Where |
|---|---|---|---|
| SC-1 | `marketing-send` real SMS via smsAdapter, marketing SID + fallback, writes `marketing_messages(recipient_phone, channel='sms', status, provider_message_id, segments)`, keeps `MARKETING_SEND_LIVE_ENABLED`, adds per-market kill-switch, leaves `rcs` throw | ✓ `3aa7bcab8` | `supabase/functions/marketing-send/index.ts` (`sendSms`) |
| SC-2 | `marketingAudience.ts` phone-suppression — `reachable_sms` checks `marketing_unsubscribes(contact_phone)` AND `channel_suppressions(channel='sms', scope∈{marketing,all})` | ✓ `3aa7bcab8` | `supabase/functions/_shared/marketingAudience.ts` (`resolveSuppressedPhones`) |
| SC-3 | `ChannelTabs.tsx` SMS `enabled: true`, RCS still disabled | ✓ `3aa7bcab8` | `ChannelTabs.tsx` L42 |
| SC-4 | Composer shows `reachable_sms` + segment/cost estimate (GSM-7 160 vs UCS-2 70) before send; passes reach to CTA | ✓ `3aa7bcab8` | `compose.tsx`, `SmsComposeCard.tsx`, `utils/smsCost.ts` |
| SC-5 | Quiet hours (marketing) — block outside 8a–9p US / 8a–8p WAT NG; TZ from country/area code; unknown → conservative-deny | ✓ `3aa7bcab8` | `marketing-send/index.ts` `isWithinQuietHours` + `countryFromE164` |
| SC-6 | Branded short links via existing `/m/{tracking_id}` redirect (never a public shortener) | ✓ `3aa7bcab8` | `marketing-send/index.ts` `rewriteSmsLinks`; `marketing-track-click` honest `utm_medium` |
| SC-7 | Throughput throttling — batch + pace (mirror email BATCH_LIMIT) | ✓ `3aa7bcab8` | `SMS_BATCH_SIZE=10` + `SMS_BATCH_PAUSE_MS=1100` |
| SC-8 | Deliverability — Twilio status → per-campaign undelivered counting; auto-suppress hard failures | ✓ `3aa7bcab8` | `twilio-message-status/index.ts` marketing reconcile + auto-suppress |
| SC-9 | Client audience mirror stays in sync (honest composer preview) | ✓ `e3c39b284` | `marketingAudienceService.ts` |

---

## 3. The marketing-sender env

- **`TWILIO_MARKETING_MESSAGING_SERVICE_SID`** (NEW, optional) — separate marketing Messaging Service SID for reputation isolation (DEC §12 Q2). When unset, `marketing-send` falls back to the existing approved transactional toll-free `TWILIO_MESSAGING_SERVICE_SID`. Passed through the new `SmsSendInput.messagingServiceSid` override on the adapter.
- **`SMS_LIVE_ENABLED_US` / `SMS_LIVE_ENABLED_NG`** (Sub-A) — per-market kill-switch, default false. Enforced INSIDE `smsAdapter.send()`: when off it returns `status:'skipped'` with ZERO Twilio HTTP. Marketing-send records skipped sends as `preview_skipped`.
- **`MARKETING_SEND_LIVE_ENABLED`** (existing) — global broadcast gate, unchanged; still gates both email and SMS.
- **`MINGLA_TRACKING_LINK_ORIGIN`** (optional) — overrides the `/m/` redirect origin (defaults to the `marketing-track-click` function URL).

Both gates must be true (and the §8 market gate green) for any real SMS to leave.

---

## 4. The suppression fix

`aggregate()` (server) and `aggregateBuyers()` (client) previously computed `sms_marketing_ok = raw_phone !== null && !suppressed.has("sms")`, where `suppressed` was an **email-keyed** set — a phone STOP could never flip it. Now:

- **Server** (`marketingAudience.ts`): `resolveSuppressedPhones()` queries `marketing_unsubscribes(contact_phone, channel∈{sms,all})` AND `channel_suppressions(channel='sms', scope∈{marketing,all})`, builds a Set of trimmed + digits-only phone keys, and `sms_marketing_ok` additionally requires `!phoneSuppressed`. The send path filters on `sms_marketing_ok`, so a suppressed phone is never dispatched.
- **Client** (`marketingAudienceService.ts`): same phone-keyed exclusion from `marketing_unsubscribes(contact_phone)`. `channel_suppressions` is RLS own-only (a brand can't read other buyers' rows), so the client preview is a **conservative estimate**; the server send (service-role) is the authoritative gate and additionally honors `channel_suppressions`. The preview already excludes web-unsubscribe + STOP phones.

Marketing scope stays SEPARATE from transactional: SMS marketing suppression only ever queries marketing/all scope, never touching transactional confirmations (R-3 / I-PROPOSED-1161-TRANSACTIONAL-VS-MARKETING-CONSENT-SEPARATED).

---

## 5. The kill-switch behavior (text-dark)

`SMS_LIVE_ENABLED_US`/`_NG` default false. With it off, `smsAdapter.send()` returns `{ok:false, status:'skipped', error:'kill_switch_off:SMS_LIVE_ENABLED_US'}` BEFORE any `fetch` to Twilio. Even with `MARKETING_SEND_LIVE_ENABLED=true`, an SMS blast records `preview_skipped` rows and sends nothing. Proven by `smsAdapter.killswitch.test.ts` (fetch stub asserts ZERO calls when off, exactly 1 when on).

---

## 6. The cost-estimate UI

`SmsComposeCard` (shown when the SMS tab is active) renders a plain-text body input plus a live estimate box: encoding (GSM-7/UCS-2), per-recipient chars + segments, total segments across `reachable_sms`, and an est. cost via `formatCurrency(..., brand.defaultCurrency, true)`. The estimate is currency/locale-aware and labeled "Estimate only — final cost is metered by the carrier" (no fabricated precision). `utils/smsCost.ts` mirrors the adapter's GSM-7 alphabet + 160/153 vs 70/67 segmentation byte-for-byte. The adapter appends the STOP footer server-side; the estimate accounts for it.

---

## 7. Tests + fails-on-revert

| Test | Type | Proven |
|---|---|---|
| `supabase/functions/_shared/adapters/smsAdapter.killswitch.test.ts` | Deno | fails-on-revert verified at base `e4bb8e7ba` (deleted kill-switch guard → "ZERO Twilio HTTP" assertion FAILS) |
| `supabase/functions/_shared/marketingAudience.sms-suppression.test.ts` | Deno | fails-on-revert verified (deleted `!phoneSuppressed` clause → reachable_sms counts suppressed phone → FAILS) |
| `mingla-business/src/services/marketing/__tests__/marketingAudienceService.smsSuppression.orch1161.test.ts` | jest | fails-on-revert verified (deleted client `phoneKeysOf` clause → FAILS) |
| `mingla-business/src/utils/__tests__/smsCost.test.ts` | jest | happy-path (GSM-7/UCS-2 segmentation, cost, zero-reach) |
| `supabase/functions/marketing-send/index.test.ts` | Deno | T-B07 updated (`[TEST-MOD-APPROVED ORCH-1161]`) + NEW SMS-dispatch structural test |

**Commands:**
```bash
export PATH="/Users/sethogieva/.deno/bin:$PATH"
deno test --allow-read --allow-env --allow-net \
  supabase/functions/_shared/adapters/smsAdapter.killswitch.test.ts \
  supabase/functions/_shared/marketingAudience.sms-suppression.test.ts \
  supabase/functions/marketing-send/index.test.ts            # 18 passed
cd mingla-business && npx jest src/utils/__tests__/smsCost.test.ts \
  src/services/marketing/__tests__/marketingAudienceService.smsSuppression.orch1161.test.ts
node .github/scripts/test-append-only-check.js                # 5 passed
node .github/scripts/strict-grep/i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs  # PASS
node .github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs                              # clean
```

Step 0.5 mandates both satisfied: (a) phone-keyed suppression excludes a suppressed phone from reachable_sms AND the send filters on `sms_marketing_ok`; (b) kill-switch off → smsAdapter skipped with zero Twilio HTTP. Both fails-on-revert by true line deletion.

Gates run: deno check (all touched functions ✓), business `tsc --noEmit` (zero errors in touched files — pre-existing repo errors unrelated), full marketing jest suite (92 + 25 + new ✓), append-only ✓, I-PROPOSED-1161 SMS sender/kill-switch gate ✓, ORCH-0815-B composer gate ✓, ORCH-0863 ✓.

---

## 8. Data-model change

`supabase/migrations/20261111000000_orch_1161_marketing_sms_segments.sql` — `ALTER TABLE marketing_messages ADD COLUMN IF NOT EXISTS segments integer` (NULL for email; cost observability). Idempotent, additive, no backfill, no guards (no read-only probe needed). Prefix monotonic above the rebased head (max = Sub-A `20261110000005`).

---

## 9. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Business iOS | YES | SMS tab + composer + cost preview (shared RN). OTA. |
| Business Android | YES | Auto (shared RN). |
| Buyer/anon Web | NO | composer is native-first (not a 1161 web deliverable). |
| Consumer iOS/Android | NO | push/in-app marketing leg (item 1b) is OUT of this slice. |
| Admin Web | NO | no compose surface. |
| Backend | YES | marketing-send SMS leg, audience resolver, twilio-message-status, track-click, migration. |

Parity: business iOS↔Android is automatic (shared RN). Client↔server audience resolvers are manually mirrored — both fixed in this slice; the file headers already mandate sync.

---

## 10. Operator action required

1. **Migration** (apply via Supabase Management API after REVIEW, per the 1161 hazard note — CLI drift-wedged; MCP read-only):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1161-[marketing-sms]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (single additive column; safe.)
2. **Edge deploy from MERGED main** (NOT the worktree): `marketing-send`, `marketingAudience` (shared, redeploys with marketing-send), `twilio-message-status`, `marketing-track-click`. Preserve each function's existing `verify_jwt`: `marketing-send` = current (service-role + user-JWT dual path, unchanged), `twilio-message-status` = false (Twilio callback, secret-gated, unchanged), `marketing-track-click` = false (public redirect, unchanged).
3. **Secrets** (only needed to go live; leave unset to stay text-dark): `TWILIO_MARKETING_MESSAGING_SERVICE_SID` (optional), `SMS_LIVE_ENABLED_US` / `SMS_LIVE_ENABLED_NG` (default false).
4. **OTA the composer** (business dev channel) per the EAS gotcha (`npx -y eas-cli@latest update`, per-platform) — this is the `[deploy]`-class UI change.
5. **Do NOT flip `SMS_LIVE_ENABLED_*` for MARKETING** until the §8 Go/No-Go gate is green for that market — including item #8, the explicit legal sign-off accepting the bundled-consent TCPA risk (DEC-186 / R-8). Sender registration + inbound-STOP webhook are NOT this slice's job.

---

## 11. Known issues / deferred (backlog)

- **Composer was email-only.** The composer rendered no `ChannelTabs` and hard-coded `kind:"email"`. This slice mounts the channel selector + a minimal SMS body card + cost preview — NOT a full SMS authoring experience (no SMS templates, no link-shortener UI, no preview pane). Adequate for the send path; richer SMS authoring is future polish.
- **Recipient country derived from E.164 prefix.** `orders` has no buyer-country column, so quiet-hours TZ + market routing derive from `+1`→US / `+234`→NG; unknown prefixes conservatively defer (no send). A future Sub-C consent capture (DEC-186 checkout country field) can replace this with stored country.
- **Client reach preview is a conservative estimate** vs the server (can't read `channel_suppressions` under RLS). The server send is the authoritative gate. Acceptable — it never under-counts in a way that texts a suppressed number.
- **OUT of this slice (backlog):** notification-preferences matrix UI (slice a); DEC-186 bundled-consent UX (OTP box + checkout T&C sheet, `consent_records` writes); push + in-app marketing leg (SPEC §6 item 1b); the Sub-C transactional moments (reminders cron, purchase-confirm push, refund/reservation wiring).

## 12. Discoveries for orchestrator

- Both audience resolvers (Deno + RN) share the email-keyed-suppression bug shape; this slice fixed SMS. The email side is correct already; no action.
- `channel_suppressions` RLS (`read_own`) means brand-side clients can never preview buyer suppression ledgers — any future "true reach" UI must call a SECURITY DEFINER RPC or an edge function, not a direct client read.
- No COMMS-ledger entry written: the composer-email-only finding is Sub-B-internal; no cross-ORCH blast radius identified.
