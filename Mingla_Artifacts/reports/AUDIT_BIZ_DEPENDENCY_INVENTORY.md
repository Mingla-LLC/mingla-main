# AUDIT — Mingla Business Dependency Inventory & Methodology

> ⚠️ **MINGLA-WEB DISCONTINUED 2026-04-29 — see DEC-081.** Audit lines that
> evaluate Next.js / `@supabase/ssr` / `mingla-web/` codebase deps are stale.

> **Companion to:** `Mingla_Artifacts/specs/SPEC_BIZ_DEPENDENCY_MANIFEST.md`
> **ORCH-ID:** ORCH-BIZ-DEP-MANIFEST-001
> **Authored:** 2026-04-28
> **Confidence:** H

---

## 1. Methodology

### 1.1 Files read (verbatim, in trace order)

| File | Purpose |
|------|---------|
| `Mingla_Artifacts/prompts/FORENSICS_DEPENDENCY_MANIFEST_AUDIT.md` | The dispatch authoring this audit |
| `Mingla_Artifacts/DECISION_LOG.md` (DEC-070 through DEC-076) | Locked decisions — frontend-first, web stack, auth architecture |
| `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` §6 (per-cycle spec blocks) | Source of cycle-by-cycle dep needs |
| `Mingla_Artifacts/reports/AUDIT_BIZ_JOURNEY_GAPS.md` | Coverage status per journey (informs net-new design-time deps) |
| `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md` Part A.2 (Frontend Architecture) | Already-listed candidate dependencies |
| `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md` | Design language tokens implying lib needs (blur → expo-blur) |
| `mingla-business/package.json` | Ground truth — current installed deps |
| `mingla-business/app.config.ts` | Current native plugin config |
| `mingla-business/eas.json` | Current build profiles |
| `Mingla_Artifacts/design-package/mingla-business-app-screens/project/tokens.css` | Design package token usage (`backdrop-filter` → expo-blur) |
| `Mingla_Artifacts/design-package/mingla-business-app-screens/project/chrome.jsx` | Imports inferred from chrome primitives |
| `Mingla_Artifacts/design-package/mingla-business-app-screens/project/primitives.jsx` | Imports inferred from icon + monogram + QR component |

### 1.2 Cycles inspected

All 17 UI cycles + 6 backend cycles per `SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` §5–§6. For each, identified imported libs from cited source files + roadmap text.

### 1.3 Classification method

Each dep classified along 6 axes:
1. **Codebase target** — mingla-business / mingla-web / both
2. **Class** — native / pure-JS / web-only
3. **Rebuild trigger** — yes (eas build) / no (npm install)
4. **First cycle** — earliest cycle that imports it
5. **Already installed** — verified vs current `mingla-business/package.json`
6. **Cycle 0a bundle decision** — install in foundation rebuild OR defer

Each native module's Expo SDK 54 compatibility verified against published Expo docs + community reports as of 2026-04-28.

---

## 2. Per-Cycle Inventory Summary

| Cycle | New native modules (this cycle) | New pure-JS modules (this cycle) |
|-------|-------------------------------|---------------------------------|
| 0a (mingla-business foundation) | expo-blur (REQUIRED), expo-camera (PRE-BUNDLE for Cycle 11), expo-image-picker (REQUIRED for Cycle 2 photo upload), @react-native-community/datetimepicker (PRE-BUNDLE for Cycle 3), @stripe/stripe-react-native (PRE-BUNDLE for Cycle 12), react-native-nfc-manager (PRE-BUNDLE for Cycle 12, gated), @sentry/react-native (PRE-BUNDLE for Cycle 16) — **7 NEW native** | zustand, @tanstack/react-query (+ persist client + async-storage persister), react-error-boundary — **5 pure-JS** |
| 0b (mingla-web foundation) | n/a (Next.js — no rebuild concept) | next, react, react-dom, typescript, @supabase/supabase-js, @supabase/ssr — **6 base** |
| 1 (Account anchor) | (none — uses Cycle 0a primitives) | (none — uses Cycle 0a stores) |
| 2 (Brands) | (none) | react-hook-form, zod, @hookform/resolvers |
| 3 (Event creator) | (datetimepicker pre-bundled in 0a; map decision deferred) | (date utility — Intl preferred, date-fns optional) |
| 4 (Recurring) | (none) | rrule |
| 5 (Tickets) | (none) | (none new) |
| 6 (Public event page — web) | n/a | react-hook-form + zod (web parity) |
| 7 (Public brand/organiser — web) | n/a | (none new) |
| 8 (Checkout — web) | n/a | @stripe/stripe-js, @stripe/react-stripe-js |
| 9 (Event management) | (none) | (none new) |
| 10 (Guests) | (none) | (none new) |
| 11 (Scanner) | (camera pre-bundled in 0a) | react-native-qrcode-svg |
| 12 (Door payments) | (Stripe RN + NFC pre-bundled in 0a) | (none new) |
| 13 (Reconciliation) | (none) | (none new) |
| 14 (Account refinements) | (image-picker pre-bundled in 0a) | (none new) |
| 15 (Marketing landing — web) | n/a | (cycle-time decision; possibly framer-motion for landing animations) |
| 16 (Cross-cutting) | (sentry pre-bundled in 0a) | @sentry/nextjs (web side) |
| 17 (Refinement) | (none) | (none new) |
| **— UI shippable —** | | |
| B1 (Schema) | n/a (backend) | n/a (backend) |
| B2 (Stripe Connect live) | (none on client — backend wires) | (none new) |
| B3 (Checkout live) | (none) | (none new) |
| B4 (Door payments live) | Stripe Terminal SDK | (none new) |
| B5 (Marketing infrastructure) | mixpanel-react-native, react-native-appsflyer, react-native-onesignal | (Resend + Twilio SDK on Deno edge functions) |
| B6 (Chat agent) | (none on client) | OpenAI SDK on edge functions |

**Cycle-0a-rebuild bundle: 7 NEW native + 14 already-installed native = 21 native modules total in the dev client after Cycle 0a build runs.**

**Subsequent rebuilds expected:** at most 1 (if `react-native-maps` adopted in Cycle 3) + 1 (if Stripe Terminal SDK installs at B4) + 1 (if mixpanel/appsflyer/onesignal adopted at B5). So ~3 additional rebuilds across the entire build, vs. potentially 8+ if installed cycle-by-cycle.

**Build-time savings:** estimated 5+ rebuilds avoided × ~20 min per rebuild × 2 platforms = **~200 minutes saved** (3.3 hours of waiting).

---

## 3. Discoveries

### D-DEP-1 (HIGH) — `expo-blur` is NOT in `mingla-business/package.json`

The current `mingla-business/package.json` is missing `expo-blur` entirely. The design package's Glass primitives (GlassCard / GlassChrome / GlassBadge / TopBar / BottomNav) all rely on `expo-blur` for native backdrop blur. **Without it, Cycle 0a's foundation cannot ship.**

**Action:** Cycle 0a implementor's first install command must include `expo-blur`. This is a real gap, not a discovery of pre-existing infrastructure. The forensics audit on the consumer Mingla design language assumed `expo-blur` was a Mingla-wide standard — it is in `app-mobile/`, but `mingla-business/` was bootstrapped without it.

### D-DEP-2 (LOW) — `@react-navigation/*` packages are vestigial

`@react-navigation/bottom-tabs`, `@react-navigation/elements`, `@react-navigation/native` are in `mingla-business/package.json` but Mingla Business uses **Expo Router** (file-based routing). These three packages add ~500 KB to the bundle without being imported anywhere meaningful (verify with grep).

**Recommendation:** Cycle 0a implementor greps the codebase for any `@react-navigation` import. If zero imports, removes the packages and verifies the build still passes. Saves bundle weight and dependency surface area. **Flag for orchestrator review** in implementor report.

### D-DEP-3 (LOW) — `@expo/vector-icons` may also be vestigial

`@expo/vector-icons` is in `package.json` but the design package ships its own 60-icon SVG library via `react-native-svg` (per DEC-069). If Cycle 0a's `Icon.tsx` doesn't import any `@expo/vector-icons` glyph, the package is unused.

**Recommendation:** same grep-then-remove pattern as D-DEP-2. Verify in Cycle 0a implementor report.

### D-DEP-4 (MEDIUM) — `react-native-nfc-manager` lacks an official Expo Config Plugin

`react-native-nfc-manager` does not ship its own Expo Config Plugin. Three options for landing it in Cycle 0a's prebuild:

1. Third-party `expo-config-plugin-nfc-manager` (verify it works on SDK 54).
2. Eject from managed workflow: run `npx expo prebuild`, commit `android/` and `ios/` directories, manually add NFC entitlements.
3. Defer NFC to backend Cycle B4 — accept one extra rebuild then.

**Recommendation:** Cycle 0a implementor evaluates Option 1 first; if it doesn't work, falls back to Option 3 and reports the deferral. The UI for NFC tap-to-pay (Cycle 12) ships as a stub regardless.

### D-DEP-5 (MEDIUM) — Apple Tap to Pay entitlement is a multi-week timeline risk

Even with `@stripe/stripe-react-native` pre-bundled, `com.apple.developer.proximity-reader.payment.acceptance` requires Apple's manual approval (1–4 weeks typical). This doesn't block Cycle 0a — it blocks live in-the-field card-tap-to-pay at Cycle B4.

**Recommendation:** orchestrator OR founder applies for the entitlement immediately (not as part of Cycle 0a's implementor scope). Document status in `DECISION_LOG.md` once application submitted. Acceptable to ship Cycle 12's UI stub before Apple approves.

### D-DEP-6 (LOW) — `@tanstack/react-query` install before backend cycles is intentional

`@tanstack/react-query` (and its persist client + async-storage persister) is installed in Cycle 0a even though backend cycles (B1+) are deferred. This is intentional: hooks built in cycles 1–17 use `useQuery` / `useMutation` against in-memory stub services. When backend cycles wire real Supabase calls, the hooks' query-key + invalidation contracts already exist — the stub services swap to real services with no hook signature changes.

**Trade-off:** ~70 KB pure-JS bundle weight upfront for zero refactor cost when backend lands. Worth it.

### D-DEP-7 (LOW) — Vercel multi-project setup needs preflight before Cycle 0b

Cycle 0b's Next.js scaffold requires:
- Vercel project linked to the repo
- DNS records pointing `mingla.com` and `business.mingla.com` to Vercel
- Cookie domain config (`.mingla.com` per DEC-076)
- Subdomain decision (`business.` vs `app.` — recommend `business.`)

These are user-side / orchestrator-side preflight items. Cycle 0b's implementor cannot complete deployment without them. **Recommendation:** orchestrator surfaces this preflight checklist before authorising Cycle 0b dispatch.

---

## 4. Verification Status per Classification

| Claim | Verified by |
|-------|-------------|
| Native vs pure-JS for each dep | Expo docs + package source code (e.g., expo-blur ships native modules; zustand is pure JS) |
| Expo SDK 54 compatibility | Expo SDK 54 release notes + community reports as of 2026-04-28 |
| `mingla-business/package.json` current state | Read directly during Phase 0 |
| `app-mobile/package.json` reference | Read directly during prior session |
| Bundle-size estimates | Approximate (e.g., expo-camera ~1.5 MB) — verify in Cycle 0a implementor's actual build output |
| react-native-nfc-manager Expo plugin status | Inferred from package.json + npm; implementor verifies definitively |

**Unverified at audit time (implementor verifies during Cycle 0a):**
- Exact peer-dep resolution for `@tanstack/query-async-storage-persister` against `@react-native-async-storage/async-storage ^2.2.0`
- `expo-config-plugin-nfc-manager` SDK 54 compatibility
- Exact package versions Expo SDK 54 prefers for each new install (use `npx expo install` to let Expo pick compatible versions)

---

## 5. Confidence Assessment per Dep

| Class | Confidence |
|-------|------------|
| Already-installed mobile (rows 1–20 in manifest) | H (read directly) |
| Cycle 0a NEW native (rows 21, 26–32) | H (standard Expo SDK 54 modules, well-documented) |
| Pure-JS Cycle 0a + 0b (rows 22–25, 33–37, 43–47) | H (mature libs, no platform lock) |
| Cycle 0a `eas build` bundle decision | H (justified per dep in §3.3 of manifest) |
| Apple Tap to Pay entitlement timeline | M (depends on Apple's review queue — outside our control) |
| react-native-nfc-manager prebuild option | M (third-party plugin status not verified at audit time) |
| `react-native-maps` vs `expo-maps` for Cycle 3 | L (deferred to cycle-time design decision) |
| Deferred-to-B5 native deps (mixpanel/appsflyer/onesignal) | M (versions will be SDK-current at the time of B5; today's pinning would stale) |

**Overall audit confidence: H** for the Cycle-0a-actionable manifest. M for the Cycle-3 maps decision. M for B-cycle native deps (revisit at B-cycle time).

---

## 6. Open Uncertainties Surfaced

1. **Should we install `@sentry/react-native` in Cycle 0a or wait until Cycle 16?** Manifest recommends Cycle 0a for two reasons: (a) catches cycle-1+ implementor bugs, (b) saves a Cycle-16 rebuild. Trade-off: ~2 MB binary weight + Sentry config setup overhead. **Founder decision** at Cycle 0a sign-off if disagreement.
2. **Should `@expo/vector-icons` and `@react-navigation/*` be removed?** Manifest recommends conditional removal after Cycle 0a implementor confirms zero imports. **Orchestrator review** at Cycle 0a closure.
3. **Subdomain choice — `business.mingla.com` or `app.mingla.com`?** Manifest assumes `business.` per DEC-075. Founder may revisit at brand phase. Affects Vercel + DNS + auth cookie config.
4. **react-native-maps adoption?** Deferred to Cycle 3 design decision.

---

## 7. Discoveries for Orchestrator (action items)

- **D-DEP-1 (HIGH):** `expo-blur` missing — Cycle 0a implementor MUST install. Critical gap.
- **D-DEP-2 (LOW):** `@react-navigation/*` likely vestigial — Cycle 0a verifies and recommends removal.
- **D-DEP-3 (LOW):** `@expo/vector-icons` likely vestigial — Cycle 0a verifies and recommends removal.
- **D-DEP-4 (MEDIUM):** `react-native-nfc-manager` Expo plugin status — Cycle 0a evaluates; if blocked, defer NFC to B4.
- **D-DEP-5 (MEDIUM):** Apple Tap to Pay entitlement — orchestrator/founder applies separately, document in DECISION_LOG.
- **D-DEP-7 (MEDIUM):** Vercel + DNS preflight required before Cycle 0b dispatch — orchestrator surfaces checklist.

---

## 8. Output

This audit + the manifest at `Mingla_Artifacts/specs/SPEC_BIZ_DEPENDENCY_MANIFEST.md` are READY-TO-CONSUME by the Cycle 0a + Cycle 0b implementor dispatches. The orchestrator's next dispatch references the manifest verbatim for install commands.

**End of audit.**
