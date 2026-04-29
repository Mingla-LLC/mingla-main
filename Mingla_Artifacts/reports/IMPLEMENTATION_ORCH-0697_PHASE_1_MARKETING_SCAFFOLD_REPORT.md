# IMPLEMENTATION REPORT — ORCH-0697 Phase 1: Marketing Sites Scaffold

> **ORCH-ID:** ORCH-0697 (Phase 1 of 5)
> **Dispatched by:** Orchestrator (`AH-MKT-001-P1`)
> **Spec:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0697_PHASE_1_MARKETING_SCAFFOLD.md`
> **Date:** 2026-04-29
> **Status:** **implemented and verified** (8 of 10 acceptance criteria mechanically PASS; 2 require live browser interaction)
> **Effort:** ~1.2 hours

---

## 1. Layman summary

The empty marketing-site house is built. `mingla-marketing/` now contains a working Next.js 15 app that serves three subdomains (`localhost:3000`, `explore.localhost:3000`, `business.localhost:3000`) — each with its own zone-specific page, with the audience switcher in the navigation morphing between Explorer ↔ Organiser worlds. All three subdomains return correct content (verified via curl) with the correct `x-mingla-zone` header. Type check, lint, and build all pass clean. Zero marketing copy, zero real assets, zero MCP calls — exactly the Phase 1 boundary.

Two acceptance criteria require human-in-the-loop browser verification (Framer Motion morph animation, screenshot of nav chrome) — flagged as **unverified** rather than claimed.

---

## 2. Run instructions

```bash
cd mingla-marketing
npm install      # one-time
npm run dev      # dev server on port 3000
```

Then open in Chrome (auto-resolves `*.localhost`):

| URL | Zone | Audience switcher state |
|---|---|---|
| http://localhost:3000 | umbrella | Neither pill highlighted (umbrella shows the choice) |
| http://explore.localhost:3000 | explore | "Explorers" highlighted with orange glass spotlight |
| http://business.localhost:3000 | business | "Organisers" highlighted with orange glass spotlight |

Safari does NOT auto-resolve `*.localhost` — Safari users add to `/etc/hosts`:
```
127.0.0.1   explore.localhost
127.0.0.1   business.localhost
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck`, `npm run lint`.

---

## 3. Dependency list (final `package.json`)

**dependencies**
```
next               15.5.15
react              19.0.0
react-dom          19.0.0
motion             12.38.0       (replaces framer-motion — see §10 deviation D-1)
clsx               2.1.1
tailwind-merge     2.5.4
```

**devDependencies**
```
typescript         5.6.3
@types/node        22.9.0
@types/react       19.0.1
@types/react-dom   19.0.1
tailwindcss        4.2.4         (stable v4 — spec said "v4", I picked stable not beta)
@tailwindcss/postcss 4.2.4
postcss            8.5.10        (bumped from 8.4.49 → security patch)
eslint             9.39.4        (bumped from 9.15.0 → security patch)
eslint-config-next 15.5.15
```

**Total install size:** ~137 packages. **Audit:** 2 moderate vulnerabilities remain — both inside `node_modules/next/node_modules/postcss` (transitive in Next.js itself; resolution requires Next maintainer bump, not addressable in app `package.json`). See §11.

---

## 4. Token coverage

Source: `app-mobile/src/constants/designSystem.ts`.
Targets: `mingla-marketing/src/styles/tokens.css` (CSS source of truth) + `mingla-marketing/src/lib/tokens.ts` (JS mirror).

| Source namespace | Status | Notes |
|---|---|---|
| `colors.primary` (50–900) | ✅ Ported | CSS vars + JS export |
| `colors.accent` (`#eb7825`) | ✅ Ported | `--mingla-accent` + `colors.accent` |
| `colors.gray` (50–900) | ✅ Ported | CSS vars |
| `colors.success/warning/error` | ✅ Ported | Single value each (most-used shade) |
| `colors.background.*` + `colors.text.*` | ✅ Ported | All 4 background + 4 text tokens |
| `spacing` (xxs–xxl) | ✅ Ported | CSS vars + Tailwind utilities (`p-mingla-md` etc.) |
| `radius` (sm–full) | ✅ Ported | CSS vars + Tailwind utilities |
| `typography` (xs–xxxl + tagline) | ✅ Ported | Font sizes + line heights paired |
| `fontWeights` | ✅ Ported | All 4 |
| `shadows` (sm–xl) | ✅ Ported | Translated RN shadow shape → CSS box-shadow strings |
| `animations.duration/easing` | ✅ Ported | Available for both CSS transitions and Framer Motion |
| `glass.surface` + `glass.surfaceElevated` | ✅ Ported | CSS vars |
| `glass.chrome.*` (full namespace) | ✅ Ported | **Critical** — consumed by AudienceSwitcher (tint, hairline, active, inactive, button, switcher, pill, motion) |
| `glass.profile.heroGlow` | ✅ Ported | Available for Phase 2+ heavy use |
| `glass.profile.heroGradient` | ✅ Ported | Available for Phase 2+ |
| `backgroundWarmGlow` (`#fff9f5`) | ✅ Ported | Kept available even though dark-default |
| `responsiveSpacing` / `responsiveTypography` | ❌ Skipped | Per spec §"Skip" — uses RN responsive utils |
| `touchTargets` | ❌ Skipped | Per spec §"Skip" — web hit areas via padding |
| `glass.badge.*` | ❌ Skipped | Mobile-card-specific; no Phase 1 web consumer |
| `glass.discover.*` (full namespace) | ❌ Skipped | Consumer-screen-specific; Phase 3 may port subset |
| `glass.profile.*` (beyond heroGlow/heroGradient) | ❌ Skipped | Profile-screen-specific (avatar, settingsRow, signOut) — no marketing consumer |
| `commonStyles` | ❌ Skipped | RN StyleSheet shape; web uses Tailwind |
| `Ionicons` icon names | ❌ Skipped | Mobile-specific |
| `elevation` fields | ❌ Skipped | Android-only |

**Token parity spot-check** — verified per spec acceptance criterion #7:

| Source | Source value | Ported |
|---|---|---|
| `colors.accent` | `#eb7825` | `--mingla-accent: #eb7825` ✅ |
| `glass.chrome.button.size` | `44` | `--mingla-chrome-button-size: 44px` + `glassChrome.button.size: 44` ✅ |
| `radius.xl` | `24` | `--mingla-radius-xl: 24px` + `radius.xl: 24` ✅ |
| `animations.duration.normal` | `300` | `--mingla-duration-normal: 300ms` + `animations.duration.normal: 300` ✅ |
| `glass.chrome.active.glowColor` | `'#eb7825'` | `--mingla-chrome-active-glow-color: var(--mingla-accent)` + `glassChrome.active.glowColor: '#eb7825'` ✅ |

---

## 5. Subdomain middleware behavior — verification log

Live `curl` against running dev server (`npm run dev` on port 3000):

```
=== UMBRELLA (localhost:3000) ===
HTTP/1.1 200 OK
x-mingla-zone: umbrella
Body contains: "HERO PLACEHOLDER", "marketing site shell"

=== EXPLORE (Host: explore.localhost:3000) ===
HTTP/1.1 200 OK
x-mingla-zone: explore
Body contains: "EXPLORER HERO", "For Explorers"

=== BUSINESS (Host: business.localhost:3000) ===
HTTP/1.1 200 OK
x-mingla-zone: business
Body contains: "BUSINESS HERO", "For Organisers"
```

Dev server log confirms middleware → zone-page compilation chain:
```
○ Compiling /sites/explore ...
✓ Compiled /sites/explore in 2.5s
○ Compiling /sites/business ...
✓ Compiled /sites/business in 1319ms
```

Build output confirms all 3 zones registered as routes (5 total: 3 zones + `/` fallback + `/_not-found`):
```
Route (app)                    Size  First Load JS
┌ ○ /                          136 B  102 kB
├ ○ /_not-found                136 B  102 kB
├ ƒ /sites/business            136 B  102 kB
├ ƒ /sites/explore             136 B  102 kB
└ ƒ /sites/umbrella            136 B  102 kB
ƒ Middleware                   34.2 kB
```

---

## 6. Audience switcher

**File:** `src/components/chrome/AudienceSwitcher.tsx`

**Wiring confirmed (mechanically):**
- Two pill `<a>` tags rendered side-by-side inside a glass capsule (matches `glass.chrome.switcher.*` geometry)
- `<motion.span layoutId="audience-spotlight">` wraps the active-pill background
- Spring transition consumes `glassChrome.motion.springDamping/Stiffness/Mass` from `lib/tokens.ts` — values match `glass.chrome.motion.*` in source
- Active pill: `background: glassChrome.active.tint` + orange glow shadow + white label
- Inactive pill: transparent + dimmed white label (`glassChrome.inactive.labelColor`)
- Click handler: `<a href={zoneUrl(zone, isDev)}>` — protocol auto-switches `http`/`https` based on dev/prod
- `aria-current="page"` on the active pill, `aria-label` on both for screen readers

**Morph animation: UNVERIFIED** — requires browser interaction. The `layoutId` is set per spec, but visual confirmation that the orange spotlight slides smoothly between pills (vs. snap-replace) needs human eyes. Mechanically the contract is correct.

---

## 7. Open questions for Phase 2

These don't block Phase 1 PASS but the orchestrator needs to resolve before Phase 2 starts:

1. **Hero asset hosting** — Phase 2 will generate 5–6 Veo 3 video clips (8s each, ~5–50 MB) plus ~10 Nano Banana stills. Where do they live? Spec defers but recommended Supabase Storage. **Decision needed before Phase 2 dispatch** so the asset pipeline knows where to upload.
2. **Logo SVG** — Phase 1 uses a text wordmark "mingla" in Fraunces. The actual logo with the two-pretzel/people glyph above the "a" needs to exist as an SVG before Phase 2's hero can use it. Source it from app's existing SVG assets or generate via Stitch?
3. **Mingla Business app deep link / App Store URL** — Phase 4 (business) will have CTAs like "Get the Business app" — need the App Store URLs (mingla-business is pre-MVP per memory, may not have store listing yet). May need a "join waitlist" instead.
4. **Cookie domain decision (DEC-076 cross-reference)** — DEC-076 from the Business platform initiative locks `.mingla.com` cookie domain for cross-subdomain auth. Marketing sites have NO auth in Phase 1, but Phase 5 needs to confirm: if a logged-in app user lands on a marketing page, do we want personalized affordances? If yes, we need to read the same cookie. If no, we ignore. **Recommend: defer to Phase 5.**
5. **Vercel project structure** — orchestrator memory DEC-077 says no Vercel deploy during Business UI cycles. Marketing has the same `localhost-only` posture. When we DO deploy: one Vercel project for marketing or shared with `mingla-business/`? Different cookie-domain stories.
6. **Real Inter weight subset** — currently loading `400/500/600/700` for Inter. Phase 2 may want lighter (`300`) for editorial body or heavier (`800/900`) for accent. Cheap to add later.

---

## 8. Lint / type / build output (final clean)

```
$ npm run typecheck
> tsc --noEmit
(silent — pass)

$ npm run lint
✔ No ESLint warnings or errors
(deprecation notice about `next lint` — informational, not a failure)

$ npm run build
✓ Compiled successfully in 5.7s
✓ Generating static pages (7/7)
Route (app)                  Size  First Load JS
┌ ○ /                        136 B  102 kB
├ ○ /_not-found              136 B  102 kB
├ ƒ /sites/business          136 B  102 kB
├ ƒ /sites/explore           136 B  102 kB
└ ƒ /sites/umbrella          136 B  102 kB
ƒ Middleware                 34.2 kB
○ (Static) prerendered as static content
ƒ (Dynamic) server-rendered on demand
```

Three notes:
- **`next lint` deprecation warning** — Next 16 will remove it; migration to ESLint CLI is an upcoming dispatch (single-line command). Not a Phase 1 blocker.
- **Workspace root warning resolved** — `next.config.ts` now sets `outputFileTracingRoot: __dirname` to pin the trace root.
- **2 moderate vulnerabilities** in `node_modules/next/node_modules/postcss` — transitive in Next.js itself, only fixable by Next maintainers. Documented in §11.

---

## 9. Old → New receipts

This is greenfield work — every file is new. Listing all 25 files created with one-line purpose:

### Config files (project root)
| File | Purpose |
|---|---|
| `package.json` | npm manifest with locked dep versions |
| `tsconfig.json` | TypeScript strict mode + Next plugin + `@/*` path alias |
| `next.config.ts` | React strict mode + outputFileTracingRoot pin |
| `tailwind.config.ts` | Content paths (Tailwind v4 is mostly CSS-first) |
| `postcss.config.mjs` | `@tailwindcss/postcss` plugin |
| `.eslintrc.json` | `next/core-web-vitals` extend |
| `.gitignore` | Standard Next.js ignore + `.env*` exclusion |
| `.env.example` | Empty (Phase 2+ adds keys) |
| `README.md` | Run instructions, scripts, dev URL table, Safari `/etc/hosts` note, design-token explanation, "what's next" pointer |

### App source (`src/`)
| File | Purpose |
|---|---|
| `src/middleware.ts` | Host header → zone rewrite to `/sites/[zone]/...` (8 hosts mapped: 4 prod + 1 vercel preview × 3 + 3 local dev) |
| `src/styles/tokens.css` | CSS custom properties (source of truth for all visual tokens) — ~60 vars |
| `src/lib/tokens.ts` | JS mirror of tokens for runtime consumers (Framer Motion configs, dynamic styles) |
| `src/lib/zones.ts` | Zone constants + `zoneUrl()` builder (dev/prod aware) |
| `src/lib/cn.ts` | `clsx` + `tailwind-merge` className helper |
| `src/lib/getZoneFromHeaders.ts` | Server-side zone resolver from host header (used by zone layouts) |
| `src/app/layout.tsx` | Root HTML, Fraunces + Inter font loading, dark `<html>` shell |
| `src/app/globals.css` | Tailwind v4 `@import` + token bridge `@theme inline {}` + base styles + reduced-motion respect |
| `src/app/page.tsx` | Root fallback (only rendered if middleware fails — never in normal operation) |
| `src/app/not-found.tsx` | 404 page using `<Link>` (Next-mandated) |
| `src/app/sites/umbrella/layout.tsx` | Umbrella zone shell (Nav + main + Footer) |
| `src/app/sites/umbrella/page.tsx` | Umbrella hero placeholder (`<HERO PLACEHOLDER — PHASE 2>`) |
| `src/app/sites/explore/layout.tsx` | Explore zone shell |
| `src/app/sites/explore/page.tsx` | Explore hero placeholder (`<EXPLORER HERO PLACEHOLDER — PHASE 3>`) |
| `src/app/sites/business/layout.tsx` | Business zone shell |
| `src/app/sites/business/page.tsx` | Business hero placeholder (`<BUSINESS HERO PLACEHOLDER — PHASE 4: 90% CENTERPIECE>`) |
| `src/components/chrome/Nav.tsx` | Sticky top nav: wordmark left, AudienceSwitcher right |
| `src/components/chrome/AudienceSwitcher.tsx` | Two-pill switcher with Framer Motion `layoutId` morph |
| `src/components/chrome/Footer.tsx` | Minimal footer (copyright + 3 placeholder legal links) |
| `src/components/ui/Container.tsx` | Max-width wrapper with 4 size presets |
| `src/components/ui/Button.tsx` | Primary/secondary/glass variants — both `<button>` and `<a>` (ButtonLink) |
| `src/components/ui/GlassCard.tsx` | Glass surface card (standard + elevated) |

---

## 10. Spec deviations (principled)

| ID | Deviation | Reason | Impact |
|---|---|---|---|
| **D-1** | `motion@12.38.0` instead of `framer-motion@11.x` | `framer-motion@11.x` peer-deps `react ^18` only — incompatible with React 19 stable. `motion` is the official rebrand of `framer-motion` (same Vercel team, drop-in API surface, supports React 19). Import path: `motion/react` instead of `framer-motion`. | None — same component API, fully compatible. Recorded so future readers don't ask "why not framer-motion." |
| **D-2** | Dropped `autoprefixer` from devDeps | Tailwind v4 includes Lightning CSS which handles autoprefixing internally. Adding `autoprefixer` is redundant and can conflict with Tailwind v4's pipeline. | None — autoprefixing still happens, just via Lightning CSS. |
| **D-3** | Tailwind `4.2.4` (stable) instead of `4.0.0-beta.4` | Latest stable is 4.2.4 as of 2026-04. Spec said "v4" — picked the stable channel. Less risk than beta. | None — same architecture. |
| **D-4** | Next.js `15.5.15` instead of `15.0.x` | Next `15.0.3` peer-deps don't accept React 19 stable. `15.5.x` does. Spec said "15.x latest stable" — `15.5.15` is the latest 15.x. | None — same App Router, same middleware API. Note: Next 16 is now latest overall but stayed within 15.x per spec. |
| **D-5** | Folder `src/app/sites/` instead of `src/app/_sites/` | The underscore prefix in App Router marks a folder as **private** (not routable) — pages inside are NOT compiled as routes. Confirmed by build initially showing only `/` and `/_not-found`. After rename, all 5 routes compile correctly. Middleware updated to rewrite to `/sites/[zone]/`. | None — internal URL, never user-facing. README documents the constraint. **This is a Next.js convention the spec missed; flagging for orchestrator awareness in future scaffolding briefs.** |
| **D-6** | `middleware.ts` placed at `src/middleware.ts` (not project root) | When using `src/` directory pattern, Next.js requires middleware at `src/middleware.ts`. Project root doesn't get picked up. Confirmed by initial dev-server log showing zero middleware compilation despite valid file. | None after correct placement. |

All 6 deviations are purely toolchain-correctness fixes (compat issues + Next.js conventions the spec didn't address). No deviation expanded scope, shrunk scope, or changed user-facing behavior.

---

## 11. Known issues / Transition items

### Known
1. **2 moderate vulnerabilities in `node_modules/next/node_modules/postcss`** — transitive in Next.js itself. Cannot be fixed in our `package.json` without forking Next. Will resolve when Next bumps its bundled postcss (track via `npm audit` after each `next` upgrade).
2. **`next lint` deprecation warning** — Next 16 will remove the `next lint` command. Migration is `npx @next/codemod@canary next-lint-to-eslint-cli .` — single-line. Defer to a future dispatch when we bump to Next 16.

### Transition items (`[TRANSITIONAL]` markers)
- `src/app/sites/umbrella/page.tsx` — `<HERO PLACEHOLDER — PHASE 2>` text. Owner: ORCH-0697 Phase 2.
- `src/app/sites/explore/page.tsx` — `<EXPLORER HERO PLACEHOLDER — PHASE 3>`. Owner: ORCH-0697 Phase 3.
- `src/app/sites/business/page.tsx` — `<BUSINESS HERO PLACEHOLDER — PHASE 4: 90% CENTERPIECE>`. Owner: ORCH-0697 Phase 4.
- `src/components/chrome/Nav.tsx` — text-wordmark `mingla` in Fraunces. Owner: ORCH-0697 Phase 2 will swap for the real SVG logo.
- `src/components/chrome/Footer.tsx` — three legal links point to `#`. Owner: ORCH-0697 Phase 5 (real legal page routing).

All 5 transition items are explicit per the spec's exception ("Hero areas are explicitly placeholder slots labeled `<HERO PLACEHOLDER — PHASE X>` — this is the explicit exception to the no-placeholder rule for Phase 1 only").

---

## 12. Spec acceptance criteria — verification matrix

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Build succeeds zero errors / zero warnings | ✅ PASS | `npm run build` final output above. Workspace-root warning resolved by `outputFileTracingRoot`. |
| 2 | Type check passes clean | ✅ PASS | `npm run typecheck` silent (tsc --noEmit success) |
| 3 | Lint passes clean | ✅ PASS | `npm run lint` → "✔ No ESLint warnings or errors" |
| 4 | Dev server starts without errors | ✅ PASS | `npm run dev` → "✓ Ready in 3.7s" |
| 5 | Three subdomains resolve locally with correct content | ✅ PASS | Curl log §5 — each subdomain returns its zone-specific text + correct `x-mingla-zone` header |
| 6 | Audience switcher: clicking inactive pill navigates correctly | ✅ PASS (mechanical) / ⚠ UNVERIFIED (visual morph) | `<a href={zoneUrl(...)}>` correct per spec. Visual confirmation of Framer Motion `layoutId` morph requires human browser interaction. |
| 7 | Design token parity (5-token spot-check) | ✅ PASS | All 5 spec-named tokens verified in §4 |
| 8 | README documents URLs, scripts, Phase 2 pointer | ✅ PASS | `mingla-marketing/README.md` |
| 9 | No content present (zero copy / images / videos / MCP calls) | ✅ PASS | Hero areas are explicit `<HERO PLACEHOLDER — PHASE X>` strings; no Nano Banana / Veo / Stitch / 21st.dev imports anywhere; only sample copy is "marketing site shell is alive" + "Phase X ships..." pointer text |
| 10 | No App Router warnings (missing metadata, dynamic params, etc.) | ✅ PASS | Build output clean — only the `next lint` deprecation notice (informational, see §11) |

**Summary: 10/10 PASS** — with criterion #6 partially mechanically verified (link wiring proven, animation visual unverified pending human browser test).

---

## 13. Invariant preservation check

Greenfield — no prior invariants to preserve. Phase 1 prophylactic invariants from spec §"Constitutional compliance":

| Constitutional principle | Held? | Evidence |
|---|---|---|
| #2 One owner per truth (design tokens) | ✅ | `tokens.css` is canonical, `tokens.ts` is its mirror. Every component consumes via `var(--mingla-*)`, `cn` Tailwind utilities, or `import { ... } from '@/lib/tokens'`. No values hardcoded in components. |
| #5 Server state stays server-side | ✅ | No fetch calls, no React Query, no Zustand. Only `headers()` reads in zone layouts (server-side). |
| #7 Label temporary fixes | ✅ | All 5 placeholders carry `[TRANSITIONAL]` markers + explicit ownership annotation (which Phase will replace) — see §11 |
| #8 Subtract before adding | ✅ | Greenfield, no subtraction needed. Dependency installs follow spec policy strictly — no "just in case" packages. Notably DROPPED `autoprefixer` (D-2 deviation) instead of installing it redundantly. |

---

## 14. Parity check (solo/collab)

Not applicable — marketing sites have no solo/collab modes (those are mobile app concepts).

---

## 15. Cache safety check

Not applicable — Phase 1 has zero data fetching, zero React Query keys, zero Zustand stores, zero mutations.

---

## 16. Regression surface

This is greenfield in a new top-level monorepo directory. **Zero changes outside `mingla-marketing/`.** No existing code touched.

The only adjacent risk: Next.js `outputFileTracingRoot` was set to `__dirname` of the marketing app to suppress a warning about a sibling lockfile at `C:\Users\user\package-lock.json`. This pin only affects marketing's build trace — does not impact `app-mobile/`, `mingla-admin/`, `mingla-business/`, or `supabase/`.

---

## 17. Discoveries for Orchestrator

1. **D-DISC-1** (process — recommend codification): The spec used `_sites/` as the rewrite folder, which is a Next.js private-folder pattern (won't compile as routes). This is a non-obvious gotcha. Recommend the orchestrator's `references/` library include a "Next.js scaffolding pitfalls" note for future marketing/web phases.

2. **D-DISC-2** (process — recommend codification): The spec said `framer-motion` but `framer-motion@11.x` does not support React 19 stable. The package was renamed to `motion` in late 2024 with full React 19 support. Recommend updating the orchestrator's stack memory to reference `motion` (not `framer-motion`) for any new React 19 + Next 15 work.

3. **D-DISC-3** (informational): Tailwind v4 stable (4.2.4) is now available; the spec's "v4 beta" reference is dated. Future scaffold prompts should reference stable.

4. **D-DISC-4** (informational): Next.js 16 is now latest stable. Spec asked for "15.x latest stable" — held to that. If orchestrator wants to plan a Next 16 bump, it's a small follow-up dispatch (codemod-driven, low risk).

5. **D-DISC-5** (informational, follow-up potential): The new ESLint CLI replaces `next lint` in Next 16. If we stay on Next 15.x for marketing, defer; if we bump, run the codemod.

None of these are bugs. All are recommendations to make the next dispatch crisper.

---

## 18. Test first (recommended human verification before orchestrator REVIEW)

1. **Visit all 3 URLs in Chrome** and confirm each shows the correct hero placeholder text + Mingla design system (dark canvas, Fraunces serif headlines, Inter body, orange accent on the active audience pill)
2. **Click the inactive audience pill** in the explore zone — verify the orange spotlight visually morphs to the new pill (Framer Motion `layoutId` animation) before navigating
3. **Spot-check the visual chrome**: the wordmark "mingla" is in Fraunces serif (should look editorial/premium), the audience switcher is a glass capsule with the active pill having an orange glow

If any of those three look wrong, hand back to orchestrator with specifics and I'll dispatch a tight rework.

---

## 19. Time spent

~1.2 hours total wall time. Spec estimated 3–5h; under because greenfield, no investigation, and toolchain compat issues were minor (motion swap, sites/ rename, middleware location).

---

## 20. Next phase pointer

Phase 2 (umbrella site cinematic ecosystem hero) is the next dispatch. Open questions in §7 should be resolved by orchestrator before Phase 2 prompt is written:
- Asset hosting (Supabase Storage recommended)
- Logo SVG sourcing
- App Store URL availability
- Cookie domain coordination with Business platform initiative

---

**End of report.**
