# TEST — META-ORCH-1281 [marketing SMS wave 2]

**Verdict: CONDITIONAL PASS** — the three features (SMS preview, photo/MMS, RCS-tab removal) are correctly implemented and behaviourally verified; the ORCH-1270 anti-double-send machinery is intact **with media present**; media is US/Twilio-only and NG drops it. **One real regression** was found and confirmed: ORCH-1283's removal of the `ChannelPayloadRcs` type broke a pre-existing test (`marketingRenderingService.test.ts`) at both compile-time and runtime. It is contained (test-only; no live CI job currently executes it) and trivially fixable, but must be cleared before a clean CLOSE.

**Branch:** `1281-marketing-sms-wave2` · **Worktree:** `~/Desktop/mingla-orchs/1281-[marketing-sms-wave2]/`
**Commits under test:** b2bc13ac3 (feature), 49970b6bd (spec+impl). **Tester commit:** f147b516f (adversarial test).
**Runtime ceiling honoured:** no real Twilio/Termii send, no authed biz-web runtime. Source + Deno unit (real adapter with stubbed `fetch`) + jest (node/ts-jest) + live gate runs. Web composer + on-device pick claims are PASS-by-mechanism / capped at "suspected" per `feedback_biz_web_authed_runtime_unreachable_cap_claims`.

---

## Tooling
`deno 2.7.14`, `node v22.22.2`, jest via `mingla-business/node_modules/.bin/jest` (ts-jest, node env).

---

## ORCH-1281 — SMS preview — PASS

**Branch wiring (all 3 sites), from `compose.tsx`:**
- Import present (line 65). Wide-desktop rail: `channel === "sms" ? <SmsPreviewPane …> : <EmailPreviewPane …>` (lines 960–970). Inbox modal: title `channel === "sms" ? "Message preview" : "Inbox preview"` (line 1050); body branches `SmsPreviewPane`/`EmailPreviewPane` (lines 1067–1077). Review sheet fed `channelKind={channel === "sms" ? "sms" : "email"}`, `messagePreview={bodyWithFooter(smsBody).slice(0,160)}`, `hasMedia` (lines 1014–1016). **No cross-wiring** — `email` path renders `EmailPreviewPane` at every site.
- `ComposerReviewSheet.tsx` (lines 97–118): `channelKind === "sms"` renders a **MESSAGE** section (value = `messagePreview`, `numberOfLines={4}`, `+ 1 photo (MMS)` when `hasMedia`); else the existing **SUBJECT** section verbatim. ORCH-1270 info-note block (lines 76–146) untouched.

**Preview content correctness (`SmsPreviewPane.tsx`):**
- Renders `bodyWithFooter(body)` (line 81/136) → previewed text **includes the auto-appended `Reply STOP to opt out.` footer** exactly as the send path composes it (same `smsCost` helper the adapter mirrors). Single source of truth confirmed: preview count = `estimateSmsCost(body, reachableSms ?? 0, undefined, hasMedia)` (line 86) — identical call the composer's cost box uses (`SmsComposeCard.tsx` line 86).
- Attack — empty body: `isEmpty` (line 82) → placeholder bubble `"Start typing your text to preview it."`, count line SKIPPED (line 145 guarded by `showCount`). ✔
- Attack — multi-segment / UCS-2: count line composed from the shared util's `encoding`/`charCount`/`segmentsPerRecipient`; verified against the util unit tests below. ✔
- Attack — tracking link: `renderWithLinks` splits on `/(https?:\/\/[^\s]+)/g` (odd-index parity, no regex `lastIndex` footgun) and styles URL spans `accent.warm` + underline; muted caption `"Links become trackable Mingla links."`. ✔
- No email chrome: no `>Unsubscribe<` / `>FROM<` text nodes. ✔

**jest (5 suites / 32 tests):**
```
PASS src/components/marketing/__tests__/metaOrch1281SmsPreview.test.tsx
PASS src/components/marketing/__tests__/metaOrch1283NoRcsTab.test.tsx
PASS src/services/__tests__/marketingMmsImageService.test.ts
PASS src/utils/__tests__/smsCost.test.ts
PASS src/components/marketing/__tests__/orch_1270_review_sheet_warning.test.tsx   (no ORCH-1270 review-sheet regression)
Tests: 32 passed, 32 total
```
Note: the implementor's `metaOrch1281SmsPreview` / `metaOrch1283NoRcsTab` are **source-contract (regex)** tests — the default node/ts-jest config cannot mount the RN tree (no RTL). Honest ceiling; runtime bubble render is the iOS-sim tester's job (not reachable in this pass — PASS-by-mechanism on the branch/props wiring above).

---

## ORCH-1282 — photo / MMS — PASS (highest scrutiny)

**End-to-end media trace (each hop confirmed):**
1. `SmsComposeCard` attach → parent `handlePickMms` (`compose.tsx` 609–681): native `launchImageLibraryAsync({mediaTypes:["images"],selectionLimit:1})` / web `pickBrowserFiles({accept:"image/jpeg,image/png,image/gif"})`, `revokeBrowserPickedFiles` in `finally`.
2. `uploadMarketingMmsImage(brandId, input)` (`marketingMmsImageService.ts`) → uploads to **public `brand_covers`** bucket key `${brandId}/marketing-mms/${token}.${ext}` → `getPublicUrl` → **`verifyBrandCoverPublicUrl`** → returns the VERIFIED public URL.
3. `setMmsMediaUrls([url])` → `buildPayload` SMS branch spreads `...(mmsMediaUrls.length > 0 ? { media_urls } : {})` (line 337) → `channel_payload.media_urls`.
4. `marketing-send/index.ts sendSms` reads+filters `mediaUrls` (lines 840–844) → passes `mediaUrls` into `smsAdapter.send({…})` (line 1003).
5. `smsAdapter.send` routes NG→`termiiSend` (no media arg), else→`twilioSend(to, body, sid, input.mediaUrls)` (line 276). `twilioSend` appends `params.append("MediaUrl", u)` per URL (lines 161–165).

**CRITICAL — media rides Twilio ONLY; NG carries none (I-PROPOSED-1282-MMS-NG-DROPS-MEDIA):** verified by real-adapter Deno tests with stubbed `fetch`:
```
US MMS: mediaUrls appended as the Twilio MediaUrl form param ... ok   (body ~ MediaUrl=https%3A…)
US SMS (no media): body carries NO MediaUrl param (regression pin) ... ok
NG MMS: Termii path taken; NO media param transmitted (SMS-only) ... ok  (JSON has no MediaUrl/media_urls/media)
```
Composer disclosure present: `SmsComposeCard` persistent caption — *"Photos send as a picture message (MMS) to US numbers — costs more than a text. Nigerian numbers get the words only."* ✔

**CRITICAL — URL verified PUBLIC before entering payload:** `verifyBrandCoverPublicUrl` (`brandCoverRules.ts` 223) does a real **HEAD** (non-405/501 failure → `throwUploadFailed()` = `BrandCoverError`), then a **GET Range 0-0** byte-assert. On a non-public/404/403 URL it THROWS → `uploadMarketingMmsImage` never returns the URL → nothing reaches `media_urls`/Twilio. Fail-close confirmed. Failure paths (`marketingMmsImageService.test.ts`, real behavioural mocks):
```
rejects a photo over 5 MB with file_too_large — no upload ... ok
rejects webp (MMS-inconsistent) with unsupported_type — no upload ... ok
rejects a non-image (pdf) with unsupported_type ... ok
accepts a PNG: uploads under marketing-mms/, verifies, returns the public URL ... ok  (verify called WITH the public URL)
throws upload_failed when storage upload errors ... ok  (verify NOT called — no unverified URL leaks)
```
Composer error handling (`handlePickMms` catch, 668–677): `BrandCoverError` → `setErrorBanner(err.message)`, clears `mmsLocalUri`; `finally` clears `mmsUploading` → attach cleared, send still possible as plain SMS. ✔

**Size/type limits (≤5 MB, JPEG/PNG/GIF):** `MMS_MAX_BYTES = 5*1024*1024`; `MMS_ALLOWED_MIME_TYPES = {image/jpeg, image/png, image/gif}` (webp intentionally excluded). Double-guarded on declared `fileSize` AND actual `byteLength`. ✔

**Cost estimate (`smsCost.test.ts`, appended MMS cases):**
```
estimates MMS as one message per recipient at the MMS rate ... ok   (encoding MMS, seg/recip 1, total=reach, cost=reach*2)
MMS charges per message regardless of segment length (long body still 1 message) ... ok
regression pin: hasMedia=false path is unchanged (SMS segments/cost) ... ok
```

**REGRESSION (highest priority) — ORCH-1270 defer/idempotency/finalizer intact WITH media:** all existing suites re-run green (real exported helpers):
```
running 10 tests  orch-1270-defer.test.ts            ... all ok
running 11 tests  orch-1270-fds1.test.ts             ... all ok  (shouldSkipDispatchedRecipient matrix)
running 16 tests  orch-1270-tester-boundaries.test.ts ... all ok
```
`sendSms` diff = additive only: `mediaUrls` read after `rawBody`, passed as a passenger into `smsAdapter.send`. The idempotency SELECT (fetches `provider_message_id`), `shouldSkipDispatchedRecipient`, `decideSmsDisposition` defer/fail upserts, the error-checked-retry-then-throw terminal `sent` write, batching/pacing, clicks, and `mkt_finalize_campaign` are byte-for-byte unchanged. `CampaignRow.channel_payload.kind` narrowed to `"email"|"sms"` (required for the sentinel). Native-module: `expo-image-picker` already backs shipped experience-stop photos (low risk; a native rebuild is the ship vehicle anyway per COMMS-0063).

---

## ORCH-1283 — remove RCS tab — PASS (with the regression noted below)

- `ChannelTabs.tsx`: `TABS` = exactly `{email, sms}`; `MarketingChannelKind = "email" | "sms"`. No `rcs` entry/label.
- `marketing-send/index.ts`: `case "rcs"` deleted; `switch(kind)` keeps `email`/`sms`/`default: throw` + `const _exhaustive: never = kind` (compiles because the local `kind` union is narrowed).
- `types/marketing.ts`: `ChannelPayloadRcs` + its union member deleted. `MarketingChannel` channel-column union (`"email"|"sms"|"rcs"`) and the consent/unsubscribe `'all'` resolver **intentionally left** (§6.3) — grep confirms the only remaining `rcs` string usages are `MarketingChannel` (line 19) + `marketingAudienceService.ts` consent lines (367/372), all in DO-NOT-TOUCH scope.
- `marketingRenderingService.ts`: orphan `else if (payload.kind === "rcs")` branch deleted; `email`/`sms`/`else (never)` sentinel still compiles.
- **No dangling `ChannelPayloadRcs` references** in `mingla-business/src` or `supabase/functions` (grep: none).

**Gate green + still enforces email+sms (the key adversarial check):**
```
$ node .github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs
[ORCH-0815-B] strict-grep gate: clean (0 violations across 12 checks)   EXIT=0
```
Adversarial — temporarily removed the `sms` tab literal from `ChannelTabs.tsx`, re-ran, then restored via `git checkout`:
```
[ORCH-0815-B][check-2] ChannelTabs.tsx: literal `sms` tab missing
[ORCH-0815-B] strict-grep gate: FAILED with 1 violation(s)   GATE_EXIT=1
i-proposed-1283-no-rcs-tab: the sms tab literal must remain ... FAILED   EXIT=1
```
→ the gate edit **did not gut sms/email enforcement**; removing a required literal still fails BOTH gates. All DRAFT gates green in self-test + tree mode (`i-proposed-1283-no-rcs-tab`, `i-proposed-1282-mms-ng-drops-media`, `i-proposed-1282-mms-media-url-publicly-fetchable`).

---

## Step 0.5 — tester-authored adversarial regression (satisfied)

**File (committed f147b516f):** `supabase/functions/__tests__/meta_orch_1281_mms_defer_no_double_send.test.ts`

**Angle (distinct from the implementor's source-contract tests AND the existing ORCH-1270 fds1 unit — neither threads MMS media):** composes the REAL shipped `shouldSkipDispatchedRecipient` + `decideSmsDisposition` (from `marketing-send/index.ts`) with the REAL `smsAdapter.send` (stubbed `fetch`), replaying a full **defer → in-window-send → LOST terminal-write → cron re-pick** sequence over a mixed US/NG audience with `media_urls` present. Asserts: (1) the deferred pass makes NO provider call (media not sent early); (2) the US recipient hits Twilio **exactly once** carrying its `MediaUrl` even after a `'queued'`+`provider_message_id` orphan and a cron re-pick — **no double MMS-send**; (3) the NG recipient routes to Termii and never carries any media param.
```
MMS media survives defer→send→lost-write→cron-repick with NO double-send; NG drops media ... ok
```
**Fails-on-revert (executed, then restored via git):** reverted the `provider_message_id` branch of `shouldSkipDispatchedRecipient` (marketing-send/index.ts ~L116) to a terminal-only check →
```
error: AssertionError: already-dispatched (provider_id) orphan must be SKIPPED
FAILED | 0 passed | 1 failed
```
i.e. the orphan is re-selected and the recipient is texted a SECOND time **with its media** — the exact double-send hole the ORCH-1270 F-DS-1 fix closes. Restored; test green again; working tree clean (no product code modified).

**Aggregate backend Deno:** `ok | 41 passed | 0 failed` (40 existing + my 1).

---

## Defect

### D-1 (MEDIUM) — ORCH-1283 broke a pre-existing test: `marketingRenderingService.test.ts`
Removing `ChannelPayloadRcs` from the `CampaignChannelPayload` union + the `rcs` branch in `validateChannelPayload` orphaned an **unchanged** pre-existing test that constructs an `rcs` payload and asserts the removed message.

**Repro:**
```
$ cd mingla-business && npx jest src/services/marketing/__tests__/marketingRenderingService.test.ts
FAIL … Test suite failed to run
  src/…/marketingRenderingService.test.ts:96:9 - error TS2322:
  Type '"rcs"' is not assignable to type '"email" | "sms"'.
Tests: 0 total   (whole suite fails to compile)
```
Proof it is a NEW regression (not baseline):
- `git show origin/main:…/types/marketing.ts` → the union INCLUDED `ChannelPayloadRcs { kind:"rcs"; rich_card; fallback_sms }`, and `validateChannelPayload` had the `rcs` branch returning `["RCS channel not yet enabled"]` → the test **compiled and passed on main**.
- `git diff origin/main -- …/marketingRenderingService.test.ts` → empty (test unchanged). The change under test is the sole cause.
- `tsc --noEmit` on the branch reports the same `TS2322` in the non-`../packages` error set.

Second-order: even if the type error were suppressed, the runtime assertion `.toEqual(["RCS channel not yet enabled"])` (line 100) would now fail — the branch returns `"Unknown channel kind: [object Object]"` (hits the `never` sentinel).

**Blast / why MEDIUM not HIGH:** no current CI job runs it — there is **no full-jest and no `tsc` gate** in `.github/workflows/`, and the `meta-orch-1281` job runs only strict-grep gates — so this will NOT turn the cluster's CI red. But it leaves compile-broken code in the repo, breaks any full-suite / typecheck run, and violates the regression-protection contract. The spec's own ORCH-1283 tester bullet ("confirm no other file references the removed `ChannelPayloadRcs` type (tsc)", §8) anticipated exactly this.

**Fix (trivial, implementor scope — NOT applied here per ADD-tests-only guard):** in `marketingRenderingService.test.ts` lines 90–101, drop the `rcs` half of the `"rejects sms + rcs payloads"` case (RCS is decommissioned), keeping the `sms` assertion — or delete the stale expectation entirely.

---

## What I verified vs. capped
- **Verified (runtime/behavioural):** MMS media threading through the real adapter (US MediaUrl / NG SMS-only), MMS cost math, upload-service guards + fail-close, ORCH-1270 defer/idempotency intact with media (41 Deno tests), all four strict-grep gates + the "gate still enforces sms" adversarial probe, my defer-no-double-send regression + its fails-on-revert.
- **Capped ("suspected" / PASS-by-mechanism):** the on-screen SMS bubble render, the on-device photo pick, and the web `browserFilePicker` path — the authed biz-web/RN composer runtime is unreachable in automated QA. Branch/props wiring is source-confirmed; iOS-sim runtime is the next tester's job. No real Twilio/Termii send was performed (kill-switch + stubbed `fetch` only).
