# TEST — ORCH-1289 [marketing MMS composer: multiselect + preview + STOP-line + hide-cost]

Branch `1289-mms-multiselect-preview`. Base impl commit `f311d4175`; tester commits
`b57a7435b` (T-B07 cleanup) + `9c51d51c4` (Step 0.5 parity test). Runtime ceiling per
`feedback_biz_web_authed_runtime_unreachable_cap_claims`: source + jest + Deno +
pure-function execution — no real browser / Twilio end-to-end. True render/send claims
are stated PASS-BY-MECHANISM.

## VERDICT: PASS (conditional on edge-fn redeploy)

All four fixes are correct and gate-verified. The one pre-existing broken test (T-B07)
is fixed and the full marketing-send Deno suite is green. No defects found; one latent,
UNREACHABLE inconsistency documented (INFO). **Edge fn redeploy required: YES
(STOP-newline is a WIRE-body change to `marketing-send` + shared `smsAdapter`).**

---

## T-B07 pre-existing cleanup (done first)

ORCH-1283 deleted `case "rcs":` + `rcs_not_yet_enabled` from `marketing-send/index.ts`
(dispatcher is now the 2-member union `"email" | "sms"`, index.ts:418-437) but left
T-B07 in `marketing-send/index.test.ts` asserting they still exist.

- **Confirmed fail at HEAD** (before fix): `FAILED | 12 passed | 1 failed`, error at
  `index.test.ts:24` (`assert(SOURCE.includes('case "rcs":'))`).
- **Fix**: updated ONLY the T-B07 block — replaced the two positive rcs asserts with
  negative guards (`assertFalse` on `case "rcs":` and `rcs_not_yet_enabled`) that keep
  RCS decommissioned; all other T-B07 asserts (switch/email/sms/sendSms/
  unknown_channel_kind/exhaustive-never) preserved.
- Token `[TEST-MOD-APPROVED ORCH-1289]` in commit body (reason: stale ORCH-1283 rcs
  assertion in T-B07). Commit `b57a7435b`.
- **After fix**: `ok | 13 passed | 0 failed`.

The ORCH-1283 no-rcs strict-grep gate inspects `ChannelTabs.tsx` +
`orch-0815-b-composer-and-send.mjs` (NOT index.test.ts), which is why the stale Deno
assertion slipped past CI. My edit is orthogonal to that gate (still passes).

---

## Per-fix evidence

### Fix 1 — blank image preview (web-specific) — PASS (PASS-BY-MECHANISM for true render)
Root cause was a `blob:` URL revoked in a `finally` right after upload + display
preferring the dead local uri; `SmsPreviewPane` never received the public URL.

- Display prefers the verified public URL in BOTH surfaces: `compose.tsx` derives
  `mmsComposeItems`/`mmsPreviewUris` as `m.remoteUrl ?? m.localUri` (compose.tsx:223,
  231); `SmsComposeCard` renders `item.uri` (SmsComposeCard.tsx:196-205); `SmsPreviewPane`
  renders all `mediaUris` (SmsPreviewPane.tsx:130-142).
- Blob kept alive; revoked only on removal (`handleRemoveMms`, compose.tsx:823-830),
  channel-change (compose.tsx:682-689), unmount (`mmsMediaRef` cleanup effect,
  compose.tsx:282-290), upload failure (compose.tsx:800-805), overflow-drop
  (compose.tsx:756-765). The old post-upload `finally` revoke is GONE.
- Spinner overlays each uploading thumb (SmsComposeCard.tsx:206-210) via `item.uploading`.
- Upload failure → the item is dropped + blob revoked + a clear error banner set
  (compose.tsx:800-812) — no dead/blank tile.
- The public URL is proven fetchable before it is used: `verifyBrandCoverPublicUrl`
  runs BEFORE the service returns (enforced by the amended 1282 media-url gate, below),
  so the rendered/sent image is the verified public URL. **PASS-BY-MECHANISM** for the
  real Chrome render (no browser drivable here).
- Draft-reopen restores attachments as already-verified remote items
  (localUri/objectUrl null, remoteUrl=url — compose.tsx:374-380).

### Fix 2 — multi-select up to 10 — PASS
- Cap = 10 in both parent (`MMS_MAX_MEDIA = 10`, compose.tsx:138) and card
  (`export const MMS_MAX_MEDIA = 10`, SmsComposeCard.tsx:49).
- Picker: web `pickBrowserFiles({ multiple:true, maxFiles:remaining })`
  (compose.tsx:716-721); native `allowsMultipleSelection:true, selectionLimit:remaining`
  (compose.tsx:740-741), `remaining = MMS_MAX_MEDIA - mmsMedia.length` (compose.tsx:701).
- 11th image / overflow: three layers — `remaining<=0` early return + banner
  (compose.tsx:702-704), picker `selectionLimit/maxFiles` clamp, and a post-pick
  `assets.slice(0, remaining)` + revoke-dropped-blobs + overflow banner (compose.tsx:756-781).
- Card disables add once full (`canAddMore = media.length < maxMedia`,
  SmsComposeCard.tsx:117) + per-image remove (SmsComposeCard.tsx:211-222) + `N/10` count.
- **Send path sends ALL media**: `smsAdapter.twilioSend` loops
  `for (const u of mediaUrls) params.append("MediaUrl", u)` (smsAdapter.ts:174-178);
  `marketing-send` passes the whole `mediaUrls` array (index.ts:840-844, 1007).
- **NG/Termii still drops media**: NG branch calls `termiiSend(to, body, channel)` with
  NO media arg (smsAdapter.ts:286-289); Termii payload is `type:"plain"` text-only.
- Deno proof — `marketing_send_mms_adapter.test.ts`: US body carries `MediaUrl=https%3A`;
  no-media US body carries no `MediaUrl`; NG hits `/api/sms/send`, never Twilio, and the
  Termii payload `.MediaUrl === undefined`.
- Send blocked while any photo uploads: `missingFieldsLabel` returns "Photos are still
  uploading…" when `channel === "sms" && mmsUploading` (compose.tsx:500-502), and
  `onSendNow`/footer CTAs early-return on a non-null label (compose.tsx:922-927, 1074, 1086).
  Belt-and-suspenders: `buildPayload` uses verified-only `mmsMediaUrls` (compose.tsx:415).

### Fix 3 — "Reply STOP to opt out." on its own line (preview AND wire) — PASS
- Preview: `bodyWithFooter` → `` `${body}\n\n${STOP_FOOTER}` `` (smsCost.ts:30-37),
  used by the composer card estimate + `SmsPreviewPane` (SmsPreviewPane.tsx:86).
- Wire: `composeSmsBody(message, stopFooterOwnLine=false)` — `sep = own ? "\n\n" : " "`
  (smsAdapter.ts:112-126); `marketing-send` passes `stopFooterOwnLine: true` (index.ts:1004),
  so the DELIVERED marketing SMS matches the preview.
- **Transactional byte-identical when flag default-off**: the only opt-in caller is
  `marketing-send`. `notifyV2` transactional sends (notifyV2.ts:198-203, 279) never pass
  the flag → single-space footer, unchanged. `send-venue-sms` uses its own path (adapter
  was generalized from it; does not import `composeSmsBody`).
- No double-append: both sites keep the idempotent `/reply stop/i` guard; the composer
  never types the footer.
- **Executably verified** by my Step 0.5 test (below): the real `composeSmsBody(x,true)`
  == real `bodyWithFooter(x)` byte-for-byte; transactional default = single-space; both
  idempotent.

### Fix 4 — hide SMS cost — PASS
- `const SHOW_SMS_COST = false` (SmsComposeCard.tsx:55) gates the "Est. cost ~$X" figure
  + its "final cost is metered" note (SmsComposeCard.tsx:164-178). No `$` renders in the card.
- Computation intact/restorable: `estimateSmsCost` still imported + called
  (SmsComposeCard.tsx:45, 104); flip the flag to restore.
- The preview/estimate segment line ("MMS · N chars · 1 message") is scope info, not
  price — acceptable per scope.

---

## Guards — actual output

| Guard | Result |
|---|---|
| `deno check` smsAdapter.ts | OK (no output) |
| `deno check` marketing-send/index.ts | OK (no output) |
| `marketing-send/index.test.ts` after T-B07 fix | **13 passed / 0 failed** |
| `deno test supabase/functions/marketing-send/` (incl. ORCH-1270 fds1/defer/tester-boundaries, quiet-hours) | **64 passed / 0 failed** |
| SMS `__tests__` (mms_adapter, 1281 defer/no-double-send, 1161 notify_v2, send_venue_sms) | **20 passed / 0 failed** |
| Consolidated Deno (all above + my parity test) | **87 passed / 0 failed** |
| jest `mingla-business/src/components/marketing` (incl. orch1289MmsMultiselect=16, 1281 preview, 1283 no-rcs) | **110 passed / 110 total (12 suites)** |
| `tsc --noEmit` (business) | 729 pre-existing repo-wide errors (phone-input pkg, react-dom/server, app.config, richEditor, testing-library); **0 in any ORCH-1289 touched file** |
| strict-grep 1282-media-url (AMENDED) | self-test PASS + real PASS |
| strict-grep 1282-ng-drops-media | self-test PASS + real PASS |
| strict-grep 1283-no-rcs-tab | self-test PASS + real PASS |
| strict-grep 1161-sms-from-approved-sender/kill-switch | self-test PASS + real PASS |
| strict-grep 1227-ng-sms-via-termii | self-test PASS + real PASS |

Regression posture: ORCH-1270 defer/finalizer/double-send suite green (64/64 incl. fds1
+ defer + tester-boundaries); ORCH-1282 US-only MMS + NG-drop + public-URL verification
green (adapter Deno + both 1282 gates); ORCH-1283 no-RCS green (gate + fixed T-B07).
SQL suite: no ORCH-1270 `.sql`/pgTAP test present under `supabase/tests/` for
marketing-send (concurrency dir only) — the 1270 defer/idempotency contract is covered
by the Deno FOR-UPDATE-SKIP-LOCKED + defer/fds1 tests, which are green.

---

## Step 0.5 — tester adversarial test + fails-on-revert

New file `supabase/functions/__tests__/orch_1289_stop_footer_wire_preview_parity.tester.test.ts`
(commit `9c51d51c4`; new file = append-only-safe, no token).

**Different angle**: the implementor tests `bodyWithFooter` (client) executably and only
SOURCE-GREPS `composeSmsBody` (server). My test EXECUTES BOTH shipped modules together
and asserts the delivered marketing wire body == the composer preview body byte-for-byte
across 5 reachable inputs — the actual "the delivered SMS matches the preview" guarantee.
Also pins the transactional single-space footer (regression) and idempotency on both
modules. Result: **3 passed / 0 failed**.

**Dual-module fails-on-revert (proven)**: temporarily reverted smsAdapter.ts:122
`const sep = stopFooterOwnLine ? "\n\n" : " ";` → `const sep = " ";` (the pre-ORCH-1289
single-space wire). Result: **2 passed / 1 failed** — the byte-equality assertion
`assertEquals(wire, preview)` (test file line 57) fired:
`AssertionError: delivered marketing SMS must equal the preview for input:
"Come to our summer show tonight!"`. Restored the line (git diff clean) → **3/3 green**.

---

## Findings

No defects (severity ≥ low) found.

- **INFO (unreachable, guarded)** — `composeSmsBody("", true)` returns
  `"\n\nReply STOP to opt out."` (leading blank line) while `bodyWithFooter("")` returns
  `""`, i.e. the two modules diverge on an EMPTY body. This is unreachable: the composer
  blocks a send when `smsBody.trim().length === 0` (compose.tsx:505-506,
  `missingFieldsLabel`), and an MMS with a photo but no text is likewise blocked (same
  guard requires "a message"). The empty preview also renders the empty-state, not a
  footer. No delivered SMS can hit this path. My parity test deliberately excludes the
  empty input and documents why. Not an ORCH-1289 regression (the "require a message"
  behaviour predates it). If a photo-only MMS (no text) is ever desired, the send-block
  and the empty-body footer divergence must be revisited together.

---

## Edge fn redeploy required: YES (STOP-newline wire change)

`supabase/functions/marketing-send` + shared `supabase/functions/_shared/adapters/smsAdapter.ts`
must be redeployed for the delivered marketing SMS footer to move to its own line
(Fix 3). Until redeploy, the composer PREVIEW shows the own-line footer but the DELIVERED
SMS keeps the old single-space footer. Transactional SMS senders are unaffected (flag
default-off). Operator handles deploy.
