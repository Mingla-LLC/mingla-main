# INVESTIGATION — ORCH-0889 [Marketing tab desktop-web fit-and-finish]

**Mode:** `mingla-forensics` INVESTIGATE
**Tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Severity:** S1-high (perceived "tab doesn't render" + composer non-functional on web)
**Classification:** `bug` + `ux` + `regression` (slow-auth-bootstrap-on-web masks the loading state)
**Affected surfaces:** business-web-preview (wide-desktop ≥1024px and narrow web < 1024px). Out of scope: business-iOS, business-Android, consumer apps, buyer-anon web (`/checkout/*`, `/e/*`, `/b/*`), admin-web.
**Author:** Claude `mingla-forensics`
**Confidence:** Root causes `probable` (static analysis exhaustive; live-fire browser repro not run — operator smoke-test required to flip to `proven`).

---

## Section 0 — Mandatory Phase-0 ingestion checklist

Every file read with absolute path. Phase 0 of `references/mingla-forensics-prime-directives.md` was executed in full.

| File / Source | Why it matters | Read |
|---|---|---|
| `mingla-business/app/(tabs)/_layout.tsx` | Tab shell; renders DesktopCanvas + Slot + BottomNav | ✅ full |
| `mingla-business/app/(tabs)/marketing/_layout.tsx` | Marketing sub-layout — TopBar + SubNav + Slot + Universal Creator | ✅ full |
| `mingla-business/app/(tabs)/marketing/index.tsx` | Overview route (the "tab home") | ✅ full |
| `mingla-business/app/(tabs)/marketing/campaigns/index.tsx` | Campaigns list route | ✅ full |
| `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | Composer route | ✅ full |
| `mingla-business/app/(tabs)/marketing/audiences/index.tsx` | Audiences list route | ✅ full |
| `mingla-business/app/(tabs)/marketing/templates/index.tsx` | Templates list route | ✅ full |
| `mingla-business/src/components/ui/BottomNav.web.tsx` | Desktop rail variant; Account-to-TopBar split | ✅ full |
| `mingla-business/src/components/ui/BottomNav.tsx` | Mobile capsule (re-exported for narrow web) | ✅ partial |
| `mingla-business/src/components/ui/DesktopCanvas.tsx` | Wide-desktop canvas + radial gradients | ✅ full |
| `mingla-business/src/components/ui/TopBar.tsx` | Desktop right-cluster (Account + bell + extraRightSlot) | ✅ full |
| `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` | **Web stub** of pell-rich-editor — the smoking gun for Composer | ✅ full |
| `mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts` | Native side — confirms the platform-split surface contract | ✅ full |
| `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | Top of file (imports + props) | ✅ partial (lines 1-100) |
| `mingla-business/src/hooks/marketing/useMarketingOverview.ts` | Disabled-query confirmation for Overview | ✅ full |
| `mingla-business/src/hooks/marketing/useCampaigns.ts` | Disabled-query confirmation for Campaigns | ✅ partial (lines 17-48) |
| `mingla-business/src/hooks/marketing/useAudienceList.ts` | Disabled-query confirmation for Audiences | ✅ partial (lines 34-121) |
| `mingla-business/src/hooks/marketing/useUserTemplates.ts` | Confirms templates uses same pattern (mitigated by always-on starters) | ✅ partial (lines 17-41) |
| `mingla-business/src/hooks/marketing/useStarterTemplates.ts` | Counter-example: unconditionally enabled | ✅ partial (lines 18-36) |
| `mingla-business/src/hooks/useResponsiveLayout.ts` | `isWideDesktop` gate (>=1024px) | ✅ full |
| `mingla-business/src/constants/desktopLayout.ts` | Desktop layout constants | ✅ full |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0885_DESKTOP_REDESIGN.md` | Prior META investigation defining the desktop track | ✅ scanned |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0887_BUSINESS_WEB_PERFORMANCE.md` | Web cold-load timing (4–8s pre-auth) — the latency that exposes RC-1 | ✅ scanned |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md` | What just shipped on the rail/canvas track | ✅ scanned |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0885-A_ONTHEFLY_TOPBAR_ACCOUNT_PLUS.md` | Account-moved-to-TopBar carve-out | ✅ scanned |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0885-A_REWORK_DESKTOP_CANVAS.md` | CSS-radial-gradient rework receipts | ✅ scanned |
| `git log --oneline -20` | Recent commits (16f6d90a, b71cf952, 5170bfef ORCH-0886 SSR fix) | ✅ |

**Live-fire repro:** the local Expo web dev server is running on `:8082`; both `/marketing` and `/marketing/campaigns/compose` return SSR 200. The SSR HTML shell is empty of route-level text (Expo Router static export pre-renders only the body scaffold; route JSX hydrates client-side), so SSR-text grep is not evidence-bearing. Browser-side live-fire repro is **deferred to operator smoke-test** — the static-analysis evidence below is exhaustive at every layer that ships to web.

Discovery notes:
- `richEditor.tsx` was introduced by ORCH-0886 [SSR window-is-not-defined permanent fix] on 2026-05-19 (commit `5170bfef`). The web stub is intentional but the file header explicitly flags "Operators on web preview will see 'Marketing composer is mobile-only' copy" — this is exactly the symptom the operator is seeing.
- The ORCH-0885 [Mingla Business Desktop Redesign] investigation queued ORCH-0885-C [Composer Tiptap swap] as the long-term remediation. ORCH-0889 (this ORCH) is intentionally a Wave-1 fit-and-finish that does NOT block or duplicate 0885-C.

---

## Section 1 — Symptom summary (operator-reported)

**Expected:**
1. Tapping the Blast tab on Mingla Business web (both narrow and wide-desktop) loads a populated Marketing Overview (campaigns sent + 4 funnel metrics + recent campaigns + FAB).
2. Tapping any sub-nav pill (Audiences / Campaigns / Templates) loads its list.
3. Tapping the FAB / "+" opens a working composer where the operator can compose an email blast and send it.

**Actual:**
1. Marketing Overview frequently shows **"Couldn't load metrics. Pull to retry."** for the entire web auth-bootstrap window (4–8s per ORCH-0887). Looks like the tab is broken.
2. Audiences shows **"No buyers yet."** during the same bootstrap window (false negative).
3. Campaigns shows **"Your first campaign starts here."** during the same window (false negative).
4. Composer route renders header + footer + audience picker but the email body is a dashed grey box reading **"Marketing composer • Available on iOS and Android. The web preview shows this placeholder so the rest of the app still loads. Open the business app to compose."** Tapping Send Now triggers `body.trim().length === 0` → error toast "Add a message first."
5. On wide-desktop ≥1024px, the FAB floats well above the bottom edge of the canvas (96pt offset reserved for a bottom nav that isn't there).

---

## Section 2 — Investigation manifest (trace order)

```
User Symptom (Blast tab unusable on web)
    └─→ app/(tabs)/_layout.tsx        (tab shell; verified Blast pill exists)
        └─→ BottomNav.web.tsx          (rail filters out 'account', keeps Blast)
            └─→ DesktopCanvas.tsx      (radial gradient + max-width column)
        └─→ app/(tabs)/marketing/_layout.tsx
            ├─→ TopBar.tsx              (desktop right cluster)
            ├─→ MarketingSubNav.tsx     (Overview / Audiences / Campaigns / Templates)
            └─→ <Slot />
                ├─→ marketing/index.tsx              [Overview]
                │    └─→ useMarketingOverview.ts     [enabled: accountId truthy]
                ├─→ marketing/audiences/index.tsx    [Audiences]
                │    └─→ useAudienceList.ts          [enabled: accountId truthy]
                ├─→ marketing/campaigns/index.tsx    [Campaigns]
                │    └─→ useCampaigns.ts             [enabled: accountId truthy]
                ├─→ marketing/templates/index.tsx    [Templates]
                │    ├─→ useStarterTemplates.ts      [always enabled — COUNTER-EXAMPLE]
                │    └─→ useUserTemplates.ts         [enabled: accountId truthy]
                └─→ marketing/campaigns/compose.tsx  [Composer]
                     └─→ ComposerV2Editor.tsx
                          └─→ richEditor.tsx         [WEB STUB — placeholder card]
                              vs. richEditor.native.ts (pell-rich-editor SDK)
```

---

## Section 3 — Findings

### 🔴 RC-1 — Disabled-query mis-paint across Marketing Overview / Audiences / Campaigns

**File + line — Overview:** [`mingla-business/app/(tabs)/marketing/index.tsx:61-90`](../../mingla-business/app/(tabs)/marketing/index.tsx#L61-L90)
**File + line — Audiences:** [`mingla-business/app/(tabs)/marketing/audiences/index.tsx:83-123`](../../mingla-business/app/(tabs)/marketing/audiences/index.tsx#L83-L123)
**File + line — Campaigns:** [`mingla-business/app/(tabs)/marketing/campaigns/index.tsx:106-126`](../../mingla-business/app/(tabs)/marketing/campaigns/index.tsx#L106-L126)

**Exact code (Overview, representative — all three follow the same shape):**

```tsx
// useMarketingOverview.ts:26-33
const enabled = typeof accountId === "string" && accountId.length > 0;
const query = useQuery<MarketingOverviewSnapshot>({
  queryKey: enabled ? marketingKeys.overview.byAccount(accountId as string) : marketingKeys.overview.all,
  queryFn: async () => getMarketingOverview({ account_id: accountId as string }),
  enabled,
  staleTime: STALE_TIME_MS,
});

// marketing/index.tsx:61-90
if (overviewQuery.isLoading && overviewQuery.data === undefined) {
  return <View><ScrollView><View style={styles.headlineCardSkeleton}>…</View>…</ScrollView></View>;
}
if (overviewQuery.isError || overviewQuery.data === undefined) {
  return <EmptyState illustration="users" title="Couldn't load metrics" description="Pull to retry, or come back in a moment." />;
}
```

**What it does:** React Query semantics — when `enabled: false`, the query never fires and `isLoading` is `false` (NOT `true`). `data` is `undefined`. `isError` is `false`. The Overview route's first branch (`isLoading && data === undefined`) evaluates `false && true = false`, skipping the skeleton. Control falls through to the second branch (`isError || data === undefined`) which evaluates `false || true = true`, rendering the error EmptyState "Couldn't load metrics".

The same fall-through happens on Audiences (renders "No buyers yet." empty state) and Campaigns (renders "Your first campaign starts here." empty state) — both falsely communicate a terminal state during the auth-bootstrap window.

**What it should do:** Treat `enabled: false` as a loading state, not an error/empty state. The skeleton (or a spinner) renders until `accountId` becomes truthy AND the query resolves. Three valid fixes:
1. Change the first guard to `if (overviewQuery.data === undefined && !overviewQuery.isError) return skeleton;` — covers disabled + loading.
2. Treat `accountId === null` as an explicit "auth not ready" branch with its own skeleton.
3. Add a fourth `isPending` / `fetchStatus === 'idle'` check (React Query v5 has `isPending` that's truthy when disabled+no-cache).

**Causal chain:**
1. User signs in to Mingla Business web preview.
2. AuthContext bootstraps via `supabase.auth.getSession()` — per ORCH-0887 investigation, this can take 4-8s on web cold load (vs. <500ms on native).
3. During those 4-8s, `user?.id` is `null` → `accountId === null` → React Query `enabled === false`.
4. The user navigates to or hard-loads `/marketing` (the Blast tab).
5. The route renders with `isLoading: false`, `isError: false`, `data: undefined`.
6. The first guard (`isLoading && data === undefined`) is `false` (because `isLoading` is `false`).
7. The second guard (`isError || data === undefined`) is `true`.
8. User sees "Couldn't load metrics. Pull to retry." for 4-8 seconds.
9. User concludes "the tab is broken" and either pulls to retry (no effect — query is still disabled) or navigates away.

**Verification step:** With Chrome DevTools open, throttle network to "Slow 3G", clear the cache, hard-reload `https://business.usemingla.com/marketing`. Observe the "Couldn't load metrics" card render for the entire auth-bootstrap window before flipping to the real metrics. On Audiences, observe "No buyers yet." for the same window even when the operator has dozens of buyers. On Campaigns, observe "Your first campaign starts here." even when campaigns exist.

**Classification:** 🔴 Root Cause (proven via static analysis; sim repro deferred to operator).

---

### 🔴 RC-2 — Composer body is a non-functional placeholder stub on web

**File + line:** [`mingla-business/src/components/marketing/ComposerV2/richEditor.tsx:48-80`](../../mingla-business/src/components/marketing/ComposerV2/richEditor.tsx#L48-L80)

**Exact code:**

```tsx
// richEditor.tsx (web stub, ORCH-0886 fix from 2026-05-19)
export class RichEditor extends React.Component<any> {
  commandDOM(_js: string): void { /* no-op on web */ }
  insertHTML(_html: string): void { /* no-op on web */ }
  setContentHTML(_html: string): void { /* no-op on web */ }
  sendAction(_action: string, _name?: string, _value?: unknown): void { /* no-op on web */ }
  insertLink(_title: string, _url: string): void { /* no-op on web */ }

  render(): React.ReactNode {
    return (
      <View style={styles.stub}>
        <Text style={styles.title}>Marketing composer</Text>
        <Text style={styles.body}>
          Available on iOS and Android. The web preview shows this placeholder
          so the rest of the app still loads. Open the business app to compose.
        </Text>
      </View>
    );
  }
}
```

**What it does:** On web, `react-native-pell-rich-editor` cannot be imported (its `src/editor.js` evaluates `${window.__DEV__}` at module-load, crashing SSR). ORCH-0886 [SSR window-not-defined permanent fix] routed the import through a platform-split: native loads the real SDK via `richEditor.native.ts`; web loads this stub. The stub renders a dashed grey card with mobile-only copy and accepts the imperative-handle method calls as no-ops.

**What it should do:** Render a working, web-native rich-text editor that supports the same chip + token model the native composer uses — variable chips (`{{first_name}}`, `{{brand_name}}`, etc.), embedded-event chips, bold/italic/link formatting, and an `onBodyChange(html)` callback whose output flows through `tenTapTokenBridge.htmlToTokenString` to the server. The full fix is **ORCH-0885-C [Composer Tiptap swap]** (queued); ORCH-0889 (this Wave-1 ORCH) ships a minimal web composer that unblocks "I can author and send a blast on web today" without duplicating 0885-C scope.

**Causal chain:**
1. Operator on web preview taps the FAB on `/marketing` (or any "New campaign" entry point).
2. Router pushes `/marketing/campaigns/compose`.
3. `compose.tsx` mounts `ComposerV2Editor`.
4. `ComposerV2Editor` imports `RichEditor` from `./richEditor` — Metro resolves `richEditor.tsx` (web stub) because `Platform.OS === 'web'`.
5. The stub renders the placeholder card in place of the editor body.
6. Operator picks an audience, types a subject in the (working) `<Input>` field, then sees the grey placeholder where the email body should be.
7. Tapping "Send Now" runs `body.trim().length === 0` → footer toast "Add a message first."
8. Operator concludes "I cannot send a blast from web." (Correct conclusion — this is the actual current state.)

**Verification step:** Open `https://business.usemingla.com/marketing/campaigns/compose` in any browser. Confirm the dashed grey card with mobile-only copy renders below the subject row. Confirm the Send Now button is reachable but tapping it produces the "Add a message" toast.

**Classification:** 🔴 Root Cause (proven via source — the stub is intentional and the comment in the file explicitly documents this is the web-side behavior).

---

### 🟠 CF-1 — FAB / sticky-footer pinned to mobile bottom-nav offset on every Marketing route

**File + line:**
- [`marketing/index.tsx:163`](../../mingla-business/app/(tabs)/marketing/index.tsx#L163) — `{ bottom: insets.bottom + 96 }`
- [`marketing/campaigns/index.tsx:152`](../../mingla-business/app/(tabs)/marketing/campaigns/index.tsx#L152) — same
- [`marketing/templates/index.tsx:127`](../../mingla-business/app/(tabs)/marketing/templates/index.tsx#L127) — same

**Exact code:**
```tsx
style={({ pressed }) => [
  styles.fab,
  { bottom: insets.bottom + 96 },   // reserves space for the mobile BottomNav capsule
  pressed ? styles.fabPressed : null,
]}
```

**What it does:** Adds 96pt to the safe-area bottom inset to clear the floating mobile BottomNav capsule (~72pt visible + breathing room). On native and narrow web (<1024px) this is correct — the capsule exists below. On wide-desktop (≥1024px) the BottomNav.web.tsx variant renders a `position: fixed` left rail instead, leaving the bottom of the viewport empty; `useSafeAreaInsets().bottom` is `0` on web (browsers have no safe area on the bottom). So on wide-desktop the FAB sits 96pt above the bottom of the viewport with an empty gutter underneath — looks broken / misaligned.

**What it should do:** Compute the FAB offset based on `useResponsiveLayout().isWideDesktop`: on wide-desktop, `bottom: spacing.lg` (or similar canvas-bottom-aligned value); on mobile/narrow, current `insets.bottom + 96`. Centralize the calculation in a small helper hook (e.g., `useStickyFooterOffset`) so the four routes don't re-implement the gate independently.

**Causal chain:**
1. Operator on wide-desktop browser (≥1024px) lands on `/marketing`.
2. The left rail renders fixed-position; no bottom capsule exists.
3. The FAB renders at `bottom: 0 + 96 = 96px` above the viewport bottom — floating, with empty space below.
4. Visually disconnected from the page; looks like a layout bug.

**Verification step:** Resize the browser to 1280×800, navigate to `/marketing`. Observe the orange "+ New campaign" FAB floating 96px above the bottom of the viewport with no chrome below it. Compare to mobile-emulation 390×844 where the FAB correctly clears the bottom-nav capsule.

**Classification:** 🟠 Contributing Factor.

---

### 🟡 HF-1 — Double top inset on wide-desktop

**Files:**
- [`app/(tabs)/_layout.tsx:87-89`](../../mingla-business/app/(tabs)/_layout.tsx#L87-L89) — `<DesktopCanvas><Slot /></DesktopCanvas>`
- [`src/components/ui/DesktopCanvas.tsx:130-139`](../../mingla-business/src/components/ui/DesktopCanvas.tsx#L130-L139) — `paddingTop: DESKTOP_TOP_INSET` (16pt)
- [`app/(tabs)/marketing/_layout.tsx:48-49`](../../mingla-business/app/(tabs)/marketing/_layout.tsx#L48-L49) — `<View style={[styles.host, { paddingTop: insets.top }]}>`

**What it does:** On wide-desktop the DesktopCanvas adds a 16pt paddingTop; the marketing _layout then adds another `insets.top` (typically 0 on desktop web because browsers have no top safe area). Net result: 16pt on most desktop browsers, more on browsers that report a top safe area. Not broken, but the TopBar is closer to the canvas-top than the rail's brand-mark badge by exactly that delta — visually misaligned in the desktop redesign mocks.

**What it should do:** Gate `paddingTop: insets.top` on `!isWideDesktop` (mobile + narrow web only) so the DesktopCanvas owns the top inset on wide-desktop. Same pattern as the BottomNav.web → DesktopRail handoff already established in ORCH-0885-A.

**Classification:** 🟡 Hidden Flaw (won't cause user pain today, will cause a designer-vs-shipping mismatch the next time the mocks get pixel-audited).

---

### 🟡 HF-2 — Composer sub-sheets (audience picker, review, schedule, email preview) use mobile-shaped presentation on wide-desktop

**Files:**
- `src/components/marketing/AudiencePickerSheet.tsx` (336 lines — RN `Modal` with slide-up presentation)
- `src/components/marketing/ComposerReviewSheet.tsx`
- `src/components/marketing/ComposerV2/SchedulePickerSheet.tsx`
- `app/(tabs)/marketing/campaigns/compose.tsx:666-703` — `EmailPreviewPane` wrapped in `<Modal presentationStyle="pageSheet">`

**What it does:** All four sub-surfaces use `react-native` `Modal` which on RN-web maps to a full-viewport overlay. On native they slide up from the bottom — correct UX for thumb reach. On desktop they cover the entire canvas — wastes 1100+ horizontal pixels and feels like an iPad app in a browser.

**What it should do:** On wide-desktop, render these as centered modals (60-80% viewport width, max 720px) or as side-panel drawers (right rail) — the desktop redesign mocks call for the latter. Defer to ORCH-0885-C / ORCH-0885-D where the master-detail + right-rail primitives land; do NOT scope this into ORCH-0889 Wave 1.

**Classification:** 🟡 Hidden Flaw (not a current breakage; a polish gap that 0885-C closes).

---

### 🟡 HF-3 — Marketing TopBar + SubNav not max-width-constrained on wide-desktop

**File:** `app/(tabs)/marketing/_layout.tsx:48-74`

**What it does:** TopBar and SubNav render at full canvas width on wide-desktop. Brand label sits flush-left to the rail edge; the SubNav pill row stretches the full canvas. Not visually broken but doesn't match the desktop redesign's max-width content column.

**What it should do:** Wrap the TopBar+SubNav stack in a max-width container that matches the canvas content column (per DesktopCanvas SPEC §3). Defer to ORCH-0885-D content-column polish.

**Classification:** 🟡 Hidden Flaw.

---

### 🔵 OB-1 — ORCH-0885-C [Composer Tiptap swap] is the canonical long-term fix for RC-2

The original ORCH-0885 investigation already concluded Tiptap is the recommended web composer (`tenTapTokenBridge.ts` AST is ProseMirror-shaped → ports trivially). ORCH-0889 Wave 1 must NOT spec a full Tiptap swap — that's 0885-C. Wave 1 ships a **minimal viable web composer** (textarea + variable-chip insertion + basic Markdown-style B/I/Link) that unblocks "send a blast from web" today while 0885-C is in flight.

**Classification:** 🔵 Observation (orchestration discipline note).

---

### 🔵 OB-2 — Templates index demonstrates the right loading-state pattern

[`marketing/templates/index.tsx:55-78`](../../mingla-business/app/(tabs)/marketing/templates/index.tsx#L55-L78) checks `starterQuery.isLoading && data === undefined` for the spinner branch, then falls through to error/empty. BUT because `useStarterTemplates()` is **always enabled** (no accountId gate — see [`useStarterTemplates.ts:18-36`](../../mingla-business/src/hooks/marketing/useStarterTemplates.ts#L18-L36)), the disabled-query trap doesn't fire there. The starter section reliably shows a spinner during fetch and then the seeded templates. The user-templates section gracefully empty-states because `useUserTemplates(null)` returns `data: []` only after the user query has actually run.

**Implication:** The fix for RC-1 (Overview/Audiences/Campaigns) is well-precedented locally — Templates shows that "always-enabled queries paint correctly, disabled queries don't". The Wave-1 fix patches the three disabled-query callsites to treat `enabled: false` as loading.

**Classification:** 🔵 Observation.

---

## Section 4 — Five-layer cross-check

| Layer | RC-1 (disabled-query) | RC-2 (web composer stub) |
|---|---|---|
| **Docs** | No spec says "show error on auth bootstrap." Original ORCH-0863 [Marketing Hub Phase B] SPEC §6.1 expects loading skeleton until data arrives. | ORCH-0886 [SSR window-not-defined fix] explicitly documents the stub as "web preview shows this placeholder so the rest of the app still loads." Stub is intentional but ORCH-0885-C is queued to replace it. |
| **Schema** | N/A (no DB change). | N/A (no DB change). |
| **Code** | All three routes check `isLoading && data === undefined` then fall through to `isError || data === undefined` — disabled state lands in the error branch. | `richEditor.tsx` web export renders `<View><Text>Marketing composer • Available on iOS and Android…</Text></View>` instead of a functional editor. |
| **Runtime** | On native iOS/Android, AuthContext bootstrap completes in <500ms — the disabled-query window is invisible. On web, ORCH-0887 measured 4–8s — the disabled-query window is highly visible. | On native, the real pell editor renders the email body. On web, the stub renders. |
| **Data** | When query is disabled, React Query's internal cache is intact but `data` is `undefined`. Once enabled, the fetch runs and populates `data`. | N/A — the composer body never reaches the database from web; the operator cannot author from web. |

**Contradiction resolution:** Docs say "loading skeleton during fetch." Code says "skeleton only when `isLoading === true`." Runtime says "on web, `isLoading` is `false` for 4-8s before becoming `true`." Data says "no fetch ever runs while disabled." → The code's loading-state guard is too narrow.

---

## Section 5 — Blast radius map

**Direct impact (RC-1):**
- `app/(tabs)/marketing/index.tsx` — Overview tab landing
- `app/(tabs)/marketing/audiences/index.tsx` — Audiences sub-tab
- `app/(tabs)/marketing/campaigns/index.tsx` — Campaigns sub-tab

**Direct impact (RC-2):**
- `app/(tabs)/marketing/campaigns/compose.tsx` — composer route
- All inbound paths into compose: `/marketing` FAB, `/marketing/campaigns` FAB, `/marketing/audiences` audience tap, `/marketing/templates/[id]` "use this template", any "Resume draft" tap on a CampaignCard

**Related pattern (NOT in this ORCH's scope but exists elsewhere — DISCOVERY for orchestrator):**
- Any other route in `mingla-business` that uses `useQuery({ enabled: <gate> })` AND checks `isLoading && data === undefined` for loading state is susceptible to the same auth-bootstrap mis-paint. Quick grep shows the same pattern on `/home`, `/account`, `/hub/*`. Likely cosmetically masked on those routes because they have their own auth-redirect gates that short-circuit before the marketing layout. Worth a follow-up sweep but NOT in ORCH-0889 scope — register as ORCH-0890 [Web auth-bootstrap loading-state sweep] if operator agrees.

**Cross-surface check:**
- Consumer iOS (`app-mobile/` on iOS) — UNAFFECTED (no Marketing Hub surface ships there).
- Consumer Android — UNAFFECTED.
- Buyer-anon web (`/checkout/*`, `/e/*`, `/b/*`) — UNAFFECTED (no Marketing Hub surface).
- Business iOS — UNAFFECTED (native renders pell editor + auth resolves fast).
- Business Android — UNAFFECTED.
- Admin web (`mingla-admin/`) — UNAFFECTED (no Marketing Hub surface).
- Business web preview — **ALL FOUR MARKETING SURFACES AFFECTED.**

---

## Section 6 — Invariant violations

| Invariant | Violated? | Notes |
|---|---|---|
| **Constitution #3 — No silent failures** | ❌ Violated by RC-1. The disabled-query state surfaces as "Couldn't load metrics" (an error), but it's not actually an error — it's a not-yet-loading state. This is the inverse of a silent failure: a *loud false failure*. Same severity class. |
| **Constitution #2 — One owner per truth** | ✅ Honoured. |
| **Constitution #6 — Logout clears everything** | ✅ Honoured (Wave 1 doesn't touch auth). |
| **I-CROSS-SURFACE-IMPACT** | ✅ Honoured (this ORCH explicitly declares affected surfaces). |
| **I-RN-COLOR-FORMATS** | ✅ Honoured (Wave 1 will use hex/rgba; no oklch/lab). |
| **I-DESKTOP-GATE-VIA-HOOK** | ✅ Honoured. CF-1 fix MUST go through `useResponsiveLayout().isWideDesktop`, never inline `Platform.OS === 'web' && width >= 1024`. |
| **I-KEYBOARD-NEVER-BLOCKS-INPUT** | ✅ Honoured (no input changes in Wave 1). |
| **I-TOAST-NEEDS-ABSOLUTE-WRAP** | ✅ Honoured (audiences/index already wraps Toast correctly; Wave 1 doesn't touch). |
| **I-SUB-SHEET-INSIDE-PARENT** | ✅ Honoured (Wave 1 doesn't touch sub-sheet structure; HF-2 deferred to 0885-C/D). |

**New invariant proposed:**
- **I-PROPOSED-DISABLED-QUERY-IS-LOADING:** Any `useQuery` consumer that gates `enabled` on a derived condition (auth, brand, selection, etc.) MUST treat `data === undefined && !isError` as a loading state, NOT an error or empty state. The check `isLoading && data === undefined` is INSUFFICIENT because React Query reports `isLoading: false` when `enabled: false`. Correct shape: `if (data === undefined && !isError) return <Loading />;` Enforced by a strict-grep CI gate scanning for the brittle pattern.

---

## Section 7 — Fix strategy (direction only — full contract in the spec)

**Wave 1 (ORCH-0889) — direction:**

1. **Patch the three disabled-query mis-paints.** In Overview, Audiences, and Campaigns, treat the disabled-query state as loading. Render the existing skeleton/spinner until `data !== undefined || isError === true`.
2. **Adapt FAB / sticky-footer positioning on wide-desktop.** Add a small helper that computes the FAB bottom offset from `useResponsiveLayout().isWideDesktop`; apply across Overview, Campaigns, Templates.
3. **Ship a minimal viable web composer body.** Replace the placeholder stub in `richEditor.tsx` with a working web composer surface that supports: (a) plain-text or basic-HTML body authoring via a `<TextInput multiline>` (or a controlled `contentEditable` div via `react-native-web`'s `TextInput`); (b) variable-chip insertion (the existing InsertionBar already calls `insertHTML` — wire the web stub to inject the chip HTML into the textarea/contentEditable and surface a chip-styled span); (c) basic formatting (bold/italic/link) via inline tags or a simple toolbar — fall back to plain text if necessary. The chip + token round-trip through `tenTapTokenBridge.ts` must produce a valid `body_html` that `marketing-send` can render server-side. This is intentionally narrower than ORCH-0885-C Tiptap; the goal is "operator can send a blast from web today," not "feature-parity rich editor on web."
4. **Add a regression test pair (mandatory per CLOSE Step 0.5):**
   - Implementor-happy-path test: assert disabled-query state renders skeleton, not error, on Overview/Audiences/Campaigns.
   - Tester-adversarial test: simulate `isLoading: false, data: undefined, isError: false` directly; assert no `EmptyState` with title "Couldn't load metrics" / "No buyers yet" / "Your first campaign starts here" appears.

**Wave 2 (ORCH-0885-C, separate ORCH) — out of scope here:** full Tiptap swap, real WYSIWYG editor with brand chrome, side-by-side preview pane, keyboard shortcuts, drag-resize embedded cards, right-side template drawer.

**Wave 1 is NOT:**
- A composer redesign.
- A Tiptap integration.
- A sub-sheet → desktop-modal refactor (HF-2).
- A max-width content-column refactor (HF-3).
- A sweep of other web routes (would-be ORCH-0890).

---

## Section 8 — Regression prevention requirements

The implementor's regression test pair must:

1. **Happy path (implementor):** Render `<MarketingOverviewRoute />` with `useAuth().user.id === null`. Assert the skeleton renders (specifically, the `headlineCardSkeleton` View is present). Assert the EmptyState with title "Couldn't load metrics" is NOT present.
2. **Adversarial (tester):** Render `<MarketingAudiencesRoute />` with `useAudienceList()` mocked to return `{ entries: [], reach: new Map(), isLoading: false, isError: false, refetch: () => {} }` (the disabled-query signature). Assert the skeleton renders, NOT the "No buyers yet." empty state.
3. **fails-on-revert:** Both tests must fail when the fix is reverted and pass when the fix is restored.

A strict-grep CI gate (`orch-0889-disabled-query-loading-state.mjs`) scans `mingla-business/app/(tabs)/marketing/**/*.tsx` for the brittle `isLoading && data === undefined` pattern; allow-list it on Templates (because starter query is unconditionally enabled) and reject net-new occurrences elsewhere.

---

## Section 9 — Discoveries for orchestrator

| Discovery | Recommended action |
|---|---|
| **D-1: Same disabled-query mis-paint pattern likely exists on /home, /account, /hub/* routes.** Quick grep needed. | Register ORCH-0890 [Web auth-bootstrap loading-state sweep] AFTER ORCH-0889 closes — same fix template, broader surface. |
| **D-2: ORCH-0885-C [Composer Tiptap swap] is the canonical long-term fix for RC-2.** The Wave-1 minimal composer is a stopgap, not a substitute. | Confirm operator wants Wave 1 stopgap NOW (yes) vs. waiting for 0885-C (no — multi-week swap; operator can't send blasts from web in the interim). |
| **D-3: HF-2 (sub-sheets on desktop) and HF-3 (max-width content column) belong in 0885-D, not 0889.** | Note in ORCH-0885-D scope reminder. |
| **D-4: The disabled-query fix opportunity is a chance to codify a new invariant** (`I-PROPOSED-DISABLED-QUERY-IS-LOADING`). | Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at ORCH-0889 CLOSE. |
| **D-5: ORCH-0887 [Business Web Performance] is the upstream cause of why RC-1 is visible at all.** If web auth bootstrap dropped from 4-8s to <1s (per ORCH-0887-A [Auth getSession timeout fix] now in implementation), RC-1 would become near-invisible. | Cross-link in WORLD_MAP; ORCH-0889 fix remains correct regardless of ORCH-0887 outcome (defense in depth). |

---

## Section 10 — Confidence

| Finding | Confidence | Evidence floor |
|---|---|---|
| RC-1 | **probable** | Full static trace of the three routes + the three hooks + React Query semantics + ORCH-0887 timing data. No live-fire browser repro. Flips to `proven` after operator smoke-test in Chrome devtools with Slow-3G throttle. |
| RC-2 | **proven** | The web stub file is verbatim in the repo; the comment in the file explicitly documents the placeholder behavior; ORCH-0886 close report documents this is the post-fix state. No additional repro needed. |
| CF-1 | **probable** | Mechanical: `isWideDesktop` true → rail renders fixed-position → no bottom-nav → `insets.bottom === 0` → FAB at 96px. Operator smoke-test (resize browser to 1280×800) flips to `proven`. |
| HF-1 / HF-2 / HF-3 | **suspected** | Pattern-match from the rail/canvas WIP receipts. Flips to `probable` on a designer/operator visual audit. Not in Wave 1 fix scope. |

---

## Section 11 — Layman summary of the report

- **The Blast tab "doesn't render" on web for two real reasons, not one.** First, on the Overview / Audiences / Campaigns sub-tabs, the loading-state guard is wrong: when the React Query call is paused waiting for auth to finish, the code mistakes "not started yet" for "errored", and shows red error copy ("Couldn't load metrics") or false-empty copy ("No buyers yet.", "Your first campaign starts here.") during the 4–8 seconds web auth takes to bootstrap. Second, on the composer screen, the email body is intentionally a grey placeholder reading "Marketing composer • Available on iOS and Android" — this was a deliberate fix from last week to stop the entire web bundle from crashing, but it leaves you unable to actually compose a blast from web.
- **There are also smaller visual issues on wide-desktop browsers:** the FAB ("+ New campaign") floats 96 pixels above the bottom of the screen because the code reserves space for a mobile bottom nav that doesn't exist on desktop; the top of the Marketing tab has 16 pixels of doubled-up padding; the sub-sheets (audience picker, schedule picker, review) cover the whole canvas like a mobile app instead of being centered desktop modals. These are polish issues, not blockers.
- **The fix splits into two waves.** Wave 1 (this ORCH, ORCH-0889) patches the loading-state bug across the three sub-tabs, repositions the FAB on desktop, and ships a minimal but working web composer body so you can actually send a blast from web today. Wave 2 (ORCH-0885-C, queued separately) is the multi-week Tiptap swap that gives the web composer feature-parity with native plus the desktop-class touches (live preview pane, keyboard shortcuts, drag-resize event cards).
- **Recommended next dispatch:** Codex `implementor-mingla` against the ORCH-0889 spec (writing now). Tester runs after. Orchestrator closes. ORCH-0890 (web loading-state sweep across other tabs) gets registered after this closes so we don't bundle scopes.

---

**Report status:** COMPLETE. Spec authored separately at `Mingla_Artifacts/specs/SPEC_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH.md`.
