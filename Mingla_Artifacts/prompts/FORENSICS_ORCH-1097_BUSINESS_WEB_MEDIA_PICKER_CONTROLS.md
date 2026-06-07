# FORENSICS DISPATCH - ORCH-1097 Business Web Media Picker Controls

Target skill: Codex `forensic-mingla`.

Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1097-[business-web-media-picker-controls]` on branch `ORCH-1097-business-web-media-picker-controls`.

## Goal

Investigate and spec the next Mingla Business web completion slice after ORCH-1096: browser-safe media/file picker controls. The practical user goal is that phone browsers can use core business media workflows quickly and reliably, or see an explicit launch-approved degraded state, without importing native-only Expo modules into web boot or crashing the renderer.

## Required Inputs

Read these first:

1. `COMMS_LEDGER.md` from the anchor before any work.
2. `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`, especially P3D/P3E/P3K/P3N.
3. ORCH-1088, ORCH-1089, ORCH-1095, and ORCH-1096 investigation/spec/implementation/QA reports for boundaries already shipped.
4. Current source under `mingla-business/src/components/ui/CoverPicker.tsx`, `coverPickerFileInfo*`, brand/avatar picker components, experience stop photo components, activities/menu snap inputs, intake file inputs, group chat/media attachment surfaces if web-reachable, and all related services/hooks.
5. Existing CI guards: `mingla-business/scripts/ci/orch-1088-*`, `orch-1089-*`, `orch-1092-*`, `orch-1095-*`, `orch-1096-*`, plus `src/components/ui/__tests__/orch1001*`.

## Investigation Questions

1. Which media/file workflows are reachable from business web today on desktop and phone browsers?
2. Which ones already have real browser `File`/`Blob` behavior, which are intentionally degraded, and which are broken or native-only?
3. Which web routes/chunks still import `expo-image-picker`, `expo-file-system`, `expo-file-system/legacy`, `expo-document-picker`, haptics, native video trim/compression, camera, or keyboard-controller directly?
4. Does any current phone-browser route load the heavy Expo path only because a media picker module is imported at route/root time?
5. What should the durable contract be for local image upload, GIF/Pexels provider selection, video fallback, avatar crop, stop-photo multi-add, and snap/file ingestion?
6. What desktop web proof and physical phone-browser proof are required before calling this slice complete?

## Hard Guards

- Do not implement product code during forensics/spec.
- Do not change `web.output`, `asyncRoutes`, Vercel rewrites, auth callback, static Home, or phone preboot unless the spec explicitly proves a necessary bounded change and routes it back to orchestrator.
- Do not touch Supabase schema, edge functions, Stripe/Paystack, payout copy, buyer checkout, Ari, or admin unless current source proves a direct dependency.
- Preserve native Business iOS/Android behavior; web fixes must use platform splits or safe runtime branches.
- Preserve ORCH-1091 cache recovery, ORCH-1093 OOM route protection, ORCH-1095/1096 lightweight phone preboot routes, and provider-neutral seller copy.
- Per the regression habit, the spec must name repo-running tests that would fail before the fix and pass after it. Manual device gates may supplement but not replace source/export tests.

## Expected Outputs

Write both:

1. `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS.md`
2. `Mingla_Artifacts/specs/SPEC_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS.md`

The spec must include a scoped implementation plan, affected/not-in-scope surfaces, exact files/components, regression tests, desktop browser proof, Android Chrome proof, iPhone Safari/manual proof plan, and deploy discipline: PR title must include `[deploy]`; Vercel release only from merged `main`; no native OTA unless native code behavior changes.

Downstream routing: return to orchestrator review. Implementor dispatch is allowed only after the spec is reviewed and accepted.
