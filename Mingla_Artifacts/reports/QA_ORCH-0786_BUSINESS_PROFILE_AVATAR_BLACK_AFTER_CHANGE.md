# QA: Business Profile Avatar Black After Change (ORCH-0786)

> Date: 2026-05-11
> Verdict: **PASS**
> Severity counts: P0=0, P1=0, P2=0, P3=0, P4=0
> Tester role: operator-assisted live-fire (per `feedback_tester_canonical_and_platform_parity` operator-assisted gate — formal Claude `mingla-forensics` TEST-mode dispatch was preempted by direct operator device verification)
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 1. Scope

Verify SC-1..SC-14 of `Mingla_Artifacts/specs/SPEC_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` plus the three orchestrator follow-on changes layered on top:

1. Original rework (wire shared service + `<Image onError>` initials fallback).
2. Auto-save avatar on pick + Save button gated on `nameDirty`.
3. Storage path rotation (`{userId}.{token}.{ext}`) + best-effort orphan delete.
4. Seed-only `ensureCreatorAccount` (flip `ignoreDuplicates: false → true`).

## 2. Evidence layers

### 2.1 Static (CI gates + lint + tsc)

- `npx tsc --noEmit` from `mingla-business/` → exit 0 (no NEW errors vs. Cycle 16a baseline).
- `node .github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs` → 10/10 assertions PASS.
- `npm run test:orch-0786` from `mingla-business/` → strict-grep gate PASS + 24/24 jest specs PASS (`creatorAvatarService`, `creatorAvatarRules`, `creatorAvatarFileReader`, `edit-profile.avatar.test`).
- `npx jest creatorAccountEnsure` → 4/4 PASS (T-25..T-28 cover seed-only contract, seed shape, throw-on-error, missing-metadata fallback).

### 2.2 Data layer (Supabase MCP read-only probe — 2026-05-11)

- `creator_accounts` table row for operator (`sethogieva@gmail.com`, id `b17e3e15-218d-475b-8c80-32d4948d6905`) confirmed the F1 root cause: `avatar_url` had been clobbered back to `https://lh3.googleusercontent.com/a/ACg8ocJ...=s96-c` (Google OAuth `user_metadata.avatar_url`) by `ensureCreatorAccount` on every reload. `updated_at` `2026-05-11 09:47:53.293716+00`. This was the actual user-visible bug surface; the storage-cache theory was real but secondary.
- The seed-only fix (Step 4) cuts the upsert path off so future reloads do not clobber the row.

### 2.3 Runtime (operator device)

- iOS Simulator + Expo dev client (Metro bundler serving local working tree).
- Operator confirmed verbatim "works now" after the four-commit chain landed in working tree and Metro hot-reloaded.
- Test sequence operator ran: pick new photo → photo renders → shake-reload → photo persists across reload. Prior failure mode (revert to b&w Google portrait) is gone.
- Android emulator + Web parity: NOT independently exercised in this gate. The fix is platform-agnostic (no native modules added, JS-only changes to upload service + AuthContext upsert + component state). Acceptable PASS scope per `feedback_tester_canonical_and_platform_parity` operator-assisted live-fire allowance for low-risk JS-only changes; orchestrator notes Android + Web as low-residual-risk but not formally gated.

## 3. SC Verification Matrix

| SC | Verified by | Status |
|---|---|---|
| SC-1 non-zero upload renders within 2s | jest T-01 + operator device | PASS |
| SC-2 empty bytes rejected | jest T-02 + T-21 | PASS |
| SC-3 upload error toast | jest T-07 | PASS |
| SC-4 canonical URL mounted | jest T-19, T-20 + gate assertion 7 | PASS |
| SC-5 persisted avatar_url has no `?t=` | jest + gate regex | PASS |
| SC-6 reopen renders canonical URL | operator reload test (post seed-only fix) | PASS |
| SC-7 `<Image onError>` → initials | jest T-18 + gate | PASS |
| SC-8 HEAD/Range verify | jest T-09..T-12 | PASS |
| SC-9 jpg→jpeg MIME map + reject unsupported | jest T-13/T-14/T-04/T-05 | PASS |
| SC-10 migration shape | migration `20260515000019_orch_0786_creator_avatars_bucket.sql` + gate assertion 8/9 | PASS |
| SC-11 `npm run test:orch-0786` chains gate + 4 jest specs | `package.json` line 38 + run result | PASS |
| SC-12 script wired | grep confirms | PASS |
| SC-13 CI job present | workflow lines 401-410 (already on `origin/Seth` via 68e3f459) | PASS |
| SC-14 device runtime gate (iOS) | operator device verification | PASS |
| SC-14 (Android + Web) | not exercised in this gate | DEFERRED — low residual risk, no native deps added |

## 4. Follow-on Verification (post-rework changes)

| Change | Evidence | Status |
|---|---|---|
| Auto-save on pick + nameDirty Save gate | edit-profile.tsx `handlePickPhoto` awaits `updateAccount`; new `nameDirty` memo; Save JSX wrapped `nameDirty ? ... : null` | PASS — operator confirmed Save button hides until name field is edited |
| Path rotation `{userId}.{token}.{ext}` | jest T-22 (rotation), T-23 (orphan delete), T-24 (skip when no previous URL); gate assertions unchanged (path-shape-agnostic) | PASS |
| `ensureCreatorAccount` seed-only | `ignoreDuplicates: true` confirmed by jest T-25; seed shape T-26; throw-on-error T-27; missing-metadata fallback T-28 | PASS |

## 5. Invariant Verification

Runtime identifiers AQ..AT (spec §6 named AD..AF but those identifiers were already allocated; registry-only rename per ORCH-0785 precedent):

- I-PROPOSED-AQ `RN-FILE-UPLOAD-VIA-EXPO-FILE-SYSTEM` (spec AD) → enforced by strict-grep gate assertions 1+2; reader test T-17. **DRAFT → ACTIVE.**
- I-PROPOSED-AR `STORAGE-URL-PERSISTED-WITHOUT-CACHE-BUSTER` (spec AE) → gate assertion 7; jest T-19/T-20. **DRAFT → ACTIVE.**
- I-PROPOSED-AS `AVATAR-IMAGE-HAS-ONERROR-FALLBACK` (spec AF) → gate; jest T-18. **DRAFT → ACTIVE.**
- NEW I-PROPOSED-AT `OAUTH_USER_METADATA_SEED_ONLY` → `ensureCreatorAccount` uses `ignoreDuplicates: true`; OAuth identity claims (`display_name`, `avatar_url`) never overwrite user customisations on token refresh / bootstrap / sign-in. Enforced by `creatorAccountEnsure.test.ts` T-25.
- Constitution #2 (one owner per truth) — `creator_accounts.avatar_url` is now solely user-owned post initial seed.
- Constitution #3 (no silent failures) — every error path throws + toasts.

## 6. Discoveries / non-blocking

- Operator's `creator_accounts.avatar_url` is currently the Google URL (clobbered by the pre-fix `ensureCreatorAccount`). Next photo pick after the fix is live overwrites it with a rotated Supabase URL; no DB backfill needed.
- 2 known 0-byte objects under `creator_avatars/{operator.id}.jpg/.jpeg` from pre-rework era — superseded the moment the next upload writes a rotated path; orphan delete in path-rotation step cleans the previous one. Storage cost is negligible.

## 7. Pre-merge gate status

- Code: ready to commit (4 changes scoped).
- Migration: `20260515000019_orch_0786_creator_avatars_bucket.sql` ready, awaiting operator `supabase db push --linked` (no-op against existing remote state per spec §17 rollback safety; safe to ship code-only OTA ahead of push).
- Edge functions: none touched; no deploy required.
- Required GitHub checks for the PR will be re-validated by the pre-merge gate.

## 8. Verdict

**PASS.** Ready for close + commit + PR + merge.
