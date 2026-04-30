# Cycle 0a — Foundation: tokens, primitives, nav, auth

**Phase:** Phase 1 — Foundations
**Estimated effort:** ~40 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## Scope

Bootstrap the mingla-business Expo app: design tokens, glass primitives (GlassCard, Sheet, Modal, ConfirmDialog, IconChrome, Toast, etc.), 3-tab bottom navigation (Home / Events / Account), AuthScreen with Google + Apple OAuth, Mingla M monogram, 60-icon Icon library.

## What shipped

- Design tokens + glass primitives in `mingla-business/src/components/ui/` and `src/constants/designSystem.ts`
- 3-tab nav structure in `app/(tabs)/`
- Apple + Google OAuth via Supabase native ID-token flow on mobile
- Icon library (60+ names, see `Icon.tsx`)
- 4-layer glass treatment (L1 blur + L2 tint + L3 highlight + L4 hairline border) on every overlay primitive

## References

- Existing impl reports: `Mingla_Artifacts/reports/IMPLEMENTATION_*` (cycles 0a / sub-phases A–F)
- Decision log: DEC-070, DEC-072, DEC-076
- Invariant Registry: I-13 overlay-portal contract (established here)

## Closing notes

Cycle 0a is the bedrock. Every subsequent cycle reuses these primitives. If you find yourself wanting to write a new sheet/modal/card primitive, STOP — read DEC-079 (kit closure) first. Additive carve-outs go through Decision Log.
