# Cycle 0b — Web foundation: Expo Web auth + bundle

**Phase:** Phase 1 — Foundations
**Estimated effort:** ~32 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/` (Expo Web)

## Scope

Wire the same `mingla-business/` codebase to serve web (`business.mingla.com`) via Expo Web. Apple OAuth via Supabase OAuth-redirect on web (ID-token flow doesn't work in browser). GitHub Actions cron job rotates the Apple JWT every ~6 months.

## What shipped

- Expo Web bundle builds + deploys
- Web Apple OAuth (Supabase Sign in with Apple) wired
- Web Google OAuth wired
- `import.meta` shim handled (see `INVESTIGATION_WEB3_IMPORT_META.md`)
- GitHub Actions JWT auto-rotation cron (commit `9de9210d`)
- Discontinued the planned separate `mingla-web/` Next.js codebase per DEC-081 — web = mingla-business Expo Web only

## References

- Decision log: **DEC-081** (mingla-web discontinued — mingla-business serves web)
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_WEB3_IMPORT_META.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md`

## Closing notes

DEC-081 is the most important decision in this cycle: **there is no separate `mingla-web/` codebase**. Web parity = same React Native components rendered via Expo Web's `react-native-web`. If a feature uses a native-only library (NFC, native camera), document the platform gap and gate it.
