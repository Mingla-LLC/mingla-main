# CLOSE NOTE ORCH-0779 - Business Google Sign-In Android + Web Callback

## Verdict

ORCH-0779 is CLOSED PASS on 2026-05-11.

Plain-English outcome: Mingla Business organisers can sign in with Google on Android and production Web. The original Android `DEVELOPER_ERROR` path no longer reproduces, and the Web Safari invalid-address callback is fixed by Supabase Auth redirect configuration.

## Evidence

- Android runtime PASS: `.worktrees/orch-0779-business-android-google-signin-developer-error/Mingla_Artifacts/reports/QA_ORCH-0779_BUSINESS_ANDROID_GOOGLE_SIGNIN_DEVELOPER_ERROR.md` §11.
- Web authenticated-session PASS: same QA report §12.
- Forensic Web callback hypothesis: `.worktrees/orch-0779-business-android-google-signin-developer-error/Mingla_Artifacts/reports/FORENSIC_HYPOTHESIS_ORCH-0779_WEB_CALLBACK.md`.
- Supabase Auth project: `gqnoajqerqhnvulmnyvv`.
- Production deploy: `dpl_CPQgBkaXa5nTvVNsCgeAe1UVQ6M5`, aliased to `https://business.usemingla.com`.
- Git remote sync: commit `b7431fe1` pushed to `origin/Seth`.

## Fix Summary

Supabase Auth `site_url` was changed from `exp://*` to `https://business.usemingla.com`. The redirect allow-list was expanded to include the business production domain, wildcard production paths, Vercel production/preview URL patterns, and local Web development callback coverage while preserving prior entries for demo/admin/marketing/Expo/localhost surfaces.

The production Web deploy restored the ORCH-0778 Stripe web import gating needed for Vercel to build the current business bundle. That restoration is intentionally routed as a separate follow-up investigation, ORCH-0781, because the regression provenance and prevention gate must be proven separately from ORCH-0779's auth callback close.

## Scope

Closed:

- Mingla Business Android Google sign-in runtime path.
- Mingla Business production Web Google OAuth callback/session completion.

Out of scope:

- iOS parity retest, per QA §12.1.
- ORCH-0777 checkout live-fire/native PaymentSheet/backend notification work.
- ORCH-0778/ORCH-0781 Stripe web import provenance beyond restoring the production bundle.

## Close Hygiene

- `[ORCH-0779-DIAG]` marker reap returned zero matches in required code paths.
- DEC-138 logged the Supabase Auth web OAuth callback authority decision.
- `I-PROPOSED-AF SUPABASE_AUTH_WEB_REDIRECT_ALLOWLIST_PER_SURFACE` registered.
- Global artifacts updated: `WORLD_MAP.md`, `MASTER_BUG_LIST.md`, `PRIORITY_BOARD.md`, `AGENT_HANDOFFS.md`, `OPEN_INVESTIGATIONS.md`, `COVERAGE_MAP.md`, `PRODUCT_SNAPSHOT.md`, `ROOT_CAUSE_REGISTER.md`, `DECISION_LOG.md`, `INVARIANT_REGISTRY.md`, and `WORKTREE_REGISTRY.md`.

## Follow-Up

ORCH-0781 is registered for Claude `mingla-forensics` INVESTIGATE: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0781_CLEAN_TREE_STRIPE_WEB_IMPORT_GATE_REGRESSION.md`.

Git lock-in remains intentionally separate because the ORCH-0779 worktree still contains uncommitted scoped implementation/report files, while the main checkout currently contains unrelated ORCH-0777 dirty work in overlapping global artifacts.
