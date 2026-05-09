# Implementation Report: Business Public Domain and Share URL Authority Rework (ORCH-0759)

> Date: 2026-05-08  
> Mode: Rework  
> Spec: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`  
> Status: implemented and verified locally

## 1. Layman Summary

The two remaining organiser share buttons now use the real Mingla Business public URL builder, so they point at `https://business.usemingla.com/e/...` instead of the dead `business.mingla.com` host.

The strict domain gate was also hardened: active app/source code can no longer hide a bad public URL behind a "historical" allowlist comment. The ORCH-0759 test script now self-tests that exact failure shape before scanning the real codebase.

## 2. Request And Context

- **Request:** Fix tester P1 findings from `TEST_REPORT_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`.
- **Source:** User-dispatched `$implementor` against orchestrator rework prompt.
- **Affected surfaces:** Mingla Business Events tab share modal, Event Detail share modal, ORCH-0759 strict domain gate/test script.
- **Related issues/artifacts:** Investigation, spec, implementation report, and tester report for ORCH-0759.

## 3. Scope

- **In scope:** Replace active `business.mingla.com/e/...` share emitters; remove stale active-code allowlists; harden strict gate; add focused guard coverage; rerun ORCH-0759 gates.
- **Out of scope:** Public schedule fidelity, ticket-sync atomicity, paid checkout/order persistence, DB push, Vercel deploy, UI redesign.
- **Assumptions:** `business.usemingla.com` remains the canonical Mingla Business public host.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md` | Rework contract | Scope locked to two P1 findings. |
| `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md` | Failed tester evidence | Two active share surfaces and the strict gate were the blockers. |
| `mingla-business/app/(tabs)/events.tsx` | Events tab share source | Local hardcoded `business.mingla.com/e/...` helper remained. |
| `mingla-business/app/event/[id]/index.tsx` | Event detail share source | Local hardcoded `business.mingla.com/e/...` helper remained. |
| `mingla-business/src/constants/publicUrls.ts` | Canonical builder | `eventPublicUrl` encodes segments and uses `business.usemingla.com`. |
| `.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs` | Regression gate | Historical allowlist suppressed active runtime bad-domain emitters. |
| `mingla-business/package.json` | ORCH-0759 test script | Needed to run strict-gate self-test before the real scan. |

## 5. Blast Radius

- **Direct changes:** Events tab share URL, Event Detail share URL, strict-grep gate, `test:orch-0759` script.
- **Cascade changes:** No component API changes; existing `ShareModal` continues receiving a URL string.
- **Parity surfaces:** Business native/web JS only.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** None.
- **Deploy path:** Business app JS/web deploy after tester acceptance; no new migration or edge deploy.

## 6. Old To New Receipts

### `mingla-business/app/(tabs)/events.tsx`

- **Before:** Manage-share modal used a local helper that built `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}` and carried a stale historical allowlist comment.
- **After:** Share modal calls `eventPublicUrl({ brandSlug, eventSlug })`.
- **Why:** One public URL authority; no dead-domain organiser shares.

### `mingla-business/app/event/[id]/index.tsx`

- **Before:** Event Detail share modal used a local hardcoded `business.mingla.com/e/...` helper with the same stale allowlist.
- **After:** Share modal calls `eventPublicUrl({ brandSlug, eventSlug })`.
- **Why:** Event Detail share now matches the public event page and canonical builder contract.

### `.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs`

- **Before:** A nearby `platform-web-url-historical` allowlist comment could suppress active runtime bad-domain code.
- **After:** Active scan roots ignore that allowlist for forbidden runtime URL emitters and report the violation as hidden by an active-code historical allowlist. A `--self-test` mode proves this behavior and keeps test fixtures exempt.
- **Why:** Prevent another false-green domain regression.

### `mingla-business/package.json`

- **Before:** `test:orch-0759` ran the real strict scan and Jest tests.
- **After:** `test:orch-0759` first runs the strict-gate self-test, then the real scan, then Jest.
- **Why:** The exact P1-002 guard is now automated.

## 7. Implementation Details

- **Architecture decisions:** Reused `publicUrls.ts`; no new helper or domain constant.
- **Data flow:** Live event slugs flow directly into `eventPublicUrl`, which handles encoding and canonical origin.
- **Mutation/query behavior:** None changed.
- **State handling:** None changed.
- **Error handling:** `eventPublicUrl` remains fail-loud for missing slugs; no fallback to a guessed or dead URL was added.
- **Copy/accessibility:** No UI copy or layout changes.
- **Analytics/notifications/realtime:** Not touched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Events tab share uses `business.usemingla.com/e/...` via canonical builder | Yes | Source readback + `test:orch-0759` | Pass |
| Event Detail share uses `business.usemingla.com/e/...` via canonical builder | Yes | Source readback + `test:orch-0759` | Pass |
| No active app/src `https://business.mingla.com/e/` emitters | Yes | `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src` exit 1/no matches | Pass |
| Active historical allowlist removed from runtime emitters | Yes | Source readback | Pass |
| Strict gate fails active bad-domain code hidden by allowlist | Yes | `--self-test` in `test:orch-0759` | Pass |
| Existing ORCH-0759 tests remain green | Yes | 4 suites / 23 tests pass | Pass |
| TypeScript and web export pass | Yes | `tsc --noEmit`, `expo export -p web` | Pass |
| Classify tester P2s | Yes | This report section 14 | Pass |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One owner per public URL truth | Yes | Yes | Active share URLs now use `publicUrls.ts`. |
| No dead-domain regression | Yes | Yes | Strict gate self-test now covers false-green allowlist shape. |
| Subtract before adding | Yes | Yes | Removed local hardcoded helpers instead of adding another string path. |
| No fabricated data | Yes | Yes | No guessed slugs or fallback URLs added. |

## 10. Parity Check

- **Mobile:** Business native JS compiles; no device runtime was run.
- **Business app:** Events tab and Event Detail share sources fixed.
- **Admin:** Not touched.
- **Public/web:** Expo export passes.
- **Solo/collab:** N/A.
- **Gaps:** Runtime share-modal tapping still belongs to tester/manual QA after dispatch.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Unchanged.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Strict-gate self-test | `/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs --self-test` | PASS | Proves active bad-domain emitter with historical allowlist fails; test fixture remains exempt. |
| Real strict gate | `/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs` | PASS | Scanned 364 `.ts/.tsx` files, 0 violations, 0 read failures. |
| Active dead event URL sweep | `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src` | PASS | Exit 1/no matches. |
| ORCH-0759 test script | `cd mingla-business && /opt/homebrew/bin/npm run test:orch-0759` | PASS | 4 suites, 23 tests passed; Watchman recrawl warning only. |
| TypeScript | `cd mingla-business && /opt/homebrew/bin/npm exec -- tsc --noEmit` | PASS | Exit 0. |
| Expo web export | `cd mingla-business && /opt/homebrew/bin/npm exec -- expo export -p web` | PASS | Exported `dist`; Sentry config and Stripe ConnectJS SSR warnings only. |

Note: the shell PATH did not expose `node`/`npm`, so I used `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm`.

## 13. Regression Surface

1. Share modal URL generation: now depends on `eventPublicUrl` throwing for missing slugs. That is intended fail-loud behavior; existing live events should have server-backed slugs.
2. Strict-grep output: self-test intentionally prints one violation while still exiting 0 for the self-test command; this proves the failure path.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Public schedule fidelity | Unchanged tester P2: public mapper still drops schedule fields and may show `Date TBD`. | Follow-on ORCH or explicit launch deferral. | `publicEventsService.ts` |
| Publish ticket sync atomicity | Unchanged tester P2: sync is not transactional. | Follow-on transactional/upsert rework or accepted transitional risk with test. | `eventDrafts.ts` |
| Deployment | Static/code gates pass but production cold links are not smoked. | Operator DB push, business Vercel deploy, tester/runtime smoke. | Supabase + Vercel |

## 15. Discoveries For Orchestrator

- ORCH-0759 can now return to `$tester` for retest of P1-001/P1-002.
- The two tester P2 findings were not changed in this rework and should remain tracked before launch.

## 16. Deploy Notes

- **Migrations:** No new migration. Existing pending `20260515000003_orch_0759_public_event_contract.sql` still requires operator `supabase db push` before frontend deploy.
- **Edge functions:** None.
- **Mobile OTA/native:** JS-only changes; business native update path applies if shipping native.
- **Business/admin web:** Deploy Mingla Business web after tester acceptance and DB migration readiness.
- **Env vars/secrets:** No new env vars; `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` should remain `https://business.usemingla.com`.

## Suggested Commit Message

```text
fix(business): close public share URL rework

Resolves: ORCH-0759 rework
Evidence: npm run test:orch-0759; tsc --noEmit; expo export -p web
Deploy: DB push for existing ORCH-0759 migration before business web deploy
```

## Ready-To-Test Checklist

1. Open Events tab manage-share for a published event and confirm ShareModal URL is `https://business.usemingla.com/e/{brandSlug}/{eventSlug}`.
2. Open Event Detail share and confirm ShareModal URL is the same canonical event URL.
3. Re-run `npm run test:orch-0759` and confirm the self-test plus real scan pass.
4. After DB push and business deploy, smoke a cold public event URL on `business.usemingla.com`.
