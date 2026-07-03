# IMPLEMENTATION — ORCH-1289 [marketing MMS composer: multiselect + preview]

Follow-on to the shipped ORCH-1282. Four fixes to the marketing SMS/MMS composer.
Web-first (business.usemingla.com / Chrome); native (iOS/Android) parity kept via
the shared RN code. Branch `1289-mms-multiselect-preview`, commit `f311d4175`.
NOT deployed / NOT merged.

---

## Fix #1 — BLANK IMAGE PREVIEW (root cause)

### Root cause (web-specific)
On web the picker (`browserFilePicker.pickBrowserFiles`) returns a **`blob:` object
URL** (`URL.createObjectURL(file)`) as the asset `.uri`. The old `handlePickMms`:

1. set `mmsLocalUri = <blob url>`,
2. uploaded to `brand_covers` and set `mmsMediaUrls = [publicUrl]`,
3. in its `finally` block called `revokeBrowserPickedFiles(browserFiles)` — which
   **revoked that blob URL immediately after upload**, leaving a dead reference.

Then rendering failed two ways:
- `SmsComposeCard`: `thumbUri = mediaLocalUri ?? mediaUrl` — it **preferred** the
  now-revoked blob over the good public URL → blank grey chip.
- `SmsPreviewPane`: was passed **only** `mediaUri={mmsLocalUri}` (the local blob) and
  never the verified public URL, so its phone-bubble tile was **permanently blank on
  web** — the revoke made it dead, and there was no public-URL fallback at all.

### Fix
- Display now **prefers the verified `brand_covers` public URL** (`remoteUrl ??
  localUri`) in BOTH surfaces — the public URL is cross-platform-renderable and is
  exactly what will be sent. The local blob is used only as the optimistic
  pre-upload preview.
- The blob is **kept alive** and revoked only on removal / channel-change / unmount
  (removal handler + an unmount cleanup `useEffect` via `mmsMediaRef`), not in a
  finally right after upload.
- A spinner overlays each thumb while its upload is in flight.

Files: `compose.tsx` (state model + derivations + pick/remove/cleanup),
`SmsComposeCard.tsx` (renders `item.uri`), `SmsPreviewPane.tsx` (renders all
`mediaUris`).

## Fix #2 — MULTI-SELECT up to 10 (Twilio MMS cap)

- `MMS_MAX_MEDIA = 10` in both `compose.tsx` and `SmsComposeCard.tsx`.
- Picker: `allowsMultipleSelection: true` + `selectionLimit: remaining` (native) and
  `multiple: true` + `maxFiles: remaining` (web), where `remaining = 10 -
  mmsMedia.length`. Overflow is clamped and a toast warns.
- Each picked photo uploads via `uploadMarketingMmsImage` (still ≤5 MB, JPEG/PNG/GIF)
  and collects into the verified `mmsMediaUrls` array.
- Compose card shows a horizontal thumbnail row (each with its own remove ✕ + upload
  spinner) plus an add-more tile; preview pane renders ALL tiles; card shows `N/10`.
- Send is blocked while any photo is uploading (only verified URLs ride the payload).

### Send path — sends ALL media (verified, unchanged)
`smsAdapter.twilioSend` already loops `for (const u of mediaUrls) params.append(
"MediaUrl", u)` and `marketing-send` passes the whole `mediaUrls` array — so all
photos (up to 10) ride the Twilio MMS. No send-path code change was needed for
multi-media; NG/Termii still drops media (SMS-only).

## Fix #3 — "Reply STOP to opt out." ON ITS OWN LINE (preview + wire aligned)

Two append sites, both changed to a blank-line separator (`\n\n`):
- Client preview: `smsCost.bodyWithFooter` → `` `${body}\n\n${STOP_FOOTER}` ``.
- Server wire: `smsAdapter.composeSmsBody` gained a `stopFooterOwnLine` flag
  (**default false = single space**, byte-identical for transactional SMS and every
  existing transactional test). `marketing-send/index.ts` passes
  `stopFooterOwnLine: true`, so the delivered marketing SMS matches the preview.

No double-append (both sites keep the idempotent `/reply stop/i` guard; the composer
never types the footer). `\n` is a GSM-7 char so segmentation is unaffected.

### WIRE-BODY CHANGED → REDEPLOY NEEDED
`supabase/functions/marketing-send` (and its shared `_shared/adapters/smsAdapter.ts`)
must be **redeployed** for the delivered marketing SMS footer to move to its own
line. (Operator handles deploy.) Transactional SMS senders are unaffected.

## Fix #4 — HIDE THE SMS COST (restorable)

`SmsComposeCard` gates the "Est. cost ~$X" figure + its "final cost is metered" note
behind `const SHOW_SMS_COST = false`. Encoding / Per-recipient / Total
segments-or-messages stay (non-cost scope info). `estimateSmsCost` and
`formatCurrency` are untouched — flip the flag to restore. The `SmsPreviewPane`
footer (`MMS · 35 chars · 1 message`) is segment info, not price — left as-is.

---

## Files changed
| File | What |
|---|---|
| `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | item-model MMS state, derived `mmsMediaUrls` (verified only) + display projections, multi-select pick/upload, per-key remove, blob revoke on teardown, send-while-uploading guard, wiring |
| `mingla-business/src/components/marketing/SmsComposeCard.tsx` | `media[]` + `maxMedia` props, horizontal thumb row w/ spinner + remove, cost hidden behind `SHOW_SMS_COST`, `MMS_MAX_MEDIA` export |
| `mingla-business/src/components/marketing/SmsPreviewPane.tsx` | `mediaUris[]` prop, renders ALL tiles |
| `mingla-business/src/utils/smsCost.ts` | `bodyWithFooter` STOP footer on own line (`\n\n`) |
| `supabase/functions/_shared/adapters/smsAdapter.ts` | `composeSmsBody(msg, stopFooterOwnLine)` + `SmsSendInput.stopFooterOwnLine` |
| `supabase/functions/marketing-send/index.ts` | passes `stopFooterOwnLine: true` on the marketing send |
| `.github/scripts/strict-grep/i-proposed-1282-mms-media-url-publicly-fetchable.mjs` | AMENDED for the item-model refactor (invariant unchanged: verified URLs only, no local uri in payload) + self-test |
| `.github/workflows/strict-grep-mingla-business.yml` | registry doc comment updated |
| `mingla-business/src/components/marketing/__tests__/orch1289MmsMultiselect.test.ts` | NEW (16 tests) |

Edge fn changed → **redeploy `marketing-send`** (fix #3 wire body). No migration.

## Test output (actual)
- `npx tsc --noEmit` (business): **zero errors in any touched file** (compose /
  SmsComposeCard / SmsPreviewPane / smsCost / new test) — the pre-existing repo-wide
  errors (react-dom/server types, app.config.ts, richEditor.tsx, testing-library, …)
  are unrelated.
- `deno check` `smsAdapter.ts` → OK; `marketing-send/index.ts` → OK.
- Deno SMS tests: **31 passed / 0 failed** (`orch_1161_notify_dispatch_v2`,
  `marketing_send_mms_adapter`, `meta_orch_1281_mms_defer_no_double_send`,
  `send_venue_sms` LOCKED copy, smsAdapter killswitch/partialbatch/termii).
- Jest marketing dir: **110 passed / 0 failed** (incl. `metaOrch1281SmsPreview`,
  `metaOrch1283NoRcsTab`, `orch1289MmsMultiselect` = 16).
- Strict-grep gates PASS (self-test + real): 1282-media-url (amended), 1282-ng-drops,
  1161-sender/killswitch, 1227-ng-termii, 1283-no-rcs, 1263-claim.
- Append-only check: PASS (1 added test file, no modifications, no token needed).

### Fails-on-revert (proven)
Temporarily reverted `mediaUris={mmsPreviewUris}` → `mediaUri={mmsLocalUri}` (preview
render) and `allowsMultipleSelection: true` → `false` (multi-select cap): **exactly
the 2 corresponding tests failed** (2 failed / 14 passed); restored → 16/16 green.
The STOP-newline fix has an executable fails-on-revert (`bodyWithFooter` exact-equality).

### Known PRE-EXISTING failure (NOT this change)
`supabase/functions/marketing-send/index.test.ts` T-B07 asserts `case "rcs":` /
`rcs_not_yet_enabled` in the dispatcher — ORCH-1283 removed the RCS case but left
that assertion stale. It fails at HEAD (branch base) with zero rcs refs in `index.ts`;
my diff only touches `sendSms`. Out of scope for ORCH-1289 (separate ORCH-1283 test
debt) — not modified.

## Regression posture
ORCH-1270 defer/idempotency/finalizer, ORCH-1282 US-only MMS / NG-drop /
public-URL verification, ORCH-1283 no-RCS-tab — all intact and gate-verified.
