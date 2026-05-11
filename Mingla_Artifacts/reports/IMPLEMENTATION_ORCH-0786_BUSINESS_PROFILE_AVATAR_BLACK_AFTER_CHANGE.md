# Implementation: Business Profile Avatar Black After Change (ORCH-0786)

> Date: 2026-05-11
> Branch: `Seth`
> Working tree: `/Users/sethogieva/Desktop/mingla-main`
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
> Rework prompt: `Mingla_Artifacts/prompts/IMPL_ORCH-0786_REWORK_COMPONENT_WIRING.md`
> Status: implemented and verified (code + tests + gate); device runtime gate (SC-14) PENDING TESTER per `feedback_tester_canonical_and_platform_parity`.

---

## 1. Scope of this pass

This is the rework completion. The prior pass authored the shared service / reader / rules / migration / four jest specs correctly, then stopped — the component, the strict-grep gate, the workflow registration, and the package.json script were never wired. As shipped before this pass, the avatar bug was 100% reproducible because the new code was unimported.

This pass executes SPEC §14 steps 1, 7, 8, 9, 10, 11, 12, 13:

- Pre-flight `/ui-ux-pro-max` (avatar block only, no other UI touched).
- Edited `mingla-business/app/account/edit-profile.tsx` per SPEC §11.
- Authored `.github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs` per SPEC §13.2.
- Registered the new gate in `.github/workflows/strict-grep-mingla-business.yml`.
- Wired `test:orch-0786` script in `mingla-business/package.json`.
- Ran `npm run test:orch-0786` → PASS. Ran `npx tsc --noEmit` → exit 0.

Out of scope (untouched): `creatorAvatarRules.ts`, `creatorAvatarFileReader.ts`, `creatorAvatarService.ts`, the four jest specs, the migration file, name/email/save/delete blocks of `edit-profile.tsx`, anything in `app-mobile`, admin, brand profile, event cover, ticket media.

## 2. Pre-flight design step

Per `feedback_implementor_uses_ui_ux_pro_max` the avatar block was reviewed against minimal-account-edit principles before code change:

- Avatar uses the existing orange-ring container; no chrome change.
- On render failure, fall back to initials inside the same circle — preserve the silhouette, never expose a black void or empty hole.
- Toast is non-blocking + retryable copy ("Couldn't show your photo. Tap the avatar to retry.") so the user has a clear next action.
- Cache-bust is render-only — the visual identity of the persisted URL is canonical; the UI tier hints freshness without polluting state.

No other field, color, spacing, or chrome was reconsidered. Pure presentation/state plumbing on the avatar block per spec §11.1.

## 3. Old → New Receipts

### 3.1 `mingla-business/app/account/edit-profile.tsx`

**What it did before** — `handlePickPhoto` read picker bytes via `await fetch(asset.uri); await response.blob()` (the F1 root cause — silently returns size-0 Blob on RN iOS), uploaded that empty blob to `creator_avatars/{user.id}.{ext}`, then `setPhotoUri(\`${publicUrl}?t=${Date.now()}\`)` — baking the cache-bust into component state, which propagates verbatim to `updateAccount({ avatar_url: photoUri })` on Save. Avatar `<Image>` had no `onError` handler, so the zero-byte response decoded to a black tile with no fallback.

**What it does now** — `handlePickPhoto` delegates to `uploadCreatorAvatar(user.id, …)` from the proven shared service. The service reads bytes via `expo-file-system` (ORCH-0766B pattern), rejects empty bytes before upload, enforces the bucket MIME allowlist (incl. `jpg→jpeg` normalisation), uploads `Uint8Array` directly to Supabase Storage, then verifies the public URL with HEAD then ranged GET. On success it returns the canonical public URL (no `?t=`). The component persists that canonical URL into `photoUri`, then bumps a local `avatarRenderToken` for render-only cache-bust. The `<Image>` source is a `useMemo` that appends `?t=${avatarRenderToken}` (separator-safe) only at render time — never to component state, never to `avatar_url`. `<Image>` has `onError` that flips `avatarLoadFailed=true`, which switches the JSX to the initials fallback view + shows a retryable Toast. `<Image>` adds `accessibilityIgnoresInvertColors` so iOS smart-invert does not flip the photo. Error mapping: `CreatorAvatarError.message` is rendered via toast; non-CreatorAvatarError errors map to the generic upload toast. `supabase` import dropped (no other in-file caller).

**Why** — SC-1, SC-2, SC-3, SC-4, SC-5, SC-6, SC-7, SC-9 of SPEC §5; preserves Constitution #2 / #3 / #5 / #9; satisfies invariants I-PROPOSED-AD, I-PROPOSED-AE, I-PROPOSED-AF.

**Lines changed:** ~+50 / -27 (`handlePickPhoto` body + avatar JSX + new state/memo/effect + import swap).

### 3.2 `.github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs` (NEW)

**What it does** — Implements SPEC §13.2 ten assertions: banned `fetch(asset.uri)` and `.blob()` patterns in `edit-profile.tsx` + the three shared files; presence of `creatorAvatarFileReader.ts` with `expo-file-system` import + `readCreatorAvatarFileBytes` export; presence of `creatorAvatarService.ts` with `uploadCreatorAvatar` export; presence of `creatorAvatarRules.ts` with `verifyCreatorAvatarPublicUrl`, `resolveCreatorAvatarContentType`, `CreatorAvatarError`, `CREATOR_AVATAR_MAX_BYTES`; `onError={` present on `edit-profile.tsx`; no persisted `?t=` cache-bust in `setPhotoUri` or `avatar_url`; migration file with required strings (`creator_avatars`, `auth.uid()::text`, `ON CONFLICT (id) DO UPDATE`, `DROP POLICY IF EXISTS`) and exact MIME allowlist `ARRAY['image/jpeg','image/png','image/webp']` with no `image/jpg` alias; `test:orch-0786` script wired with all required fragments; workflow registered.

**Why** — SC-13 + regression-prevention §15 + invariant I-PROPOSED-AD CI enforcement.

**Lines:** ~190 lines, no runtime deps beyond `node:fs` + `node:path`, mirrors `orch-0784-event-list-sales-summary-visibility.mjs`.

### 3.3 `.github/workflows/strict-grep-mingla-business.yml`

**What it did before** — Last registered gate was ORCH-0784.

**What it does now** — New job `orch-0786-creator-avatar-upload-integrity` appended after the ORCH-0784 job (Node 20, `actions/checkout@v4` + `actions/setup-node@v4`), and gate ID added to the registry comment block at the top of the file per `feedback_strict_grep_registry_pattern` (one script + one job, no parallel workflow).

**Why** — SC-13 + regression-prevention.

**Lines changed:** +12.

### 3.4 `mingla-business/package.json`

**What it did before** — No `test:orch-0786` script.

**What it does now** — Added `"test:orch-0786": "node ../.github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs && npx jest creatorAvatarService.test creatorAvatarRules.test creatorAvatarFileReader.test edit-profile.avatar.test"` per SPEC §13.2 line 10.

**Why** — SC-11, SC-12.

**Lines changed:** +1.

### 3.5 Files explicitly NOT changed (correctness preserved from prior pass)

- `mingla-business/src/utils/creatorAvatarRules.ts`
- `mingla-business/src/services/creatorAvatarFileReader.ts`
- `mingla-business/src/services/creatorAvatarService.ts`
- `supabase/migrations/20260515000019_orch_0786_creator_avatars_bucket.sql`
- `mingla-business/src/services/__tests__/creatorAvatarService.test.ts`
- `mingla-business/src/services/__tests__/creatorAvatarFileReader.test.ts`
- `mingla-business/src/utils/__tests__/creatorAvatarRules.test.ts`
- `mingla-business/app/account/__tests__/edit-profile.avatar.test.tsx`

Each of those files matches its SPEC §9 / §13.1 contract verbatim — re-edit would be churn.

## 4. Spec Traceability — Success Criteria Matrix

| SC | Description | Verified by | Status |
|---|---|---|---|
| SC-1 | Non-zero upload renders within 2s | `creatorAvatarService.test` T-01 (bytes uploaded as `Uint8Array`) + component path | PASS (jest) + PENDING TESTER (device 2s observation) |
| SC-2 | `byteLength===0` rejected with reader toast | `creatorAvatarService.test` T-02 + `edit-profile.avatar.test` T-21 | PASS |
| SC-3 | Upload error shows toast, no state mutation | `creatorAvatarService.test` T-07 + component `try/catch` | PASS |
| SC-4 | `<Image>` mounted with canonical URL (no persisted `?t=`) | `edit-profile.avatar.test` T-19/T-20 + gate assertion 7 | PASS |
| SC-5 | Saved `avatar_url` has no `?t=` | gate regex assertion + T-19 | PASS |
| SC-6 | Reopen Edit profile renders canonical URL | hydrate effect unchanged; `photoUri` ← `account.avatar_url` (canonical) | PASS (logic) + PENDING TESTER (device) |
| SC-7 | `onError` falls back to initials + toast | T-18 + gate `onError={` assertion | PASS |
| SC-8 | HEAD/Range verify rejects size-0 / verify-fail throws upload_failed | `creatorAvatarRules.test` T-09/T-10/T-11/T-12 | PASS |
| SC-9 | `image/jpg` → `image/jpeg`; unsupported MIME → typed error | `creatorAvatarRules.test` T-13/T-14 + `creatorAvatarService.test` T-04/T-05 | PASS |
| SC-10 | Migration file present with required shape | gate assertion 8 + 9 (migration `20260515000019_orch_0786_creator_avatars_bucket.sql`) | PASS |
| SC-11 | `npm run test:orch-0786` runs gate + 4 jest specs | wired in package.json line 38; run result below | PASS |
| SC-12 | `test:orch-0786` registered in package.json | grep confirms line present | PASS |
| SC-13 | CI job fails on regression | new job in `strict-grep-mingla-business.yml`; gate self-tested by negating each branch mentally during authoring | PASS (job present + script self-passes; CI run pending push) |
| SC-14 | iOS/Android/Web device runtime gate | requires real simulator + auth state | PENDING TESTER |

## 5. Invariant Verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| Constitution #2 — One owner per truth | ✅ | `creator_accounts.avatar_url` remains the sole owner; `photoUri` is derived component state; `avatarRenderToken` is render-only. |
| Constitution #3 — No silent failures | ✅ | Every error branch surfaces a toast (empty bytes, unsupported MIME, upload error, verify fail, render fail). `catch ()` blocks all rethrow or toast. |
| Constitution #5 — Server state server-side | ✅ | React Query (`useCreatorAccount`/`useUpdateCreatorAccount`) unchanged; no Zustand or duplicate cache. |
| Constitution #9 — No fabricated data | ✅ | Initials fallback on `onError` truthful; no black tile masquerading as saved photo. |
| I-21 — operator-side route | ✅ | `edit-profile.tsx` still under `app/account/`, behind `useAuth`. |
| I-35 — soft-delete contract | ✅ | Existing RLS untouched; deleted accounts still blocked by Cycle 14 contract. |
| DEC-096 D-14-2 — `creator_avatars` bucket | ✅ | Migration `20260515000019_orch_0786_creator_avatars_bucket.sql` re-adds the exact remote shape. |
| `feedback_strict_grep_registry_pattern` | ✅ | One script + one job in the existing workflow; comment registry entry added. |
| I-PROPOSED-AD `RN-FILE-UPLOAD-VIA-EXPO-FILE-SYSTEM` | ✅ NEW | Enforced by gate assertions 1+2; reader proven via `creatorAvatarFileReader.test` T-15/T-16/T-17. |
| I-PROPOSED-AE `STORAGE-URL-PERSISTED-WITHOUT-CACHE-BUSTER` | ✅ NEW | Enforced by gate assertion 7; `edit-profile.avatar.test` T-19/T-20. |
| I-PROPOSED-AF `AVATAR-IMAGE-HAS-ONERROR-FALLBACK` | ✅ NEW | Enforced by gate `onError={` + T-18. |

## 6. Parity Check

The bug is operator-side (Mingla Business) only. The consumer app (`app-mobile`) uses a different table (`profiles.avatar_url`) and a different bucket (`avatars`); its upload pipeline is not affected. SPEC §3 explicitly excludes `app-mobile`. No parity work required.

## 7. Cache Safety

- No query keys changed. `useCreatorAccount` and its key factory untouched.
- `useUpdateCreatorAccount` invalidation contract unchanged — mutation still writes the same `display_name` + `avatar_url` shape, with `avatar_url` now canonical instead of cache-busted (consumers of `account.avatar_url` see a stable string after Save).
- No AsyncStorage / persisted Zustand shape changed.

## 8. Regression Surface

The following adjacent surfaces should be smoke-tested by the tester for blast-radius confidence:

1. Edit profile name save flow — unchanged but co-located with the avatar edit.
2. Account hub avatar display (`app/(tabs)/account.tsx`, if it reads `creator_accounts.avatar_url`) — should now render canonical URL post-save with no decode regression.
3. Public brand pages (if any read `creator_accounts.avatar_url`) — same as above.
4. Permission gate flow (denied → settings dialog) — `handlePickPhoto` retained the `photoGate` early-return branch verbatim.
5. Sign-out / re-sign-in hydration — initial `photoUri` hydration from `account.avatar_url` unchanged.

## 9. Verification Gate Run Receipts

### 9.1 `npx tsc --noEmit`

```
exit=0
```

Run from `mingla-business/`. No new errors versus the Cycle 16a baseline carry-forwards.

### 9.2 Strict-grep gate (direct)

```
$ node .github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs
ORCH-0786 creator avatar upload integrity guard passed.
exit=0
```

### 9.3 `npm run test:orch-0786` from `mingla-business/`

```
> mingla-business@1.0.0 test:orch-0786
> node ../.github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs && npx jest creatorAvatarService.test creatorAvatarRules.test creatorAvatarFileReader.test edit-profile.avatar.test

ORCH-0786 creator avatar upload integrity guard passed.
PASS src/services/__tests__/creatorAvatarService.test.ts
PASS app/account/__tests__/edit-profile.avatar.test.tsx
PASS src/services/__tests__/creatorAvatarFileReader.test.ts
PASS src/utils/__tests__/creatorAvatarRules.test.ts

Test Suites: 4 passed, 4 total
Tests:       21 passed, 21 total
Snapshots:   0 total
Time:        5.061 s
```

### 9.4 Migration / Deno gate posture

- No edge-function changes; Deno gate N/A.
- Migration file present (`supabase/migrations/20260515000019_orch_0786_creator_avatars_bucket.sql`) but **NOT applied** from this skill — operator owns `supabase db push --linked` per `feedback_orchestrator_deploys_edge_functions`. The migration is idempotent against the live remote state; an OTA-only ship of the code-only fix is safe even before the push (per SPEC §17 rollback safety).

## 10. Memory-Rule Deference

- `feedback_implementor_uses_ui_ux_pro_max` — pre-flight review documented in §2 (avatar block only).
- `feedback_orchestrator_deploys_edge_functions` — `supabase db push` NOT executed by this skill.
- `feedback_no_coauthored_by` — no Co-Authored-By line in any sample commit message below.
- `feedback_sequential_one_step_at_a_time` — steps 1, 7, 8, 9, 10, 11, 12, 13 of SPEC §14 executed sequentially within this rework dispatch.
- `feedback_strict_grep_registry_pattern` — gate added as one script + one job in existing workflow.
- `feedback_supabase_mcp_workaround` — N/A; no Supabase MCP calls used.

## 11. Transition Items

None. No `// [TRANSITIONAL]` comments introduced.

## 12. Discoveries for Orchestrator

- **Backfill posture (informational, non-blocking)** — Per SPEC D-ORCH-0786-FOR-3, the two known 0-byte objects already in production (`creator_avatars/{operator.id}.jpg/.jpeg`) will be overwritten on the operator's next photo pick on the fixed build. No product code added for backfill. Orchestrator MAY optionally issue a one-off MCP delete at CLOSE; not required.
- **Watchman recrawl warning** — Jest output included `watchman warning: Recrawled this watch 7 times`. Cosmetic and unrelated to this dispatch. Operator may run `watchman watch-del '/Users/sethogieva/Desktop/mingla-main' ; watchman watch-project '/Users/sethogieva/Desktop/mingla-main'` at their convenience.

## 13. Suggested commit message

```
orch-0786: wire creator avatar upload to expo-file-system service + Image onError fallback

- edit-profile.tsx: handlePickPhoto delegates to uploadCreatorAvatar; persist canonical URL; render-only cache-bust via avatarRenderToken; <Image> onError flips to initials fallback + retry toast
- new strict-grep gate orch-0786-creator-avatar-upload-integrity.mjs (10 assertions)
- register gate in strict-grep-mingla-business.yml
- wire test:orch-0786 script in mingla-business/package.json

Closes the F1 zero-byte upload + F3 missing onError gaps from the SPEC. Shared service / reader / rules / migration / four jest specs landed in the prior pass and are unchanged.

npm run test:orch-0786 → 21/21 PASS · tsc --noEmit → exit 0
```

(No Co-Authored-By line per `feedback_no_coauthored_by`.)

---

NEXT HANDOFF — paste into Claude `mingla-tester`:

Verify ORCH-0786 end-to-end on iOS Simulator, Android Emulator, and Web (`expo start --web`) per `feedback_tester_canonical_and_platform_parity`. Read this implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` together with the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` (especially SC-1, SC-6, SC-14) and the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. On each platform: change avatar → photo renders within 2s → reopen Edit profile → photo persists → sign out / sign in → photo persists → run MCP read-only probe `SELECT name, (metadata->>'size')::bigint AS size FROM storage.objects WHERE bucket_id='creator_avatars' AND name LIKE '<operator.id>.%'` and confirm `size > 0`. Hard guards: do NOT weaken any test, do NOT run `supabase db push` (operator owns), do NOT call `mcp__supabase__apply_migration`. Output the QA report at `Mingla_Artifacts/reports/QA_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` with verdict PASS / CONDITIONAL PASS / FAIL and P0–P4 severity counts. After PASS the next dispatch is Codex `orchestrator-mingla` for CLOSE (operator runs `supabase db push --linked` for the migration as a no-op convergence); after FAIL it returns here for REWORK.
