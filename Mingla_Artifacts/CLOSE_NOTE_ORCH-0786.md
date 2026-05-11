# CLOSE NOTE — ORCH-0786

Date closed: 2026-05-11
Closed by: Claude `mingla-orchestrator` (operator delegated "take over" through implement → device verify → close)
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
PR: pending (this close opens it)

## Verdict

**PASS.** QA at `Mingla_Artifacts/reports/QA_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` returned PASS with zero P0/P1/P2/P3/P4 findings. All 14 SPEC success criteria verified — SC-14 device runtime gate confirmed by operator on iOS Simulator + Expo dev client ("works now" after the four-commit chain landed and Metro hot-reloaded).

## What shipped

The Business profile avatar flow is now end-to-end correct on every reload, not just the first session:

1. **Picker upload uses `expo-file-system`** instead of `fetch(uri).blob()` (which silently returned size-0 Blob on RN iOS). Shared service stack: `creatorAvatarRules.ts` + `creatorAvatarFileReader.ts` + `creatorAvatarService.ts`.
2. **`<Image onError>` fallback to initials** so unexpected render failure surfaces as readable initials + retry toast instead of a black tile.
3. **Auto-save on pick** — storage bytes and `creator_accounts.avatar_url` row commit together; "Photo updated." toast. Save button is reserved for name edits only, gated on `nameDirty`.
4. **Storage path rotation** — every upload writes to `{userId}.{token}.{ext}`. Each pick produces a fresh public URL string, so native iOS image cache cannot serve stale bytes on reload. Previous path is best-effort `.remove()`'d to keep orphans bounded.
5. **`ensureCreatorAccount` is seed-only** — `ignoreDuplicates: false → true`. OAuth identity claims (`display_name`, `avatar_url`) write once on initial seed and never again. AuthContext bootstrap and `onAuthStateChange` can no longer clobber a user-uploaded avatar back to Google's `lh3.googleusercontent.com` URL.

## Root cause (proven via Supabase MCP probe)

The user-visible failure mode was **`ensureCreatorAccount` upserting `user_metadata.avatar_url` (Google OAuth photo) on every reload**, overwriting the uploaded URL. Supabase MCP confirmed on 2026-05-11: operator's `creator_accounts.avatar_url` was `https://lh3.googleusercontent.com/a/ACg8ocJ...=s96-c` despite a successful upload moments before. The original investigation also surfaced the zero-byte upload (F1) and missing onError (F3), both correctly fixed; without the seed-only AuthContext fix the avatar bug would have persisted regardless.

## Files shipped

Code (one commit):
- `mingla-business/app/account/edit-profile.tsx` — handlePickPhoto rewrite + auto-save + nameDirty gate + `<Image onError>` + render-only cache-bust
- `mingla-business/src/utils/creatorAvatarRules.ts` (new) — MIME resolver, HEAD/Range verifier, path token generator, extractor
- `mingla-business/src/services/creatorAvatarFileReader.ts` (new) — `expo-file-system` byte reader
- `mingla-business/src/services/creatorAvatarService.ts` (new) — upload orchestration + path rotation + best-effort orphan delete
- `mingla-business/src/services/creatorAccount.ts` — seed-only upsert (`ignoreDuplicates: true`)
- 4 jest test files under `mingla-business/src/services/__tests__/` + `mingla-business/src/utils/__tests__/` + `mingla-business/app/account/__tests__/`
- `mingla-business/package.json` — `test:orch-0786` script
- `.github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs` (new, 10-assertion gate)
- `supabase/migrations/20260515000019_orch_0786_creator_avatars_bucket.sql` (re-add of out-of-band Cycle 14 bucket — idempotent against remote production state)

Artifacts (separate commit):
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
- `Mingla_Artifacts/CLOSE_NOTE_ORCH-0786.md` (this file)
- Journal-header updates to `PRIORITY_BOARD.md`, `MASTER_BUG_LIST.md`, `AGENT_HANDOFFS.md`, `OPEN_INVESTIGATIONS.md`, `INVARIANT_REGISTRY.md`, `DECISION_LOG.md`

Workflow registration of the gate was already committed in `68e3f459` (an out-of-scope sweep folded the ORCH-0786 workflow lines into the ORCH-0785 commit). The gate **script** is shipped in this close so CI can actually find the file the job references.

## Invariants — DRAFT → ACTIVE

SPEC §6 named these `I-PROPOSED-AD..AF` but those identifiers were already allocated (AD UNIVERSAL_SKILL_OUTPUT_FORMAT, AE STRIPE_REACT_NATIVE_NATIVE_BOUNDARY_ONLY, AF SUPABASE_AUTH_WEB_REDIRECT_ALLOWLIST_PER_SURFACE) so runtime identifiers are `AQ..AT` (registry-only correction, matching the ORCH-0785 precedent). Spec text is binding.

- **I-PROPOSED-AQ `RN-FILE-UPLOAD-VIA-EXPO-FILE-SYSTEM`** (spec named AD) — every RN picker-driven storage upload in `mingla-business/app/**` + `mingla-business/src/services/**` must read bytes via `expo-file-system`. `fetch(asset.uri).blob()` is forbidden. Enforced by ORCH-0786 strict-grep gate assertions 1+2.
- **I-PROPOSED-AR `STORAGE-URL-PERSISTED-WITHOUT-CACHE-BUSTER`** (spec named AE) — URLs persisted into Postgres columns must be canonical (no `?t=`/`?v=`/`?cb=` cache-bust). Cache-busting is render-time only. Enforced by gate assertion 7.
- **I-PROPOSED-AS `AVATAR-IMAGE-HAS-ONERROR-FALLBACK`** (spec named AF) — every avatar `<Image>` in `mingla-business/app/account/**` must have an `onError` handler. Enforced by gate.
- **I-PROPOSED-AT `OAUTH_USER_METADATA_SEED_ONLY`** (new, established at CLOSE after Supabase MCP probe surfaced the root cause) — `ensureCreatorAccount` writes OAuth identity claims (`display_name`, `avatar_url`) only on initial row seed (`INSERT ... ON CONFLICT DO NOTHING`). User customisations are never overwritten by `user_metadata` snapshots on token refresh / bootstrap / sign-in. Enforced by jest spec `creatorAccountEnsure.test.ts` T-25.

## Decisions logged

- **D-ORCH-0786-CLOSE-1** — Avatar storage path is `{userId}.{token}.{ext}` (Cycle 14 RLS predicate `split_part(name, '.', 1) = auth.uid()::text` still matches). Token = `Date.now().toString(36) + 6 random base36 chars`. No schema change, no RLS change.
- **D-ORCH-0786-CLOSE-2** — Avatar auto-saves on pick. Save button is name-only, gated on `nameDirty`. Matches Instagram/WhatsApp/Slack profile-photo idiom (pick == commit).
- **D-ORCH-0786-CLOSE-3** — `ensureCreatorAccount` is seed-only. Race-safe (`ignoreDuplicates: true` = `ON CONFLICT DO NOTHING`). OAuth identity is the source of truth only when no row exists.
- **D-ORCH-0786-CLOSE-4** — Workflow job entry was folded into commit `68e3f459` (ORCH-0785) out of scope. Documented but not re-litigated. Future cleanup ORCH may de-bundle if it becomes a problem.

## Deferred / non-blocking

- Android emulator + Web parity for SC-14 — not exercised in this gate. Fix is JS-only (no native modules); residual risk is low. If a regression appears on Android or Web, file a follow-on ORCH; not gating this close.
- Operator's `creator_accounts.avatar_url` is currently the Google URL (pre-fix clobber residue). Next photo pick after the fix is live overwrites with a rotated Supabase URL. No DB backfill needed.
- 2 known 0-byte objects under `creator_avatars/{operator.id}.jpg/.jpeg` from pre-rework. Orphan delete in path-rotation step will clean the most recent one on next pick; the older one is bounded storage cost, optional MCP cleanup.

## Deploy gates

- **Migration**: `supabase db push --linked` from operator. Migration is idempotent against the live remote state (bucket + 4 policies exist; this re-adds them as a source-of-truth file). Code-only OTA is safe ahead of push.
- **Edge functions**: none touched. No deploy.
- **EAS Update**: after merge, run `eas update --branch production --platform ios --message "ORCH-0786: business profile avatar fixed (full chain)"` then the `--platform android` variant. (Mingla Business uses the same EAS channel as the consumer app; if it has its own channel, swap `cd app-mobile` → `cd mingla-business` and adjust.)

## Next on the board

ORCH-0787 (order Refund + Cancel production-grade flow) is the next active item. Its investigation + spec + implementation already exist in `Mingla_Artifacts/reports/` and `Mingla_Artifacts/specs/` (uncommitted in working tree). It is a separate ORCH and a separate PR — out of scope for this close.
