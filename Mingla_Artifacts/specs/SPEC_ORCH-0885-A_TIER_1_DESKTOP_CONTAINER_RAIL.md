# SPEC — ORCH-0885-A [Desktop Tier 1 — Container + Side Rail]

**Mode:** SPEC (define what changes; no fix code; no diffs)
**Parent ORCH:** ORCH-0885 [Mingla Business Desktop Redesign — Seamless Navigation + Blast/Composer Framework Upgrade]
**Branch:** `Seth` · **Working tree:** `/Users/sethogieva/Desktop/mingla-main`
**Severity:** S2 (inherited) · **Classification:** `design-debt` + `ux`
**Surfaces in scope:**
- business-web-preview — primary (visual + interaction at viewport width ≥ 1024px)
- business-iOS — guarded (every desktop branch behind `isWideDesktop`; runtime path bit-identical)
- business-Android — guarded (same)

**Surfaces explicitly NOT in scope:**
- consumer-iOS, consumer-Android (separate workstream)
- buyer-web (`app/checkout/*`, `app/e/*`, `app/b/*`, `app/o/*`, `app/t/*`, `app/booking/*` — anon-buyer surface; per `feedback_anon_buyer_routes.md`)
- admin-web (separate workstream)

---

## Section 0 — Mandatory ingestion checklist

Every path below was opened and read end-to-end (or to the relevant range) before this SPEC was authored.

**Investigation + product context**
- `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/reports/INVESTIGATION_ORCH-0885_DESKTOP_REDESIGN.md` — Sections A (screen-by-screen audit), C (architecture path decision — Path B1 chosen), E.ORCH-0885-A (Tier 1 sub-ORCH scope). Read in full.
- `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/design/desktop-redesign/01-tier1-container-rail.html` — Tier 1 visual reference. `.canvas-bg` CSS rule (lines 28–35) is the source of the gradient stops in §7 of this SPEC.
- `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/design/desktop-redesign/00-today-baseline.html` — baseline (the problem this SPEC solves).

**Code precedents**
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/_layout.tsx` — line 40 imports `StripeProviderWrapper` from `../src/payments/StripeProviderWrapper` (no extension); Metro picks `.tsx` on web, `.native.tsx` on native. The Metro-pattern precedent this SPEC reuses.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/payments/StripeProviderWrapper.tsx` — web stub (passthrough Fragment).
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/payments/StripeProviderWrapper.native.tsx` — native real provider (`StripeNativeProvider`). Both files coexist at the same import path with sibling extensions — the canonical Metro split precedent.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/_layout.tsx` — tab shell, BottomNav mount point, `hideBottomNav` precedent (line 73: `pathname.includes("/campaigns/compose")`).
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/ui/BottomNav.tsx` — canonical mobile glass-capsule. NOT modified by this SPEC; explicitly preserved.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/ui/Sheet.tsx` — **canonical Sheet primitive confirmed at this path** (lines 1–145 of header comment describe API surface, Modal-portal pattern, keyboard-aware translateY behaviour). Single owner of the bottom-sheet contract.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/constants/designSystem.ts` — tokens (`canvas`, `accent`, `text`, `spacing`, `radius`, `shadows`).
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` — line 43 + line 134 confirm `useWindowDimensions` is already in use elsewhere in the tree; no new dependency.

**CI gate precedents**
- `/Users/sethogieva/Desktop/mingla-main/.github/workflows/strict-grep-mingla-business.yml` — host workflow; this SPEC appends one job (per §6 below).
- `/Users/sethogieva/Desktop/mingla-main/.github/scripts/strict-grep/README.md` — the 4-step "add a new gate" recipe this SPEC follows.
- `/Users/sethogieva/Desktop/mingla-main/.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` — the structural template for this SPEC's new gate (file walker + npm/workflow self-test + rich error output).
- `/Users/sethogieva/Desktop/mingla-main/.github/workflows/tests-append-only.yml` — confirmed; both new test files are append-only post-merge.

**Operator memory non-negotiables**
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_strict_grep_registry_pattern.md` — registry pattern: one script + one job, never a parallel workflow file. §6 of this SPEC complies.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_rn_color_formats.md` — colour-format invariant. §7 of this SPEC enumerates the gradient stops as hex/rgba only — zero `oklch`/`lab`/`color-mix`.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_rn_sub_sheet_must_render_inside_parent.md` — sub-sheet JSX must live inside the parent `<Sheet>` children. §5 of this SPEC explicitly forbids any relaxation in the web variant.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md` — mobile keyboard-avoidance behaviour unchanged. Tier 1 work touches no input on mobile.

---

## Section 1 — Goal + surfaces in scope

Tier 1 stops business-web from rendering as a 440px column floating in empty canvas. It ships pure layout work — no framework swaps, no routing forks, no new runtime dependencies — that turns the existing RN-web tree into a desktop-shaped surface at viewport width ≥ 1024px. iOS + Android remain byte-identical at runtime: every desktop branch is gated on `isWideDesktop`, and that boolean is hard-`false` on native.

Tier 1 is the **gating change for every downstream tier** — Tier 2's persistent sidebar reuses the rail; Tier 3's right rail mounts in the same canvas. None of that ships until Tier 1 lands.

This SPEC defines what files change, what their new contracts are, and how to test them. No fix code. No diffs.

---

## Section 2 — `useResponsiveLayout()` hook contract

**Path (NEW):** `mingla-business/src/hooks/useResponsiveLayout.ts`

**Public API:**
```
export interface ResponsiveLayout {
  isWideDesktop: boolean;
  isWeb: boolean;
  width: number;
}
export function useResponsiveLayout(): ResponsiveLayout;
```

**Contract:**
- `isWeb` is `Platform.OS === 'web'`.
- `width` reads from `useWindowDimensions().width` (the same RN hook already used at `ComposerV2Editor.tsx:43,134` — zero new dependency surface).
- `isWideDesktop` is `isWeb && width >= 1024`. The boundary is **inclusive at 1024** (i.e. exactly `width === 1024` returns `true`; `width === 1023` returns `false`).
- The hook **must re-evaluate on browser resize crossing the 1024 boundary** because `useWindowDimensions()` triggers a re-render on every `window` resize event on web.
- **SSR / headless safety:** if `Platform.OS === 'web'` but `useWindowDimensions()` returns `{ width: 0, height: 0 }` (RN-web's documented SSR behaviour when no `window`), the hook MUST return `isWideDesktop: false` without throwing.

**Why a hook (not a constant or an inline check):**
1. SSR-safe: a constant evaluated at module-load time would crash on a server-rendered build where `window` is undefined.
2. Resize-responsive: a constant cannot re-evaluate on browser resize.
3. Single source of truth: every desktop branch in the codebase reads from this hook. The strict-grep gate (§6) makes that a hard rule — implementors MUST NOT inline `Platform.OS === 'web' && width >= 1024` anywhere else.

**Unit-test contract — happy-path (NEW file):** `mingla-business/src/hooks/__tests__/useResponsiveLayout.test.ts`

The implementor authors these three test cases:

1. **Native always returns false.** Mock `Platform.OS = 'ios'`, mock `useWindowDimensions` to return `{ width: 2048, height: 1024 }`. Assert `isWideDesktop === false`, `isWeb === false`.
2. **Web sub-1024 returns false.** Mock `Platform.OS = 'web'`, mock width `1023`. Assert `isWideDesktop === false`, `isWeb === true`, `width === 1023`.
3. **Web at-or-above 1024 returns true.** Mock `Platform.OS = 'web'`, mock width `1024`. Assert `isWideDesktop === true`, `isWeb === true`, `width === 1024`. (Boundary-inclusive.)

Test framework: Jest (already configured in `mingla-business/package.json`). Mock `Platform` via `jest.mock('react-native', () => ({ ...jest.requireActual('react-native'), Platform: { OS: 'web' } }))`. Mock `useWindowDimensions` via the same module mock.

---

## Section 3 — `DesktopCanvas` contract

**Path (NEW):** `mingla-business/src/components/ui/DesktopCanvas.tsx`

**Public API:**
```
export interface DesktopCanvasProps {
  children: React.ReactNode;
  /** Max content-column width on desktop. Default 640 (mock 01). */
  maxWidth?: number;
}
export const DesktopCanvas: React.FC<DesktopCanvasProps>;
```

**Contract:**
- On `isWideDesktop === false` → renders `<>{children}</>` (passthrough Fragment). **Zero layout cost on mobile.**
- On `isWideDesktop === true` → renders an outer `<View>` that fills the available space and paints the ambient gradient (see §7 below for the three radial stops + base canvas hex). The gradient is implemented as a single-layer RN inline style on `backgroundColor` (the solid `#0c0e12` base) plus a stack of `<View>`s with `pointerEvents="none"` and `position: 'absolute'` painting each radial stop via `react-native-svg`'s `<RadialGradient>` inside a `<Defs>`, OR — equivalent, simpler — three `expo-linear-gradient` `<LinearGradient>` siblings layered with `position: 'absolute'`. **Decision deferred to implementor**, with the constraint: no `oklch`/`lab`/`color-mix`/named CSS gradient strings — only hex/rgb/rgba/hsl values for every stop.
- Inside the outer `<View>`, a centred `<View>` with `maxWidth: maxWidth ?? 640`, `marginHorizontal: 'auto'`, `paddingHorizontal: 32`, `flex: 1` hosts the children.
- The component **does not call `useResponsiveLayout()` lazily** — it calls it unconditionally at the top of its render. The branch is on the returned boolean, not on whether the hook ran.

**Mount point:** wraps the children of `<Slot />` inside `mingla-business/app/(tabs)/_layout.tsx`. The only edit to `_layout.tsx` is wrapping the existing `<Slot />` JSX in `<DesktopCanvas>`; the `BottomNav` mount stays where it is — `BottomNav.web.tsx` (§4) handles the desktop swap internally.

**Why a separate component (not inline JSX in `_layout.tsx`):**
1. `_layout.tsx` stays small and readable. Today it's 117 lines; adding the canvas logic inline would push it past 200.
2. The desktop branch becomes unit-testable in isolation (snapshot at width 1440 and width 800; see §9).
3. Future routes that want the canvas without the tab shell (e.g. `app/account/*` if it ever leaves the tabs tree) can mount it directly.

**Snapshot-test contract (added to the happy-path test file):**
- Snapshot at width `1440` → asserts a centred `<View>` with `maxWidth: 640` and the gradient layer is present.
- Snapshot at width `800` → asserts the Fragment passthrough (no extra `<View>`, no gradient layer).

---

## Section 4 — `BottomNav.web.tsx` contract

**Path (NEW):** `mingla-business/src/components/ui/BottomNav.web.tsx`
**Path (UNCHANGED, explicitly preserved):** `mingla-business/src/components/ui/BottomNav.tsx`

**Why two files instead of one runtime branch:**
- Metro auto-resolves `BottomNav` to `BottomNav.web.tsx` on web and `BottomNav.tsx` on native — the same precedent proven by `StripeProviderWrapper.tsx` / `.native.tsx` at `app/_layout.tsx:40`. (Note the asymmetry: Stripe uses `.tsx` for web stub + `.native.tsx` for native real. This SPEC uses `.tsx` for native canonical + `.web.tsx` for web variant — both patterns are supported by Metro's platform-extension resolver; the difference is which side gets the "default" extension. Either works; this SPEC picks the form that keeps the mobile capsule as `.tsx` to minimise grep noise in mobile-only investigations.)
- Zero native-bundle cost: iOS/Android never bundles the web variant. The desktop rail code does not ship to native devices at all.
- No `Platform.select()` inside a single file (which would force both branches into both bundles).

**Public API of `BottomNav.web.tsx`:** identical to `BottomNav.tsx`:
```
export interface BottomNavProps { tabs: BottomNavTab[]; active: string; onChange: (id: string) => void; testID?: string; style?: StyleProp<ViewStyle>; }
export const BottomNav: React.FC<BottomNavProps>;
export default BottomNav;
```
The default export and the named export both exist so `(tabs)/_layout.tsx` does not need to change its import line.

**Web-variant runtime behaviour:**
- Calls `useResponsiveLayout()` at the top of its render.
- **If `isWideDesktop === false`:** renders the existing glass-capsule visual — to satisfy the requirement that narrow web viewports (tablet portrait, mobile browser, dev resize) keep today's mobile layout exactly. The implementor can satisfy this by re-exporting the native canonical's render path; the simplest contract is "compose the same JSX tree the `.tsx` file renders." The SPEC does NOT prescribe how — only that the visual is bit-identical to `BottomNav.tsx` at the same width.
- **If `isWideDesktop === true`:** renders a **left vertical rail** (no glass capsule).
  - **Position:** `position: 'fixed'` (web only — RN-web supports CSS `position: 'fixed'`), `top: 0`, `left: 0`, `bottom: 0`, `width: 80`.
  - **Background:** transparent (the rail sits on top of the `DesktopCanvas` gradient). Right edge: `borderRightWidth: StyleSheet.hairlineWidth`, `borderRightColor: 'rgba(255, 255, 255, 0.05)'` (matches mock 01 `.border-r border-white/5`).
  - **Top:** a 40×40 brand-mark badge with `borderRadius: 12` and a linear gradient from `#F4811F` (`from-orange-500`) to `#E11D48` (`to-rose-600`), containing a centred bold "M" glyph. (Hex values resolved from Tailwind's default palette so the implementor does not improvise.)
  - **Tabs:** the same 5 entries from `TABS` (Home / Hub / Ari / Blast / Account). Each rendered as a 48×48 `<Pressable>` with `borderRadius: 16`, icon size 20px, label below the icon at `fontSize: 9`.
  - **Active state:** background `accent.tint` from `designSystem.ts` (resolves to `rgba(235, 120, 37, 0.18)`), 2px `accent.glow` outer ring (`rgba(235, 120, 37, 0.35)`), icon stroke `accent.solid` (`#eb7825`), label `accent.solid`. (Matches mock 01 §`.bg-accent`/`accent`.)
  - **Inactive state:** transparent background, icon stroke `#b9b9c2`, label `text-zinc-400` equivalent (`#a1a1aa` from Tailwind).
  - **Brand-mark, vertical-rail tabs, account avatar slot at the bottom of the rail** all live inside the fixed-position outer `<View>`.
  - **Layout-cost note:** the rail is `position: 'fixed'` and therefore does not displace the tab content. The `DesktopCanvas` content column is centred in the full viewport width; the rail overlays the left 80px independent of the content. This matches the mock (rail + centred 640px column with the rail visually flanking but not displacing).
- **`hideBottomNav` parity:** the existing rule at `(tabs)/_layout.tsx:73` (`pathname.includes("/campaigns/compose")`) hides the BottomNav on focused-authoring routes. **The rail honours the same predicate** — when `(tabs)/_layout.tsx` decides not to render `<BottomNav>`, neither the mobile capsule nor the desktop rail is rendered. No code inside `BottomNav.web.tsx` checks `pathname` — the decision is made by `(tabs)/_layout.tsx` (today's pattern, preserved).

**Tab interaction:** identical to mobile — same `onChange(id)` callback, same `useRouter().push` in `(tabs)/_layout.tsx`, same active-state detection by `detectActiveTab(pathname)`.

**No haptic feedback on web** — already gated by `Platform.OS !== 'web'` inside the mobile `BottomNav.tsx` `handlePress`. Web variant is similarly haptic-free.

---

## Section 5 — `Sheet.web.tsx` contract

**Path (NEW):** `mingla-business/src/components/ui/Sheet.web.tsx`
**Path (UNCHANGED):** `mingla-business/src/components/ui/Sheet.tsx` (the canonical Sheet primitive, confirmed during ingestion as the single owner of the bottom-sheet contract for both mobile and web in production today).

**Public API of `Sheet.web.tsx`:** identical to `Sheet.tsx` — same `SheetProps`, same `SheetSnapValue`, same `Sheet` named export. The implementor MUST re-export the type aliases so callers (every existing `Sheet` consumer in `mingla-business/`) import identically.

**Web-variant runtime behaviour:**
- Calls `useResponsiveLayout()` at the top of its render.
- **If `isWideDesktop === false`:** renders the existing bottom-sheet behaviour. The implementor can compose this by importing the canonical `Sheet.tsx` body and re-rendering it (Metro lets you import a `.tsx` file from a `.web.tsx` file under the same module name only if the import is given an explicit `.tsx` extension — e.g. `import { Sheet as MobileSheet } from './Sheet.tsx'` is the documented pattern; otherwise both files would resolve to themselves and recurse). **Implementor choice point.** Acceptable alternative: factor the shared body into a `_SheetBody.tsx` (no platform extension) that both `Sheet.tsx` and `Sheet.web.tsx` import.
- **If `isWideDesktop === true`:** renders a **centred floating card** with a dimmed backdrop.
  - **Backdrop:** `position: 'fixed'`, `inset: 0`, `backgroundColor: 'rgba(0, 0, 0, 0.55)'`. Tap-to-dismiss honours `dismissOnScrimTap` (default true) — same prop, same behaviour.
  - **Card:** `position: 'fixed'`, centred via `top: 50%`, `left: 50%`, `transform: [{ translateX: -widthHalf }, { translateY: -heightHalf }]`. Width capped at `min(640, viewportWidth - 64)`. Height auto-sized to content; max-height `min(80vh, viewportHeight - 64)`. Border-radius `radius.lg` (from `designSystem.ts`). Background reuses the existing `Sheet.tsx` glass-stack tokens.
  - **Sub-sheet contract (INVARIANT-CRITICAL):** sub-sheets remain **DOM-children of their parent floating card**, exactly as `feedback_rn_sub_sheet_must_render_inside_parent.md` mandates for native Modal sibling-mounting. The `Sheet.web.tsx` variant MUST NOT lift any sub-sheet to a sibling render at the document root — even though web DOM does not technically have the Modal-sibling problem, the invariant applies per-file (the rule is about the JSX structure consumers must compose, not just the runtime constraint). **SPEC REJECTS** any implementor proposal that places `<SubSheet>` as a Fragment sibling of `<ParentSheet>` in web variant. The verbatim authoritative pattern is `mingla-business/src/components/event/CreatorStep5Tickets.tsx:1368-1386` — sub-sheet JSX inside the parent's `children`.
  - **Animations:** fade + scale-in on open (200ms ease-out, scale `0.96` → `1.0`, opacity `0` → `1`). Fade-out on close (180ms ease-in). Reduce-motion: fade only, no scale.
  - **Keyboard-avoidance:** on desktop with a centred floating card, the soft-keyboard problem does not apply (no virtual keyboard on desktop browsers — physical keyboards don't displace the viewport). The existing `Sheet.tsx` keyboard listeners can be skipped in the desktop branch entirely. (This preserves the I-KEYBOARD-NEVER-BLOCKS-INPUT invariant: the rule applies on mobile; the desktop variant has nothing to block.)

**Out-of-scope for ORCH-0885-A:** this SPEC requires the `Sheet.web.tsx` file to exist and ship the centred-card desktop variant — but consumers of `Sheet` (e.g. `BrandSwitcherSheet`, `UniversalCreatorSheet`, `ManageSheet` on `hub/events`) are NOT migrated to web-specific markup here. They continue to call `<Sheet>` exactly as today; only the primitive's rendering changes when `isWideDesktop`. **Per-consumer audit and any necessary fixes are deferred to ORCH-0885-B** (master-detail pilot includes the consumer-by-consumer pass).

---

## Section 6 — Strict-grep CI gate (`orch-0885-a-no-bottomnav-on-wide-desktop`)

**Pattern compliance:** one script + one job, per `feedback_strict_grep_registry_pattern.md`. No parallel workflow file.

**Path (NEW script):** `.github/scripts/strict-grep/orch-0885-a-no-bottomnav-on-wide-desktop.mjs`

**Structural template:** mirror `orch-0778-web-stripe-native-import-gate.mjs` (already studied during ingestion). Specifically:
1. ES module (`.mjs`), Node 20, no runtime dependencies beyond `node:fs` + `node:path`.
2. `const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();`
3. Walk `mingla-business/src` and `mingla-business/app` recursively, skipping `node_modules` and dotfiles.
4. Self-test of `mingla-business/package.json scripts["test:orch-0885-a"]` pointing at this script.
5. Self-test of `.github/workflows/strict-grep-mingla-business.yml` containing both the job name `orch-0885-a-no-bottomnav-on-wide-desktop:` AND the `on.push.branches` array containing `main` and `Seth`.
6. Rich error format on violation: `<relativePath>:<lineNumber> — <message> — suggested fix: <text> — cross-ref: <doc>`.
7. Exit `0` clean, `1` violation, `2` script error.

**Assertion 1 — BottomNav mount point is unique.** No file in `mingla-business/` matches the import pattern `from\s+["']\.{0,2}\/.*\/?BottomNav["']` OR `from\s+["']\.{0,2}\/.*\/?BottomNav\.web["']` except for the allow-listed paths below. The mobile capsule + web rail are imported once, at `(tabs)/_layout.tsx`.

**Assertion 2 — desktop gate is hook-only.** No file in `mingla-business/src/` or `mingla-business/app/` (excluding allow-list) contains the regex `Platform\.OS\s*===\s*['"]web['"]\s*&&\s*[^;]{0,80}width\s*>=\s*1024`. The fragment `width >= 1024` MAY appear in other contexts (e.g. comments, unrelated breakpoint code), but it MUST NOT appear in the same expression as `Platform.OS === 'web'`. All such gates route through `useResponsiveLayout()`.

**Allow-list (the only files permitted to break either assertion):**
- `mingla-business/src/hooks/useResponsiveLayout.ts` — defines the hook; the inline form lives here once, as the single source of truth.
- `mingla-business/src/components/ui/BottomNav.tsx` — canonical mobile file (the import target itself, not an importer).
- `mingla-business/src/components/ui/BottomNav.web.tsx` — canonical web file (same).
- `mingla-business/app/(tabs)/_layout.tsx` — the one sanctioned BottomNav importer.

The allow-list is encoded as a `Set<string>` of repo-root-relative paths. Any new entry requires a new ORCH amending I-NO-BOTTOMNAV-OUTSIDE-LAYOUT.

**Workflow integration:** append ONE job to `.github/workflows/strict-grep-mingla-business.yml` (existing file; same 4-step recipe in `.github/scripts/strict-grep/README.md`). The job uses the existing `actions/checkout@v4` + `actions/setup-node@v4` pattern. No `@babel/parser` install needed (regex-only gate, like `orch-0778`):

```yaml
  orch-0885-a-no-bottomnav-on-wide-desktop:
    name: "ORCH-0885-A: No BottomNav outside (tabs)/_layout.tsx + desktop gate via hook only"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run ORCH-0885-A gate
        run: node .github/scripts/strict-grep/orch-0885-a-no-bottomnav-on-wide-desktop.mjs
```

**npm wiring:** `mingla-business/package.json` `scripts` gains one entry — `"test:orch-0885-a": "node ../.github/scripts/strict-grep/orch-0885-a-no-bottomnav-on-wide-desktop.mjs"`. The self-test inside the gate validates this is present (so the gate fails CI if anyone removes the wiring).

**README registration:** append a row to the "Active gates registered" table in `.github/scripts/strict-grep/README.md` AND a bullet to the "Currently registered gates" comment block in `.github/workflows/strict-grep-mingla-business.yml` (above the `jobs:` line, near line ~99 where new gate bullets are added).

---

## Section 7 — Designer-input fields (locked values; implementor uses verbatim)

**Ambient gradient — read directly from `01-tier1-container-rail.html` `.canvas-bg` rule (lines 28–35):**

| Stop # | Geometry | Colour (verbatim from mock) | Notes |
|---|---|---|---|
| Base | flat fill | `#0c0e12` | Canvas base (`canvas-bg` line 34) |
| Stop 1 | `radial-gradient(80% 50% at 50% 0%, … 0%, transparent 60%)` | `rgba(235, 120, 37, 0.08)` | Accent-warm wash from the top centre (line 31) |
| Stop 2 | `radial-gradient(60% 60% at 10% 100%, … 0%, transparent 50%)` | `rgba(120, 80, 200, 0.06)` | Indigo wash from bottom-left (line 32) |
| Stop 3 | `radial-gradient(60% 60% at 90% 100%, … 0%, transparent 50%)` | `rgba(50, 180, 200, 0.05)` | Cyan wash from bottom-right (line 33) |

All four values are in hex / rgba — **zero `oklch`, `lab`, `lch`, `color-mix`, `hwb`-with-floating-point-percentages, or any other format `@react-native/normalize-colors` rejects.** Per I-RN-COLOR-FORMATS. **SPEC REJECTS** any implementor proposal that paraphrases these values into a different colour space.

**Rail width:** 80px (mock 01 `aside class="w-[80px]"`, line 68). Hardcoded as a module constant in `BottomNav.web.tsx`.

**Rail icon stroke weights:** 2 (mock 01 SVGs use `stroke-width="2"`). Matches existing `BottomNav.tsx` `Icon` size 22 + default stroke. Implementor reuses the existing `<Icon>` component — no new icon authoring.

**Max-width default:** 640px (mock 01 `max-w-[640px]`, line 96). Encoded as `DesktopCanvas` default prop value.

**Active-state tints:** `accent.tint` (`rgba(235, 120, 37, 0.18)`), `accent.glow` (`rgba(235, 120, 37, 0.35)`), `accent.solid` (`#eb7825`). All three already exist in `designSystem.ts`. Implementor uses the existing tokens — no new token authoring.

**Brand-mark badge gradient (mock 01 line 69 — `bg-gradient-to-br from-orange-500 to-rose-600`):**
- From: `#F4811F` (Tailwind `orange-500`).
- To: `#E11D48` (Tailwind `rose-600`).
Two-stop linear gradient, 135° direction. Render via `expo-linear-gradient` (already a dependency).

**Backdrop colour (Sheet.web.tsx centred-card scrim):** `rgba(0, 0, 0, 0.55)`. Per §3.4 of the source brief.

---

## Section 8 — Success criteria

The implementor's work is **DONE** when ALL of the following are demonstrable in a single PR (`Seth → main`):

1. **Cold-load business-web at 1440px** renders: 80px left rail with brand-mark + 5 tabs + account avatar; 640px centred content column; ambient gradient in the margins; NO bottom-tab capsule visible anywhere.
2. **Cold-load business-web at 1023px** renders today's exact mobile layout — bottom-tab capsule visible at the bottom of the viewport, no rail, no 640px column.
3. **Cold-load business-iOS Simulator + business-Android Emulator** — bit-identical to current `main`. The desktop hook returns `isWideDesktop: false` on both; every conditional bypasses to the existing path. Tester verifies via screenshot diff against `main` and JS-render-tree inspection.
4. **Browser resize across 1024 boundary** — drag a Chrome window from 1500 → 800 → 1500 → 1023 → 1024. Layout toggles correctly each crossing; no state loss, no listener leak, no remount of the route component (React tree identity preserved across the boundary; only the `BottomNav.web.tsx` and `DesktopCanvas` branches re-render).
5. **Strict-grep gate exits 0 locally and on CI.** `cd mingla-business && npm run test:orch-0885-a` exits 0. The CI job `orch-0885-a-no-bottomnav-on-wide-desktop` on the PR is green.
6. **Happy-path test passes.** `mingla-business/src/hooks/__tests__/useResponsiveLayout.test.ts` — all three cases + the `DesktopCanvas` snapshot pair.
7. **Adversarial test passes** (tester-authored — see §9).
8. **No new TypeScript errors.** `cd mingla-business && npx tsc --noEmit` exits 0. No `@ts-ignore` introduced.
9. **No new lint errors.** `npm run lint` exits 0.
10. **No new failing Jest tests** elsewhere in the suite.
11. **`hideBottomNav` parity** — on `/campaigns/compose` at width 1440, neither the rail nor the capsule renders (the existing predicate in `(tabs)/_layout.tsx:73` is honoured by both variants).

---

## Section 9 — Required tests (regression-test gate compliance, codified ORCH-0840)

This SPEC requires BOTH a happy-path test (implementor) AND an adversarial test (tester). Both are append-only post-merge per `tests-append-only.yml`.

### 9.a Implementor happy-path regression test

**Path (NEW):** `mingla-business/src/hooks/__tests__/useResponsiveLayout.test.ts`

**Test cases:**
1. `Platform.OS === 'ios'` returns `{ isWideDesktop: false, isWeb: false, width: <mocked> }` for any width including 2048.
2. `Platform.OS === 'web'`, mocked width `1023` → `isWideDesktop: false`, `isWeb: true`, `width: 1023`.
3. `Platform.OS === 'web'`, mocked width `1024` → `isWideDesktop: true`, `isWeb: true`, `width: 1024`. **(Boundary inclusive.)**
4. **Snapshot — DesktopCanvas at width 1440:** centred max-width 640 column + gradient layer present.
5. **Snapshot — DesktopCanvas at width 800:** Fragment passthrough (no wrapping `<View>`, no gradient).

**Fails-on-revert protocol:** the implementor's CLOSE report MUST cite the commit hash at which `git revert <commit>` of the fix-commit breaks at least one of cases 1–3 (the hook contract). Convention: revert the hook commit, run `npx jest src/hooks/__tests__/useResponsiveLayout.test.ts`, assert RED, paste the failure output into the CLOSE report.

### 9.b Tester adversarial regression test

**Path (NEW):** `mingla-business/src/hooks/__tests__/useResponsiveLayout.adversarial.test.ts`

**Mandatory:** attacks a DIFFERENT angle than the happy-path file. Tester chooses at least three of:
- (a) **Boundary at exactly 1024 inclusive** — assert true for `width === 1024` (overlaps with happy-path case 3 by design; the redundancy is the point — if a future refactor flips the boundary to exclusive, both tests fail, doubling signal strength).
- (b) **Rapid resize burst** — fire `1500 → 1023 → 1500 → 1023 → 1500` width updates within a 100ms window via `act()`. Assert no thrown errors, no listener leaks (count `addEventListener` calls vs `removeEventListener` calls on cleanup), final boolean correct.
- (c) **SSR / headless safety** — `Platform.OS === 'web'` with `useWindowDimensions()` returning `{ width: 0, height: 0 }` (RN-web's documented behaviour when `window` is undefined). Assert `isWideDesktop: false`, no throw.
- (d) **`hideBottomNav` desktop parity** — render `(tabs)/_layout.tsx` with `usePathname()` mocked to `/campaigns/compose` and `isWideDesktop: true`. Assert neither `BottomNav` (mobile) nor the rail (desktop) renders.

Tester writes this file. The SPEC defines the contract; the SPEC does NOT write the implementation.

**Append-only enforcement:** `.github/workflows/tests-append-only.yml` already blocks modification of test files post-merge without a `[TEST-MOD-APPROVED ORCH-NNNN]` override marker. Both new files inherit that protection from their first commit.

---

## Section 10 — Invariants that must hold

| ID | Source | Hard-rejection rule |
|---|---|---|
| **I-DESKTOP-GATE-VIA-HOOK** (NEW — codified by this SPEC) | §6 of this SPEC | No file in `mingla-business/src/` or `mingla-business/app/` (excluding allow-list) gates on desktop except through `useResponsiveLayout()`. Enforced by strict-grep §6 Assertion 2. |
| **I-NO-BOTTOMNAV-OUTSIDE-LAYOUT** (NEW — codified by this SPEC) | §6 of this SPEC | `BottomNav` is imported only inside `mingla-business/app/(tabs)/_layout.tsx`. Enforced by strict-grep §6 Assertion 1. |
| **I-RN-COLOR-FORMATS** (existing — `feedback_rn_color_formats.md`) | RN inline colours must be hex/rgb/rgba/hsl/hwb only | The ambient gradient (§7) uses hex + rgba only. **SPEC REJECTS** any colour value in `oklch`/`lab`/`lch`/`color-mix`/CSS-named-gradient-string form anywhere in `DesktopCanvas.tsx`, `BottomNav.web.tsx`, or `Sheet.web.tsx`. |
| **I-SUB-SHEET-INSIDE-PARENT** (existing — `feedback_rn_sub_sheet_must_render_inside_parent.md`) | Sub-sheet JSX must be a child of its parent `<Sheet>`, not a Fragment sibling | `Sheet.web.tsx` (§5) preserves the rule. **SPEC REJECTS** any web-variant proposal that lifts sub-sheets to document-root siblings, even though web DOM lacks the native-Modal sibling problem — the invariant applies per-file. |
| **I-KEYBOARD-NEVER-BLOCKS-INPUT** (existing — `feedback_keyboard_never_blocks_input.md`) | Every `TextInput` on mobile must remain visible above the soft keyboard | Tier 1 work touches no `TextInput` and changes no mobile layout. The existing keyboard listener pattern in `Sheet.tsx` is preserved unchanged. |
| **I-CROSS-SURFACE-IMPACT** (existing — `feedback_cross_surface_impact_inspection.md`) | Every SPEC declares surfaces touched + surfaces explicitly NOT touched | Done at the header of this SPEC: business-web-preview primary, business-iOS/Android guarded byte-identical, consumer/admin/buyer-web explicitly OUT. |

**Parent-ORCH standing invariants (per ORCH-0885 dispatch brief §6 — non-negotiable):**
- Mobile UX byte-identical → satisfied by `isWideDesktop` hard-`false` on native.
- No new routes, no new tabs, no new tab-shell mounts → satisfied (the only edit to `_layout.tsx` is wrapping `<Slot />` in `<DesktopCanvas>`; the tab list is untouched).
- No native bundle bloat → satisfied by Metro `.web.tsx` extension (web-only code never enters native bundle).
- All four memory invariants enforced → see table above.

**SPEC REJECTS any output that violates any of these.**

---

## Section 11 — Files this SPEC marks as touched

| Status | Path | Change category |
|---|---|---|
| NEW | `mingla-business/src/hooks/useResponsiveLayout.ts` | Add hook per §2 |
| NEW | `mingla-business/src/hooks/__tests__/useResponsiveLayout.test.ts` | Happy-path tests per §9.a |
| NEW | `mingla-business/src/hooks/__tests__/useResponsiveLayout.adversarial.test.ts` | Adversarial tests per §9.b (tester authors) |
| NEW | `mingla-business/src/components/ui/DesktopCanvas.tsx` | Max-width wrapper + gradient per §3 |
| NEW | `mingla-business/src/components/ui/BottomNav.web.tsx` | Web-variant rail per §4 |
| NEW | `mingla-business/src/components/ui/Sheet.web.tsx` | Web-variant centred-card sheet per §5 |
| NEW | `.github/scripts/strict-grep/orch-0885-a-no-bottomnav-on-wide-desktop.mjs` | Strict-grep gate per §6 |
| EDIT | `.github/workflows/strict-grep-mingla-business.yml` | Append one job + one registry-comment bullet per §6 |
| EDIT | `.github/scripts/strict-grep/README.md` | Append one row to "Active gates registered" table per §6 |
| EDIT | `mingla-business/package.json` | Add one `scripts["test:orch-0885-a"]` entry per §6 |
| EDIT | `mingla-business/app/(tabs)/_layout.tsx` | Wrap `<Slot />` children in `<DesktopCanvas>`. NO other changes. |
| UNCHANGED | `mingla-business/src/components/ui/BottomNav.tsx` | Explicitly preserved as canonical mobile glass-capsule. Implementor MUST NOT edit. |
| UNCHANGED | `mingla-business/src/components/ui/Sheet.tsx` | Explicitly preserved as canonical Sheet primitive. Implementor MUST NOT edit (unless the shared-body factoring described in §5 is adopted — in which case the change is comment-and-import only, no behaviour change). |
| UNCHANGED | every other route, every other component, every other surface | Tier 1 is shell-only. |

**Count: 6 new files, 4 edited files, 0 deleted files.**

---

## Section 12 — Risks the implementor must defend against

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Metro platform-extension resolution might not extend cleanly to UI components.** The `StripeProviderWrapper` precedent lives under `src/payments/`; this SPEC adds three `.web.tsx` siblings under `src/components/ui/`. | Implementor must verify Metro's `resolver.sourceExts` and `resolver.platforms` in `mingla-business/metro.config.js` (or rely on Expo SDK 54 defaults) admit `.web.tsx` for components. If Metro restricts the pattern to a subdirectory list, the implementor names the config edit needed AND ships it in the same PR. Expectation: zero config change needed (Expo SDK 54 default is `['web', 'ios', 'android', 'native']` for `resolver.platforms`, applied repo-wide). |
| 2 | **RN-web SSR / headless environment may have `window === undefined`.** | `useResponsiveLayout()` defensively returns `isWideDesktop: false` when `useWindowDimensions()` reports `{ width: 0, height: 0 }`. Adversarial test (§9.b case c) covers this. |
| 3 | **Existing `hideBottomNav` routes must continue hiding chrome on web≥1024 too.** The rail is not a CTA-permission-bypass — `/campaigns/compose` cannot grow a side rail just because someone resized. | The hide decision lives in `(tabs)/_layout.tsx`, not in `BottomNav.web.tsx`. The web variant only renders if `<BottomNav>` is mounted at all. Adversarial test (§9.b case d) covers this. |
| 4 | **`position: 'fixed'` on the rail behaves correctly on RN-web but not on native** — RN-web maps `position: 'fixed'` to CSS fixed; RN-native silently ignores it (treats it as relative). | Acceptable: the rail is web-only by Metro split. The mobile capsule uses `position: 'absolute'`, unchanged. No native code ever sees `'fixed'`. |
| 5 | **The `Sheet.web.tsx` factoring choice (importing canonical body vs shared `_SheetBody.tsx`)** could introduce a circular import or duplicate `Modal` instances on mobile. | Implementor chooses one path explicitly in §5; the other is documented as the rejected alternative with one-line rationale. If shared-body factoring is adopted, the implementor must ensure the iOS/Android render tree is bit-identical to `main` (success criterion 3). |
| 6 | **Bundle-size impact on web.** `BottomNav.web.tsx` adds the rail markup + the brand-mark gradient. `DesktopCanvas` adds the gradient layer. `Sheet.web.tsx` adds the centred-card layer. | All three are RN primitives + existing `expo-linear-gradient`. Estimated gzipped delta: <4 KB. Implementor measures via `npx expo export -p web` before/after and reports the delta in CLOSE. |
| 7 | **`useWindowDimensions()` on RN-web fires a re-render on every browser resize event** — could thrash the tree at 60Hz during drag. | Mitigation: `BottomNav.web.tsx` and `DesktopCanvas` only act on the boolean `isWideDesktop`, which changes at most once per 1024-boundary crossing. The hook itself is cheap; consumers branch on the derived boolean. No tree thrash. |
| 8 | **Implementor temptation to "while we're at it" expand scope into Tier 2.** | SPEC's §3.7-equivalent in the source brief is explicit: no master-detail, no routing forks, no framework swaps. Implementor PR description must explicitly state "Tier 1 shell-only; no route added, no sheet consumer migrated." Tester verifies via `git diff --stat Seth..main` listing only the 10 files in §11. |
| 9 | **WCAG AA on the dark canvas at desktop scale.** Mock uses `#0c0e12` canvas + accent-tint hover; pairing may fall under 4.5:1 in selected/hover states. | Out of scope for Tier 1 (the rail's active-state tokens are unchanged from `designSystem.ts`'s existing values, which already passed accessibility review for mobile). If tester flags a contrast failure, it becomes a new ORCH against `designSystem.ts`. |
| 10 | **Biggest single risk — the implementor inlines `Platform.OS === 'web' && width >= 1024` somewhere "just once."** Then the strict-grep gate gets disarmed by an allow-list expansion, then four more inlines follow. | The strict-grep gate's allow-list is a `Set<string>` with four entries — adding any entry requires a new ORCH amending I-DESKTOP-GATE-VIA-HOOK. The gate's self-test in §6 step 5 ensures the gate stays wired into CI even if the workflow file is touched. Tester verifies on every adjacent PR that the allow-list is unchanged. |

---

## Section 13 — Implementor handoff prompt template

The block below is the prompt the orchestrator hands directly to **Codex `implementor-mingla`** (default — see recommendation note at the bottom) or to **Claude `mingla-implementor`** (alternate per parity).

---

```
You are acting as implementor-mingla on ORCH-0885-A [Desktop Tier 1 — Container + Side Rail].

The full SPEC lives at:
  /Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/specs/SPEC_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md
Read it in full before writing any code. The SPEC is your contract.

Parent ORCH: ORCH-0885 [Mingla Business Desktop Redesign — Seamless Navigation + Blast/Composer Framework Upgrade].
Working tree: /Users/sethogieva/Desktop/mingla-main on branch Seth.

Hard requirements:

1. Phase 0 mandatory ingestion. Open every file the SPEC cites in §0:
   - The investigation report (§Sections A, C, E.ORCH-0885-A)
   - Tier 1 mock 01-tier1-container-rail.html (read .canvas-bg verbatim)
   - app/_layout.tsx, app/(tabs)/_layout.tsx
   - src/components/ui/BottomNav.tsx (do NOT edit; verify visual contract)
   - src/components/ui/Sheet.tsx (verify the canonical primitive; §5 of the SPEC chooses the factoring approach)
   - src/payments/StripeProviderWrapper.tsx + StripeProviderWrapper.native.tsx (Metro precedent)
   - src/constants/designSystem.ts (read accent.tint, accent.glow, accent.solid)
   - .github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs (script template)
   - .github/workflows/strict-grep-mingla-business.yml (job structure)
   - .github/scripts/strict-grep/README.md (4-step gate recipe)
   Cite every opened path in your CLOSE report's Phase 0 section.

2. Author exactly the files in SPEC §11 (6 new + 4 edited). No additional files. If you encounter a forced detour (e.g. metro.config.js change per SPEC §12 Risk #1), declare it in CLOSE before adding the file.

3. Author the happy-path regression test at:
   /Users/sethogieva/Desktop/mingla-main/mingla-business/src/hooks/__tests__/useResponsiveLayout.test.ts
   Three required cases per SPEC §9.a + two DesktopCanvas snapshot cases. Use Jest + jest.mock for Platform and useWindowDimensions.

4. Regression-test gate fails-on-revert verification (ORCH-0840 Step 0.5 — non-negotiable):
   After writing the fix + the test, run:
     cd mingla-business && npx jest src/hooks/__tests__/useResponsiveLayout.test.ts
   Assert PASS. Then `git stash` the fix commit's source changes (keeping the tests staged); re-run; assert RED. `git stash pop`; assert GREEN again. Paste the RED output into your CLOSE report. This is the proof the test actually exercises the fix path. Acceptable alternative: instead of stash/pop, cite the exact commit hash where `git revert <fix-commit>` breaks the test, and paste the resulting failure.

5. Strict-grep gate. Author the script per SPEC §6:
   /Users/sethogieva/Desktop/mingla-main/.github/scripts/strict-grep/orch-0885-a-no-bottomnav-on-wide-desktop.mjs
   Run it locally: `cd mingla-business && npm run test:orch-0885-a`. Expect exit 0.
   Append the workflow job AND the README row AND the registry comment bullet. Self-test inside the script must validate all three.

6. Surfaces in scope: business-web-preview (primary), business-iOS (guarded byte-identical), business-Android (guarded byte-identical). NOT in scope: consumer-iOS/Android, buyer-web, admin-web. Declare this verbatim in your CLOSE.

7. Invariants you must hold (SPEC §10):
   - I-DESKTOP-GATE-VIA-HOOK (NEW)
   - I-NO-BOTTOMNAV-OUTSIDE-LAYOUT (NEW)
   - I-RN-COLOR-FORMATS (existing — gradient uses ONLY hex/rgba per SPEC §7 table)
   - I-SUB-SHEET-INSIDE-PARENT (existing — Sheet.web.tsx preserves the JSX child rule)
   - I-KEYBOARD-NEVER-BLOCKS-INPUT (existing — touch no mobile keyboard code)
   - I-CROSS-SURFACE-IMPACT (existing — declare surfaces in CLOSE)

8. Before any UI commit, invoke /ui-ux-pro-max as a pre-flight design step. The visual surface here is the left rail + the ambient gradient + the centred card variant of Sheet. Confirm the rail's active-state tints + the brand-mark gradient angle/colours match the mock pixel-for-pixel within the tokens available. No improvisation.

9. Verification pass before CLOSE:
   - cd mingla-business && npx tsc --noEmit  → 0 errors
   - cd mingla-business && npm run lint       → 0 errors
   - cd mingla-business && npx jest           → no new failures
   - cd mingla-business && npm run test:orch-0885-a → exit 0
   - cd mingla-business && npm run web        → open http://localhost:8081 in Chrome at 1440px and at 1023px; capture two screenshots, attach to CLOSE.
   - iOS Simulator + Android Emulator: cold-load home and account tabs; capture two screenshots per platform; assert no visual diff vs main.

10. CLOSE report structure:
    Phase 0 ingestion log (every file cited).
    Files changed (with the SPEC §11 table cross-checked).
    Test results (jest output, strict-grep output, tsc output, lint output).
    Fails-on-revert evidence (RED output OR revert-commit-hash citation).
    Screenshots (web@1440, web@1023, iOS, Android).
    Surfaces declaration (in scope + explicitly NOT).
    Invariants honoured (1-line each).
    Risks the SPEC flagged + how you defended against each (especially §12 #1, #5, #10).
    Any deviation from the SPEC + 2-sentence justification.

Do NOT skip any of the above. Do NOT bundle this with any other ORCH. PR title: "Close ORCH-0885-A: Desktop Tier 1 — Container + Side Rail". One PR, Seth → main.
```

---

### Implementor target recommendation

**Codex `implementor-mingla` (default).** Rationale: this work is small (≤10 files), entirely in-tree, no Supabase migration, no edge function, no native module — Codex is already the canonical implementor and the routing fits within its proven envelope. Claude `mingla-implementor` is a viable alternate by parity (per `feedback_claude_codex_full_parity.md`) if Codex is unavailable or operator prefers Claude continuity from this SPEC turn.

---

*End of SPEC. No code. No diffs. Spec only.*
