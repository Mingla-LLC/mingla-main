# IMPLEMENTATION — META-ORCH-1281 [marketing SMS wave 2]

**Branch:** `1281-marketing-sms-wave2` · **Worktree:** `~/Desktop/mingla-orchs/1281-[marketing-sms-wave2]/`
**Spec (binding):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1281_MARKETING_SMS_WAVE2.md`
**Cluster:** ORCH-1281 (SMS preview) + ORCH-1282 (photo/MMS) + ORCH-1283 (remove RCS tab). ONE eventual PR.

All edits inside the spec §9 allowlist (plus the dispatch-mandated new DRAFT gate scripts + their workflow registrations). ORCH-1270 defer/finalizer/idempotency untouched and regression-verified. No migration (confirmed — §6.1: `channel_payload` is jsonb, CHECK inspects only `kind`; `media_urls` adds a JSON key). No deploy, no merge.

---

## Per-file changes

### ORCH-1283 — remove the dead RCS tab (subtract-first)
- **`mingla-business/src/components/marketing/ChannelTabs.tsx`** — deleted the `{ kind: "rcs", … }` TABS entry; narrowed `MarketingChannelKind` → `"email" | "sms"`; updated the doc comment to a 2-channel contract.
- **`supabase/functions/marketing-send/index.ts`** — deleted `case "rcs": throw new Error("rcs_not_yet_enabled");`; narrowed the local `CampaignRow.channel_payload.kind` → `"email" | "sms"` (REQUIRED so `const _exhaustive: never = kind` still compiles); kept the `default:` throw + sentinel; updated the header doc comment.
- **`mingla-business/src/types/marketing.ts`** — deleted `ChannelPayloadRcs` + its `| ChannelPayloadRcs` union member. Left `MarketingChannel` (channel-column union) and consent/unsubscribe `'all'` logic ALONE (§6.3).
- **`mingla-business/src/services/marketing/marketingRenderingService.ts`** — deleted the now-uncompilable `else if (payload.kind === "rcs")` branch; the `email`/`sms`/`else (never)` sentinel still compiles. (Left the pre-existing stale `"SMS channel not yet enabled"` copy untouched — Discovery D-1.)
- **`.github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs`** — removed ONLY the check-1 `case "rcs"` assertion and the check-2/12 `kind: "rcs"` assertion; KEPT the email + sms assertions, the `switch (kind)`, the `default: throw`, and the `_exhaustive: never = kind` assertions; updated the check-2/12 descriptions to "2 tabs (email + sms)".

### ORCH-1282 — SMS photo / MMS (end-to-end)
- **`mingla-business/src/utils/smsCost.ts`** — extended `estimateSmsCost` additively with a 4th param `hasMedia = false`; added `DEFAULT_MMS_COST_MINOR = 2`; extended `SmsEstimate.encoding` → `"GSM-7" | "UCS-2" | "MMS"`. When `hasMedia`: `encoding="MMS"`, `segmentsPerRecipient=1`, `totalSegments=safeReach`, cost `= safeReach * 2`; `charCount` still counts `bodyWithFooter`.
- **`mingla-business/src/services/marketingMmsImageService.ts`** (NEW) — `uploadMarketingMmsImage(brandId, input)`: a thin mirror of `uploadExperienceStopImage`. **Upload path used: public `brand_covers` bucket, key `${brandId}/marketing-mms/${token}.${ext}`** via `supabase.storage.from('brand_covers').upload(...)` → `getPublicUrl` → `verifyBrandCoverPublicUrl`. Stricter MMS limits: JPEG/PNG/GIF only (webp excluded — carrier-inconsistent), 5 MB cap (`MMS_MAX_BYTES`). Reuses `resolveBrandCoverContentType`, `generateBrandCoverPathToken`, `readBrandCoverFileBytes`, `verifyBrandCoverPublicUrl`.
- **`mingla-business/src/components/marketing/SmsComposeCard.tsx`** — additive attach props (`brandId`, `mediaUrl`, `mediaLocalUri`, `uploading`, `onPickMedia`, `onRemoveMedia`, `hasMedia`); attach ghost-button (Icon `upload` + "Add photo", disabled while uploading / no brand) → uploading spinner → 64×64 thumbnail chip + labelled Remove (×); persistent MMS honesty caption; cost box switches to MMS ("Total messages", "1 message", MMS rate) via `estimateSmsCost(value, reach, undefined, hasMedia)`.
- **`mingla-business/src/types/marketing.ts`** — added `media_urls?: string[]` to `ChannelPayloadSms`.
- **`mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`** — added `mmsMediaUrls`/`mmsLocalUri`/`mmsUploading` state (reset when leaving SMS in `handleChannelChange`); `handlePickMms` (native `launchImageLibraryAsync` / web `pickBrowserFiles`, mirrors `ExperienceStopPhotoSheet` acquisition; upload → `setMmsMediaUrls([url])`; `BrandCoverError` → error banner + clear local uri; `revokeBrowserPickedFiles` in finally) + `handleRemoveMms`; `buildPayload` SMS branch spreads `media_urls` when present; draft rehydration restores `mmsMediaUrls`/`mmsLocalUri`; `useComposerDraft` state includes `mmsMediaUrls`; wired the new props into `SmsComposeCard`.
- **`supabase/functions/marketing-send/index.ts`** — added `media_urls?: string[]` to `CampaignRow.channel_payload`; in `sendSms`, after `rawBody`, read+filter `mediaUrls` and pass `mediaUrls,` into the `smsAdapter.send({...})` call. **Everything else in `sendSms` byte-for-byte unchanged** (idempotency read, `decideSmsDisposition` defer/fail, retry-and-throw terminal write, batching/pacing, clicks, `mkt_finalize_campaign`).
- **`supabase/functions/_shared/adapters/smsAdapter.ts`** — added `mediaUrls?: string[]` to `SmsSendInput`; `twilioSend` takes a 4th `mediaUrls?` param and appends `params.append("MediaUrl", u)` per URL (cited Twilio Create-Message `MediaUrl` docs inline); `send()` passes `input.mediaUrls` into `twilioSend` ONLY (the NG/`termiiSend` branch never receives media → NG SMS-only). No change to MessagingServiceSid / no-raw-From / kill-switch / 21610 mapping.

### ORCH-1281 — SMS blast preview (phone-bubble mock)
- **`mingla-business/src/components/marketing/SmsPreviewPane.tsx`** (NEW) — dark phone canvas (`#0B0D12`), brand-identity sender header (36×36 avatar + "Text message · SMS" / "Picture message · MMS"), left received bubble (`#26282E`, tail corner) rendering `bodyWithFooter(body)` with inline `accent.warm` underlined links, MMS image tile (4/3, ≤220), "Links become trackable Mingla links." caption, empty-state bubble, live count line via shared `estimateSmsCost`, honest preview footer note. Read-only; I-39 accessibility labels (bubble = full wire body; image = "Attached photo preview").
- **`mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`** — imported `SmsPreviewPane`; branched all three surfaces on `channel === "sms"`: wide-desktop rail + inbox-preview modal (title now `"Message preview"` for SMS) render `SmsPreviewPane`, else `EmailPreviewPane` (email untouched); passed `channelKind`/`messagePreview={bodyWithFooter(smsBody).slice(0,160)}`/`hasMedia` to `ComposerReviewSheet`.
- **`mingla-business/src/components/marketing/ComposerReviewSheet.tsx`** — additive `channelKind`/`messagePreview`/`hasMedia` props; when `channelKind === "sms"` renders a MESSAGE section (value = `messagePreview`, `numberOfLines={4}`, "+ 1 photo (MMS)" caption when `hasMedia`) instead of SUBJECT; email path renders the existing SUBJECT verbatim. ORCH-1270 info-note block untouched.

### DRAFT invariant gates + registration
- **`.github/scripts/strict-grep/i-proposed-1283-no-rcs-tab.mjs`** (NEW) — I-PROPOSED-1283-NO-RCS-TAB; self-tested.
- **`.github/scripts/strict-grep/i-proposed-1282-mms-media-url-publicly-fetchable.mjs`** (NEW) — I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE; self-tested.
- **`.github/scripts/strict-grep/i-proposed-1282-mms-ng-drops-media.mjs`** (NEW) — I-PROPOSED-1282-MMS-NG-DROPS-MEDIA; self-tested.
- **`.github/workflows/strict-grep-mingla-business.yml`** — new job `meta-orch-1281-marketing-sms-wave2` (runs no-rcs-tab + media-url-fetchable self-test+tree + the amended 0815-B gate) + 2 registry comment lines.
- **`.github/workflows/supabase-migrations-and-stripe-deno.yml`** — new job `orch-1282-mms-strict-grep` (ng-drops-media self-test+tree); added `marketing_send_mms_adapter.test.ts` to `DENO_TEST_FILES`; added `i-proposed-1282-*.mjs` to the push+PR path filters.

---

## Test output (actual)

**Backend Deno (`deno test --allow-env --allow-net --allow-read --no-check`):** `ok | 24 passed | 0 failed`
- 3 new `marketing_send_mms_adapter.test.ts` (US MMS MediaUrl; US no-media pin; NG Termii drops media)
- 10 `orch-1270-defer.test.ts` (defer state machine + two-pass idempotency — **no regression**)
- 11 existing adapter tests (termii routing, kill-switch, partial-batch)
- `deno check` clean on `marketing-send/index.ts`, `smsAdapter.ts`, the new test.

**Business jest (`jest.config.cjs`, node/ts-jest):** `5 passed suites, 32 passed tests`
- `smsCost.test.ts` (+4 MMS cases appended)
- `marketingMmsImageService.test.ts` (5: >5 MB reject, webp reject, pdf reject, PNG success under `marketing-mms/` + verify called, upload_failed)
- `metaOrch1281SmsPreview.test.tsx` (7, source-contract)
- `metaOrch1283NoRcsTab.test.tsx` (4, source-contract)
- `orch_1270_review_sheet_warning.test.tsx` (existing ORCH-1270 contract — **no regression**)

**`tsc --noEmit` (business):** 0 errors in any touched file. Non-`../packages` error count = **69, identical to baseline** (pre-existing: checkout buyer.tsx, richEditor.tsx, IconChrome.tsx, render-test missing `@testing-library/react-native`/`react-dom/server`, app.config.ts duplicate keys). No new errors introduced.

**Gates:** all self-test + tree PASS — `orch-0815-b-composer-and-send` (clean, 12 checks), `i-proposed-1283-no-rcs-tab`, `i-proposed-1282-mms-media-url-publicly-fetchable`, `i-proposed-1282-mms-ng-drops-media`.

---

## Fails-on-revert proof (empirically executed, then restored)

| Feature | Revert point | Result |
|---|---|---|
| ORCH-1282 cost | neutered `if (hasMedia)` branch in `estimateSmsCost` | the 2 MMS cost tests FAILED (encoding≠"MMS"); regression pin passed. Restored. |
| ORCH-1282 send | disabled `params.append("MediaUrl", u)` in `twilioSend` | "US MMS" deno test FAILED (body lacked `MediaUrl`); NG-drop + no-media pin passed. Restored. |
| ORCH-1282 upload | added `image/webp` to `MMS_ALLOWED_MIME_TYPES` | webp-rejection service test FAILED. Restored. |
| ORCH-1281 preview | changed inbox-modal `channel === "sms" ?` guard so SMS no longer routes to `SmsPreviewPane` | branch-count assertion (`>= 2`) FAILED. Restored. |
| ORCH-1283 tab | re-added `{ kind: "rcs", … }` to `ChannelTabs` TABS | `metaOrch1283` (2 asserts) AND the `no-rcs-tab` gate FAILED. Restored. |

## Amended RCS gate — confirmed green locally
`node .github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs` → `clean (0 violations across 12 checks)`, exit 0, against the edited ChannelTabs/marketing-send. The email + sms assertions are kept; only the two rcs assertions were removed.

## MMS upload path used
Public `brand_covers` bucket, key prefix `${brandId}/marketing-mms/${token}.${ext}` → `getPublicUrl` → `verifyBrandCoverPublicUrl` (HEAD/GET reachability) before the URL is written into `channel_payload.media_urls`. Reuses proven infra; **no new bucket, policy, or migration** (§4.2).

## Migration assessment
Confirmed NONE needed. `media_urls` is a JSON key on the jsonb `channel_payload`; the DB CHECK validates only `kind` (`= channel`), which is unchanged. The permissive `channel`-column CHECK + consent/unsubscribe `'all'` logic and `MarketingChannel` union were intentionally left as-is (§6.2/§6.3).

## Deviations
None material. Notes: (1) the `Icon` set has no literal `image`/`paperclip` glyph, so the attach button reuses the proven `upload` glyph (the same icon `ExperienceStopPhotoSheet` uses for its library button) and `close` for Remove — visual choice within spec intent. (2) `SmsPreviewPane`'s `currencyCode` prop is accepted for the spec's interface shape but currently unrendered (the §3.3 count line shows encoding/chars/segments only, no cost) — reserved for a future cost line. (3) `SmsComposeCard`'s cost box "Total segments" row is relabelled "Total messages" under MMS for honesty (spec named only the Per-recipient/Encoding/Est-cost rows; this is consistent).

## git log (this branch)
See `git log --oneline` appended by the commit step.
