# TEST — META-ORCH-1161 Sub-B [marketing SMS blast send]

**Verdict:** PASS — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 2 P4. **CLEAR-TO-CLOSE.**
**Mode:** TARGETED + SPEC-COMPLIANCE (backend-only / edge-function + SQL + pure-util — source-only exemption per Phase 0.A; SMS is text-dark by design so true live-fire dispatch is intentionally impossible and not required).
**Branch:** `ORCH-1161-marketing-sms` · **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1161-[marketing-sms]/`
**Base for fails-on-revert:** HEAD `cafa3880e` (pre-tester-commit). Report-cited hashes `3aa7bcab8`/`e3c39b284`/`e4bb8e7ba` are stale (branch was rebased on origin/main); current branch commits `47fb9ab83` / `3fb047323` / `cafa3880e`. No content drift — verified by reading the live files.

Phase 0.A exemption rationale: every dispatch ask is backend logic (edge-fn kill-switch, audience SQL resolver, quiet-hours/segment pure functions, additive migration). The only UI surface (SMS compose card) is gated behind a text-dark kill-switch + the §8 legal sign-off, both operator-owned and out of this slice. Logic verified by Deno/Node execution + real-Postgres schema queries; no sim run applicable.

---

## 1. Comms ledger
Scanned `COMMS_LEDGER.md` Active entries. NO row targets `mingla-tester`, `ORCH-1161`, `META-ORCH-1161`, or the marketing/SMS surface; no BLOCK+OPEN to me. Relevant `ALL`/`WARN` rows (COMMS-0040/0041 RSVP+experience page standardization, 0027 OTA cache poison, 0030 iOS build) touch unrelated surfaces — read as FYI, no ack required, no cross-ORCH blast discovered from this slice (no new entry written).

---

## 2. SC-by-SC matrix

| SC | Item | Verdict | Evidence |
|---|---|---|---|
| SC-1 | `marketing-send` real SMS via smsAdapter, marketing SID + fallback, writes `marketing_messages(recipient_phone, channel='sms', status, provider_message_id, segments)`, keeps `MARKETING_SEND_LIVE_ENABLED`, per-market kill-switch, `rcs` still throws | PASS | `marketing-send/index.ts` `sendSms` L584-732; dispatcher switch L276-296 (`rcs`→`throw "rcs_not_yet_enabled"`); dual-gate (LIVE preview-skip L682 → adapter kill-switch L694). 13 dispatcher Deno tests pass. |
| SC-2 | `marketingAudience.ts` phone-suppression — `reachable_sms` checks `marketing_unsubscribes(contact_phone, ch∈sms/all)` AND `channel_suppressions(channel='sms', scope∈marketing/all)`; send filters on it | PASS | `resolveSuppressedPhones` L137-185 queries BOTH ledgers; `aggregate` excludes match from `reachable_sms` + `sms_marketing_ok` L373-377; send loop filters `c.sms_marketing_ok && raw_phone!==null` L618. Verified against real Postgres column set. |
| SC-3 | SMS tab enabled in composer, RCS disabled | PASS (source) | `ChannelTabs.tsx` SMS `enabled:true`; dispatcher `rcs` throws. Compose UI is text-dark; not sim-driven (gated behind kill-switch + §8). |
| SC-4 | Composer shows reachable_sms + segment/cost estimate (GSM-7 160 / UCS-2 70) before send | PASS | `smsCost.ts` exercised in Node: GSM-7 160=1seg/161=2seg; emoji→UCS-2; STOP footer not double-counted; zero-reach=0; empty=0seg. 9 jest tests pass. |
| SC-5 | Quiet hours — block outside 8a–9p US / 8a–8p WAT NG; TZ from country/area code; unknown → conservative-deny | PASS | `isWithinQuietHours` exercised in Node: US 7:30a=false/8:30a=true/8:30p=true/9:30p=false; NG 7:30p=true/8:30p=false; null + "GB" = false (deny). |
| SC-6 | Branded `/m/{tracking_id}` links (never public shortener) + migration monotonic | PASS | `rewriteSmsLinks` → `getTrackingRedirectOrigin()` = `.../functions/v1/marketing-track-click/{id}`; per-link `marketing_clicks` rows; track-click `utm_medium=sms`. Migration `20261111000000` > remote head `20261110000005` (real Postgres confirmed). |
| SC-7 | Throughput throttling — batch + pace (mirror email) | PASS (source) | `SMS_BATCH_SIZE=10` + `SMS_BATCH_PAUSE_MS=1100`; batched loop L626-729 with trailing-pause skip. |
| SC-8 | Deliverability — Twilio status → per-campaign undelivered + auto-suppress hard failures | PASS | `twilio-message-status` diff: reconcile by `provider_message_id`+`channel='sms'`, hard-codes {21610,30007,30034,30032,21211} → `channel_suppressions(scope='marketing', reason∈stop_keyword/twilio_blacklist)`; reasons match live CHECK; idempotent existence-guard. |
| SC-9 | Client audience mirror stays honest | PASS | `marketingAudienceService.aggregateBuyers` excludes `marketing_unsubscribes(contact_phone, sms/all)` L351-357,426; documents `channel_suppressions` RLS-own-only → conservative client preview, server authoritative. |

---

## 3. The 7 adversarial asks (evidence)

**1. TEXT-DARK kill-switch (most important) — PASS, zero-HTTP PROVEN.**
Two independent gates, defense-in-depth:
- `MARKETING_SEND_LIVE_ENABLED` (existing): `!options.live` → row marked `preview_skipped`, `continue` before any adapter call (`sendSms` L682-689; mirror of email L430).
- Per-market `SMS_LIVE_ENABLED_US/_NG` (Sub-A): enforced INSIDE `smsAdapter.send()` L168-176 — returns `{status:'skipped', error:'kill_switch_off:…'}` BEFORE `twilioSend()`/`fetch` (L181). The off-row is recorded `preview_skipped` (L718, honest, no silent drop).
Runtime proof: implementor's `smsAdapter.killswitch.test.ts` stubs `globalThis.fetch`, asserts `fetchCalls===0` when off / `===1` when on — PASS. Step 0.5 re-run: deleting the guard makes the off-test FAIL at L35 (status flips `skipped`→`failed`, fetch fires). My adversarial "both markets OFF across a 3-recipient batch with valid creds present" → ZERO HTTP. Both gates confirmed independent.

**2. Phone-suppression BOTH layers — PASS.**
Server `resolveSuppressedPhones` queries `marketing_unsubscribes(contact_phone, channel∈{sms,all})` AND `channel_suppressions(channel='sms', scope∈{marketing,all})`, normalizing to trimmed + digits-only keys (`phoneKeysOf`); `aggregate` drops matches from `reachable_sms` + `sms_marketing_ok`, and `sendSms` dispatches only `sms_marketing_ok` rows. Client mirror excludes the same `marketing_unsubscribes(contact_phone)` set; it cannot read `channel_suppressions` (RLS own-only) so the preview is a documented conservative estimate and the service-role server send is the authoritative gate. Both layers AGREE on the unsubscribe-ledger exclusion. Real Postgres confirmed both tables carry the queried columns (`marketing_unsubscribes.contact_phone`, `channel_suppressions.contact/channel/scope`).

**3. Scope isolation — PASS, PROVEN at schema level.**
Live `channel_suppressions.scope` CHECK = `('transactional','marketing','all')`. The marketing resolver reads only `scope IN ('marketing','all')` and the auto-suppress writeback writes only `scope='marketing'`. A marketing STOP therefore (a) never writes a `'transactional'` row and (b) is invisible to any transactional sender querying `'transactional'`/`'all'` — so a marketing STOP cannot kill booking confirmations, and a transactional-only suppression is invisible to the marketing path. Bidirectional isolation holds.

**4. Quiet hours — PASS.** US 8a–9p ET / NG 8a–8p WAT boundaries exact; unknown/unrecognized country → conservative DENY (defer). See SC-5. One documented approximation flagged P3 below.

**5. Cost/segment estimate — PASS.** `smsCost.ts` GSM-7 alphabet byte-identical to adapter; 160/153 vs 70/67; emoji flips to UCS-2 (verified: `'🎉'.length===2`, body→UCS-2); footer idempotent; zero-reach/empty→0.

**6. Branded links + migration — PASS.** `/m/{tracking_id}` via Supabase function origin (no public shortener); migration additive, idempotent (`ADD COLUMN IF NOT EXISTS`), prefix monotonic above the remote head (real-Postgres verified `20261110000005`; new = `20261111000000`). NOT yet applied (text-dark) — see Findings P3-adjacent / operator action.

**7. No regression — PASS.** Email dispatch path untouched (email Deno tests pass); `rcs` still throws (`dispatchByKind default-throw` test passes); tokenized unsubscribe (`signUnsubscribeToken`) + email audience path intact (`resolveBrandBuyers`/`resolveEventBuyers` unchanged for email). 13 dispatcher tests + full marketing jest suite green.

---

## 4. Step 0.5 — independent re-run of implementor's fails-on-revert
Ran the implementor proofs myself on branch HEAD `cafa3880e`:
- `smsAdapter.killswitch.test.ts` — 3 passed. Deleted the `if (!envTrue(killSwitch)) return skipped` guard in `smsAdapter.ts` → test FAILS at `smsAdapter.killswitch.test.ts:35` (`assertEquals(result.status,"skipped")`: Actual `failed` / Expected `skipped`), fetch fires. Restored → passes. **fails-on-revert CONFIRMED.**
- `marketingAudience.sms-suppression.test.ts` — 2 passed (independently exercises `aggregate` with a suppressed-phone set; reachable_sms=1 of 2). Clause-deletion fails-on-revert independently re-confirmed via my own test C below.
- jest `smsCost.test.ts` + `marketingAudienceService.smsSuppression.orch1161.test.ts` — 9 passed.

---

## 5. Adversarial test added (tester-owned, different angle)
**Path:** `supabase/functions/_shared/adapters/smsAdapter.partialbatch.test.ts` (commit on branch HEAD; in `git diff origin/main...HEAD --name-only`).
**Angles (none covered by the implementor):**
- (A) Mixed US+NG batch, only US enabled → NG `skipped` citing `SMS_LIVE_ENABLED_NG`, US `sent`, EXACTLY 1 Twilio HTTP across the batch (per-recipient kill-switch routing, not a global switch).
- (B) Both markets OFF across a 3-recipient batch WITH valid Twilio creds set → all `skipped`, ZERO HTTP (proves the gate is the switch, not missing creds — the live×kill-switch interaction).
- (C) Digits-only suppression key (`"15551110002"`, no `+`) in a 3-phone batch → suppresses EXACTLY the E.164 match, leaves the other two reachable (partial-batch normalization isolation).
**fails-on-revert verified at HEAD `cafa3880e`:** deleting the kill-switch guard → A+B FAIL (`:76`,`:115`); deleting the `!phoneSuppressed` clause in `aggregate()` → C FAILS (`:158`). Both product files restored clean (`git diff --stat` empty). All 3 PASS on restored code.
**Closing diff contains BOTH** the implementor happy-path tests AND this adversarial file (6 test files listed in §2 of the implement report + this one).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No new interactive tap verified at runtime (text-dark UI, out of scope). |
| 2 | One owner per truth | PASS | `smsAdapter` is the sole Twilio writer; `resolveSuppressedPhones` sole suppression resolver; client mirror documented as estimate, server authoritative. |
| 3 | No silent failures | PASS | Kill-switch skip + quiet-hours defer + Twilio failure all write honest `marketing_messages` rows (`preview_skipped`/`failed` + `failure_reason`); suppression-table query errors THROW (no silent degrade, L157/L178). |
| 4 | One query key per entity | N/A | No React Query keys touched. |
| 5 | Server state server-side | PASS | No Zustand/server-state in client mirror; pure aggregation. |
| 6 | Logout clears everything | N/A | No auth/session state. |
| 7 | `[TRANSITIONAL]` labelled | PASS | E.164-prefix country derivation + conservative-deny documented as interim pending DEC-186 country capture (report §11). |
| 8 | Subtract before adding | PASS | Phase-A `sms_not_yet_enabled` sentinel retired (L284), not left dangling. |
| 9 | No fabricated data | PASS | Cost labelled "Estimate only — metered by carrier"; quiet-hours unknown→deny (never guess); segment count approximation disclosed. |
| 10 | Currency-aware | PASS | `estimateSmsCost` cost rendered via `formatCurrency(..., brand.defaultCurrency, true)` (report §6). |
| 11 | One auth instance | PASS | `marketing-send` dual-path (service-role cron + `userClient` ownership) unchanged. |
| 12 | Validate at right time | PASS | Quiet-hours evaluated against recipient-local tz at send time (`now` per dispatch). |
| 13 | Exclusion consistency | PASS | Phone-suppression applied at reach computation AND send filter AND auto-suppress writeback — same scope semantics throughout. |
| 14 | Persisted-state startup | N/A | No hydration-gated state. |

No violations → no automatic P0.

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Backend (edge fns + SQL + migration) | PASS | Logic verified by Deno/Node execution + real-Postgres schema queries. |
| Business iOS | NOT SIM-DRIVEN (accepted) | SMS compose card ships text-dark behind kill-switch + §8 legal sign-off; no live dispatch possible by design; shared RN. |
| Business Android | NOT SIM-DRIVEN (accepted) | Auto via shared RN. |
| Business Web preview | NOT SIM-DRIVEN (accepted) | Report marks composer native-first (not a 1161 web deliverable). |
| Buyer/anon Web | N/A | No buyer-facing change. |
| Consumer iOS/Android | N/A | Push/in-app marketing leg is OUT of this slice. |
| Admin Web | N/A | No compose surface. |
| Physical iPhone (HITL) | NOT REQUESTED | SMS is text-dark; no on-device dispatch to verify. No operator-unblock needed. |

**Live edge-fn deploy state (read-only, current main — NOT this branch):** `marketing-send` v189 verify_jwt=true · `twilio-message-status` v228 verify_jwt=false · `marketing-track-click` v172 verify_jwt=**true**. The branch is undeployed (correct — deploys from MERGED main per the hazard runbook). See Discovery D-2: the report's operator-action #2 claims `marketing-track-click` should be verify_jwt=false but the LIVE value is true — confirm intent at deploy time.

---

## 8. Findings

### P3-1 — US quiet-hours anchored to Eastern; West-coast morning edge
**Evidence:** `marketing-send/index.ts` L562 `US: "America/New_York"`. A `+1` number is evaluated against Eastern regardless of the recipient's real timezone. The comment claims "conservative" but it is conservative only on the EVENING side (9PM ET cutoff = 6PM PT, safe). On the MORNING side a Pacific recipient at 8AM ET = **5AM PT** would pass the `>=8` gate and could be texted at 5AM local.
**Impact:** Potential pre-8AM-local marketing SMS to West-coast recipients — a TCPA-relevant edge IF SMS ever goes live.
**Why not a blocker:** (a) `orders` has no buyer-timezone column (documented limitation, report §11); (b) SMS is text-dark and will not go live until the §8 Go/No-Go + DEC-186 legal sign-off, both operator-owned and explicitly OUT of this slice; (c) the legal gate is the correct place to accept/mitigate this. Record for the §8 gate; do NOT flip `SMS_LIVE_ENABLED_*` without addressing recipient-tz precision or accepting this risk in DEC-186.
**Retest:** when a buyer-tz/area-code-precision source lands, assert a PT recipient is denied before 8AM PT.

### P4-1 — Migration must be applied before the SMS path can write
**Evidence:** real Postgres head = `20261110000005`; `marketing_messages.segments` is absent. `sendSms` inserts `{… segments}` (L664). Until `20261111000000` is applied, a live SMS INSERT would fail (`column "segments" does not exist`). Consistent with text-dark (migration is operator-action #1 before any send) — noting for sequencing, not a defect.
**Retest:** after `db push`, confirm `segments integer` exists; SMS insert succeeds.

### P4-2 — Append-only gate reads only HEAD commit body (process note for CLOSE)
**Evidence:** `marketing-send/index.test.ts` is a legitimately-approved modification (`[TEST-MOD-APPROVED ORCH-1161]`) carried in the implementor's commit. The gate reads only `log -1`; my tester commit became HEAD, so I carried the token forward in my commit body (gate re-passes, exit 0). When CLOSE squash-merges, ensure the squash commit body retains `[TEST-MOD-APPROVED ORCH-1161]` or the merge-commit append-only check could re-flag the deletion. Praise: clean, well-documented two-resolver mirror with explicit RLS-asymmetry honesty (client conservative / server authoritative) — a pattern worth replicating.

---

## 9. Discoveries for Orchestrator
- **D-1 (cross-channel coupling):** `marketing-send` returns 503 `resend_not_configured` when `LIVE && RESEND_API_KEY===''` (L114) BEFORE channel routing. An operator who flips `MARKETING_SEND_LIVE_ENABLED=true` to go live on SMS but has no Resend key would 503 the whole dispatcher (incl. SMS campaigns). Zero blast radius today (going live for SMS implies email already configured), but the gate is email-specific; a future SMS-only deployment should scope the 503 to email campaigns. Not in this slice's scope.
- **D-2 (deploy config):** live `marketing-track-click` is verify_jwt=true; report operator-action #2 says preserve "false". Public `/m/` redirect with verify_jwt=true would reject anon clicks unless the redirect path tolerates it — confirm the actual intended setting at deploy time (this is current-main state, not introduced by this branch).
- Both audience resolvers share the email-keyed-suppression bug shape; SMS side fixed here, email side already correct (implementor §12).

---

## 10. Routing
PASS → CLOSE (orchestrator). No accepted-conditions section (no P1/P2). Regression gate satisfied: implementor happy-path tests (fails-on-revert re-run @ `cafa3880e`) + tester adversarial test (`smsAdapter.partialbatch.test.ts`, different angle, on-branch, in-diff, fails-on-revert @ `cafa3880e`) both present.
