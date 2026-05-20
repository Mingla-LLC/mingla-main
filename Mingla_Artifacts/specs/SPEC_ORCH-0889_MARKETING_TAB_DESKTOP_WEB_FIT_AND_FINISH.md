# SPEC — ORCH-0889 [Marketing tab desktop-web fit-and-finish]

**Mode:** `mingla-forensics` SPEC
**Tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Author:** Claude `mingla-forensics`
**Linked investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH.md`](../reports/INVESTIGATION_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH.md)
**Severity:** S1-high
**Estimated implementor effort:** 0.5–1 day (mechanical patches + minimal-composer scaffold; no DB, no edge function changes)
**ORCH-0885-C [Composer Tiptap swap] relationship:** Wave-1 stopgap. The minimal web composer this spec ships is intentionally narrow scope and MUST be designed so 0885-C can replace it cleanly (no DB / token-bridge / send-pipeline changes; web stub is the only swap point).

---

## Section 1 — Scope and non-goals

### In scope (this ORCH)

1. **Patch the disabled-query mis-paint** on three marketing routes so the loading skeleton renders during auth bootstrap instead of an error / false-empty state.
2. **Fix the FAB / sticky-footer positioning on wide-desktop** so it sits in the canvas-bottom-aligned position, not 96pt above the viewport floor.
3. **Replace the composer's web stub** with a minimal viable web composer that lets an operator author + send an email blast from web today. Plain-text body with variable-chip insertion + basic Markdown-style bold/italic/link via a minimal toolbar. NO Tiptap, NO ProseMirror.
4. **Add a new invariant + strict-grep CI gate** to prevent the disabled-query pattern from recurring.
5. **Write regression tests** (happy-path + adversarial) per the CLOSE Step 0.5 gate.

### Non-goals (explicit; do NOT touch)

- ❌ Tiptap / ProseMirror integration → ORCH-0885-C.
- ❌ Sub-sheet → desktop-modal refactor (HF-2) → ORCH-0885-D right-rail polish.
- ❌ TopBar+SubNav max-width content column (HF-3) → ORCH-0885-D.
- ❌ Sweep of `/home`, `/account`, `/hub/*` for the same disabled-query pattern (D-1) → ORCH-0890 (new ORCH after this closes).
- ❌ Any change to `marketing-send` edge function, `marketingCampaignService`, `tenTapTokenBridge`, or any DB schema.
- ❌ Any change to native (iOS/Android) composer surface — `richEditor.native.ts` stays exactly as-is.
- ❌ Any haptic / animation / motion polish on the new composer body.
- ❌ Account / TopBar / rail visual changes — those landed in ORCH-0885-A.
- ❌ Auth-bootstrap performance work (ORCH-0887-A is separate).

### Assumptions

- ORCH-0886 web stub strategy stays in place (platform-split `richEditor.tsx` vs `richEditor.native.ts`). This SPEC only modifies the web side.
- React Query v5 semantics (`isPending` exists; `isLoading` is FALSE when `enabled: false`). Verified via `mingla-business/package.json` — TanStack Query v5.
- `useResponsiveLayout().isWideDesktop` is the single source of truth for desktop gating (per I-DESKTOP-GATE-VIA-HOOK).
- The minimal composer's `body_html` output must be compatible with the existing `marketing-send` edge function (which today consumes the pell-generated HTML on native). Plain `<p>`, `<strong>`, `<em>`, `<a href>`, plus variable-chip spans (the same `composerChipHtml` markup the InsertionBar already produces) is sufficient.

---

## Section 2 — Cross-Surface Impact (MANDATORY per Phase 2.5)

| Surface | In scope? | What changes |
|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | ❌ Not in scope | No Marketing Hub surface ships there. No change. |
| Consumer Android | ❌ Not in scope | Same as above. |
| Buyer/anonymous Web (`/checkout/*`, `/e/*`, `/b/*`) | ❌ Not in scope | No Marketing Hub surface. No change. |
| Business iOS (`mingla-business/` on iOS) | ❌ Not in scope | `Platform.OS === 'ios'` resolves `richEditor.native.ts`. No web stub touched on native. No `useResponsiveLayout().isWideDesktop` branch fires on iOS. Loading-state guards unchanged on iOS behavior because auth bootstrap is <500ms (window invisible). |
| Business Android | ❌ Not in scope | Same as iOS — `richEditor.native.ts` resolves; no wide-desktop branch. |
| Admin Web (`mingla-admin/`) | ❌ Not in scope | No Marketing Hub surface. |
| **Business Web preview (`mingla-business/` dev/web build) — wide-desktop ≥1024px** | ✅ **IN SCOPE** | (a) Loading skeleton renders during auth bootstrap on Overview / Audiences / Campaigns. (b) FAB sits at canvas-bottom-aligned position on wide-desktop. (c) Minimal composer body renders in place of the placeholder card. (d) Operator can author and send a blast end-to-end. |
| **Business Web preview — narrow web < 1024px** | ✅ **PARTIAL** | Loading-state and composer fixes apply; FAB positioning fix only applies on wide-desktop branch (narrow web keeps the current `insets.bottom + 96` for the mobile capsule). |

**Parity matrix.** Because the loading-state and composer fixes both ship via shared code paths that branch on `Platform.OS === 'web'` and `useResponsiveLayout().isWideDesktop`, parity is automatic — there is no separate "web wide" vs "web narrow" code path. Native is BIT-IDENTICAL to today (regression-tested via SC-7 below).

---

## Section 3 — Layer-by-layer specification

### 3.1 Database layer

❌ **No changes.** No migrations, no RLS, no new columns.

### 3.2 Edge function layer

❌ **No changes.** `marketing-send`, `marketing-track-click`, `marketing-unsubscribe`, `start-stripe-checkout`, all unchanged.

### 3.3 Service layer

❌ **No changes** to `marketingCampaignService.ts`, `marketingRenderingService.ts`, `tenTapTokenBridge.ts`, `brandEvents.ts`, or any other service. The minimal web composer's `body_html` output must be a STRICT SUBSET of what `tenTapTokenBridge.htmlToTokenString` already accepts on native.

### 3.4 Hook layer

❌ **No changes** to React Query hook structure (`useMarketingOverview`, `useCampaigns`, `useAudienceList`, `useUserTemplates`, `useStarterTemplates`). The hooks already return the right shape; the routes consume it incorrectly.

Verify post-change: each hook still returns `{ data, isLoading, isError, refetch }` (or equivalent for `useAudienceList`). No new fields.

### 3.5 Component / Route layer

#### 3.5.1 New helper hook

**File:** `mingla-business/src/hooks/useStickyFooterOffset.ts` (NEW)
**Purpose:** Centralize the FAB / sticky-footer bottom offset calculation. Returns the offset in pt.

```ts
import { useResponsiveLayout } from "./useResponsiveLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MOBILE_BOTTOM_NAV_RESERVE = 96;       // bottom-nav capsule (~72pt) + 24pt breathing
const DESKTOP_CANVAS_BOTTOM_PADDING = 24;   // canvas-bottom-aligned spacing.lg

/**
 * useStickyFooterOffset — single source of truth for FAB / sticky-footer
 * bottom positioning across the app.
 *
 * On native + narrow web (<1024px): `safeAreaBottom + 96` — clears the
 * floating BottomNav capsule.
 * On wide-desktop (≥1024px): 24pt — canvas-bottom-aligned. The fixed-left
 * rail does not consume bottom space.
 *
 * Per ORCH-0889 [Marketing tab desktop-web fit-and-finish] §3.5.1.
 * Enforced via strict-grep CI gate `orch-0889-sticky-footer-via-hook.mjs`.
 */
export function useStickyFooterOffset(): number {
  const { isWideDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  return isWideDesktop ? DESKTOP_CANVAS_BOTTOM_PADDING : insets.bottom + MOBILE_BOTTOM_NAV_RESERVE;
}
```

**No tests required for the hook itself** — its consumers' tests cover both branches.

#### 3.5.2 Marketing Overview route

**File:** `mingla-business/app/(tabs)/marketing/index.tsx`
**Edits:**

(a) Replace the loading-state guard (lines 61–90):

```tsx
// BEFORE:
if (overviewQuery.isLoading && overviewQuery.data === undefined) { /* skeleton */ }
if (overviewQuery.isError || overviewQuery.data === undefined) { /* error */ }

// AFTER (ORCH-0889 §3.5.2):
// Auth-bootstrap window: query is disabled (enabled=false → isLoading=false) but
// data is still undefined. Treat as loading, not error. Per I-PROPOSED-DISABLED-
// QUERY-IS-LOADING.
if (overviewQuery.data === undefined && !overviewQuery.isError) {
  return <View style={styles.host}><ScrollView contentContainerStyle={styles.scrollContent}>
    <View style={styles.headlineCardSkeleton}><ActivityIndicator size="small" color={textTokens.secondary} /></View>
    <View style={styles.metricGrid}>{[0,1,2,3].map((idx) => <View key={idx} style={styles.metricSkeleton} />)}</View>
  </ScrollView></View>;
}
if (overviewQuery.isError) {
  return <View style={styles.host}><View style={styles.centerHost}>
    <EmptyState illustration="users" title="Couldn't load metrics" description="Pull to retry, or come back in a moment." />
  </View></View>;
}
```

(b) Replace FAB offset (line 163):

```tsx
// BEFORE: { bottom: insets.bottom + 96 }
// AFTER (ORCH-0889 §3.5.1):
const fabOffset = useStickyFooterOffset();
// ...
{ bottom: fabOffset }
```

Remove the `useSafeAreaInsets` import if no other usage remains in this file.

#### 3.5.3 Marketing Audiences route

**File:** `mingla-business/app/(tabs)/marketing/audiences/index.tsx`
**Edits:**

Replace the loading guard (lines 83–123). Current shape returns three different states (loading skeleton with entries.length===0; error empty-state; "No buyers yet." empty-state). The disabled-query state falls into the third (false-empty). New shape:

```tsx
// AFTER (ORCH-0889 §3.5.3):
// Disabled (auth bootstrap) OR loading first-paint → skeleton.
// Distinct from a real "no audiences yet" state, which requires data to have actually loaded.
if (listState.entries.length === 0 && !listState.isError && listState.isLoading) {
  // Already-handled by existing skeleton branch — keep as-is.
}
// NEW: disabled-but-no-error → skeleton (same JSX as existing skeleton branch).
// The signal is "isLoading is false (so not actively fetching) AND data has never
// arrived (entries empty) AND no error". This is the auth-bootstrap state.
if (listState.entries.length === 0 && !listState.isError && !listState.isLoading && !listState.hasResolved) {
  return <View style={styles.host}><ScrollView contentContainerStyle={styles.scrollContent}>
    <Text style={styles.sectionLabel}>YOUR AUDIENCES</Text>
    <Text style={styles.sectionCaption}>Auto-updated as people buy tickets.</Text>
    {[0,1,2].map((i) => <View key={i} style={styles.cardSkeleton} />)}
  </ScrollView></View>;
}
```

**NOTE TO IMPLEMENTOR:** `useAudienceList` does NOT currently return `hasResolved`. Two options:
- **Option A (preferred):** Extend `useAudienceList` to return `hasResolved: query.isFetched` (React Query `isFetched` is `true` once the query has resolved at least once, regardless of cache state). Then the route uses `if (!listState.hasResolved && entries.length === 0 && !isError) return skeleton;`.
- **Option B:** Use `query.fetchStatus !== 'idle'` to detect "in flight"; combined with `entries.length === 0` covers both disabled and first-fetch cases.

The implementor picks the cleaner one and applies the same pattern across Overview / Campaigns. Document the choice in the implementation report.

#### 3.5.4 Marketing Campaigns route

**File:** `mingla-business/app/(tabs)/marketing/campaigns/index.tsx`
**Edits:** Same pattern as Audiences. Currently (lines 106-126) the disabled-query state falls into "Your first campaign starts here" empty state. Replace with:

```tsx
// AFTER (ORCH-0889 §3.5.4):
{campaigns.length === 0 && !campaignsQuery.hasResolved && !campaignsQuery.isError ? (
  <View style={styles.centerHost}><ActivityIndicator size="small" color={textTokens.secondary} /></View>
) : campaignsQuery.isError ? (
  <View style={styles.centerHost}><EmptyState illustration="users" title="Couldn't load campaigns" description="Pull to retry, or come back in a moment." /></View>
) : campaigns.length === 0 ? (
  <View style={styles.centerHost}><EmptyState illustration="users" title="Your first campaign starts here" description="Tap + below to write an email to your buyers." /></View>
) : (
  <ScrollView>{campaigns.map((c) => <CampaignCard … />)}</ScrollView>
)}
```

Also patch FAB offset (line 152) to use `useStickyFooterOffset()`.

#### 3.5.5 Marketing Templates route

**File:** `mingla-business/app/(tabs)/marketing/templates/index.tsx`
**Edits:** No loading-guard change needed (starter query is always-enabled — see investigation OB-2). Only patch FAB offset (line 127) to use `useStickyFooterOffset()`.

#### 3.5.6 Minimal web composer body — `richEditor.tsx` rewrite

**File:** `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx`
**Edits:** Replace the placeholder stub with a working minimal web composer.

**Surface contract (must stay in sync with `richEditor.native.ts`):**
- `RichEditor` (class component with imperative ref API)
- `actions` (constants export)

**Web implementation requirements:**

1. **Backing store:** an internal `<TextInput multiline />` (RN-web maps to `<textarea>`). Use the `Input` primitive from `src/components/ui/Input.tsx` already imported by `ComposerV2Editor`. Keep `html` state as a React state value seeded from `props.initialContentHTML` (or whatever prop name `pell-rich-editor` exposes — match the native side).

2. **Imperative API:** the existing 5 ref methods must produce equivalent behavior on web:
   - `commandDOM(js)`: NO-OP on web (only used by native for WebView JS injection — never called from product code today). Document as no-op.
   - `insertHTML(html)`: Insert the HTML fragment at the current cursor position in the textarea. Strategy: use the textarea's `selectionStart`/`selectionEnd`, splice the HTML string in, fire `onChange`. The InsertionBar inserts variable-chip spans (`<span class="mingla-chip" data-token="first_name">{{first_name}}</span>`) and event-chip spans (`<span class="mingla-event-chip" data-event-id="…">…</span>`) — the textarea displays the raw markup, which is acceptable for the minimal web composer (operator sees `<span>...</span>` markup but the preview pane renders correctly). **OR (preferred):** wrap the textarea in a thin "tokenized display" layer that renders chips as styled pills overlaying the text, with the raw HTML stored in state. This is the polish target; if implementor scope is tight, ship the raw-markup version and register a follow-up polish ORCH.
   - `setContentHTML(html)`: Replace the entire textarea value with `html`, fire `onChange`.
   - `sendAction(action, name?, value?)`: Map the action constants:
     - `actions.setBold` → wrap selection in `<strong>…</strong>` (or `**…**` if implementor chooses Markdown — must round-trip to the same `body_html` server-side).
     - `actions.setItalic` → wrap selection in `<em>…</em>`.
     - `actions.insertLink` → uses `insertLink` (see below) — `sendAction(actions.insertLink, name, value)` is the native invocation pattern; on web, treat as a passthrough.
     - All other actions (heading1, lists, sub/superscript, code, etc.) → NO-OP (graceful degradation; logged once to console via `__DEV__` warn).
   - `insertLink(text, url)`: Insert `<a href="url">text</a>` at cursor.

3. **Render shape:**
   ```tsx
   <View style={styles.host}>
     <Input
       multiline
       value={internalHtml}
       onChangeText={handleChangeText}
       placeholder="Write your blast…"
       style={styles.textarea}
       textAlignVertical="top"
       onSelectionChange={handleSelectionChange}
       accessibilityLabel="Email body"
     />
   </View>
   ```
   The Input primitive already follows Mingla design tokens (glass tint, border, focus state).

4. **Minimum height:** 240pt (matches the native pell editor's default). `flex: 1` if parent is column-flex.

5. **onChange contract:** every keystroke fires `onChange(html)` via the existing imperative-handle callback wired in `ComposerV2Editor` (lines 100+). Body changes propagate to `compose.tsx` → `setBody(value)` → `setIsDirty(true)` → debounced `useComposerDraft` autosave. This contract already works on native; the web rewrite just needs to fire the same callback.

6. **Variable / event chips:** when the existing `InsertionBar` calls `editorHandleRef.current?.insertEvent(event)` or `insertPersonalization(token)`, the imperative handle in `ComposerV2Editor` calls `RichEditor.insertHTML(chipHtml)`. The web `insertHTML` writes the chip HTML at the current cursor into the textarea state. Result: the textarea displays the raw `<span class="…">{{first_name}}</span>` markup. The preview pane (`EmailPreviewPane`) renders the chip as a styled pill correctly because it consumes the same `body_html`.

7. **Subject row stays as-is** — already a working `<Input>` in `ComposerV2Editor`. No change.

8. **No `Modal`, no `WebView`, no DOM-direct manipulation outside RN-web primitives.** SSR-safe by construction (no `window.__DEV__` evaluation).

9. **Telemetry:** none new. Existing `useComposerDraft` autosave + `useScheduleCampaign` Send flow already report success/error toasts.

#### 3.5.7 Strict-grep CI gate

**File:** `.github/scripts/strict-grep/orch-0889-disabled-query-loading-state.mjs` (NEW)
**Purpose:** Reject the brittle `isLoading && data === undefined` pattern in marketing routes (and warn elsewhere).

```js
#!/usr/bin/env node
// ORCH-0889 [Marketing tab desktop-web fit-and-finish] §3.5.7
// Reject the brittle "isLoading && data === undefined" loading-state guard
// in marketing routes. Disabled queries (enabled=false) report isLoading=false,
// so the brittle pattern falls through to error/empty during auth bootstrap.
// Correct shape: `if (data === undefined && !isError)` or equivalent via
// query.fetchStatus / query.isFetched.

import { readFileSync } from "node:fs";
import { globSync } from "glob";

const MARKETING_ROUTES = "mingla-business/app/(tabs)/marketing/**/*.tsx";
const ALLOW_LIST = [
  // Templates route uses always-enabled starter query — safe.
  "mingla-business/app/(tabs)/marketing/templates/index.tsx",
];
const BRITTLE = /isLoading\s*&&\s*[\w?.]+\.data\s*===\s*undefined/;

const files = globSync(MARKETING_ROUTES);
const violations = [];
for (const f of files) {
  if (ALLOW_LIST.some((al) => f.endsWith(al.split("/").slice(-3).join("/")))) continue;
  const src = readFileSync(f, "utf8");
  if (BRITTLE.test(src)) violations.push(f);
}

if (violations.length > 0) {
  console.error("ORCH-0889: brittle `isLoading && data === undefined` pattern found:");
  for (const v of violations) console.error("  -", v);
  console.error(`\nUse \`data === undefined && !isError\` or \`!hasResolved && !isError\` instead.`);
  process.exit(1);
}
console.log("ORCH-0889 strict-grep PASS");
```

**Wire into:** `.github/workflows/strict-grep-mingla-business.yml` as one script + one job per `feedback_strict_grep_registry_pattern.md`.

#### 3.5.8 New invariant

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`
**New row:**

> **I-DISABLED-QUERY-IS-LOADING** (ACTIVE post-ORCH-0889 close): Any React Query consumer that gates `enabled` on a derived condition (auth, brand, selection, etc.) MUST treat `data === undefined && !isError` as a loading state, NOT an error or empty state. The guard `isLoading && data === undefined` is INSUFFICIENT because React Query reports `isLoading: false` when `enabled: false`. Enforced by strict-grep CI gate `orch-0889-disabled-query-loading-state.mjs`. Rationale: web auth bootstrap takes 4–8s (per ORCH-0887 [Business Web Performance]); during that window the brittle guard surfaces false-error / false-empty states.

#### 3.5.9 Decision log entry

**File:** `Mingla_Artifacts/DECISION_LOG.md`
**New entry:**

> **DEC-XXX (ORCH-0889 close):** Wave-1 minimal web composer (textarea + chip-injection + basic B/I/Link) is a STOPGAP; ORCH-0885-C [Composer Tiptap swap] remains the canonical long-term web composer. The Wave-1 composer's `body_html` output is a strict subset of native pell output, ensuring `marketing-send` does not need a parallel render path. 0885-C may delete the Wave-1 composer in full when it lands.

### 3.6 Realtime

❌ **No realtime changes.**

---

## Section 4 — Success criteria

Per Phase 2.5 cross-surface impact, each criterion is named with a surface suffix where parity is manual.

| ID | Surface | Criterion | Test |
|---|---|---|---|
| SC-1 | Business-web (wide + narrow) | On Marketing Overview, during the auth-bootstrap window (user signed in but `useAuth().user?.id` still `null`), the loading skeleton renders (headline card + 4 metric squares with placeholder styling). The text "Couldn't load metrics" is NOT visible. | T-01 (happy unit), T-02 (adversarial unit) |
| SC-2 | Business-web | On Marketing Audiences, during the auth-bootstrap window, the section heading + caption + 3 skeleton cards render. The text "No buyers yet." is NOT visible. | T-03, T-04 |
| SC-3 | Business-web | On Marketing Campaigns, during the auth-bootstrap window, a spinner renders in the center. The text "Your first campaign starts here" is NOT visible. | T-05, T-06 |
| SC-4 | Business-web wide-desktop (≥1024px) | The FAB on Overview, Campaigns, and Templates sits at canvas-bottom-aligned 24pt offset (not 96pt). Verified visually + by reading the computed `bottom` style. | T-07 (snapshot/computed-style test) |
| SC-5 | Business-web wide + narrow | The composer route renders a functional `<TextInput multiline />` body where the operator can type plain text, paste content, and see characters appear. NO "Marketing composer • Available on iOS and Android" placeholder card. | T-08 (RTL render test), T-09 (manual smoke) |
| SC-6 | Business-web wide + narrow | Tapping the InsertionBar's variable button (e.g., "First name") inserts `{{first_name}}` (or the chip HTML) into the composer body at the cursor; `onBodyChange` fires; the autosave debounce kicks in. | T-10 (integration test), T-11 (manual smoke) |
| SC-7 | Business-iOS + business-Android | Native composer behavior is BIT-IDENTICAL to pre-ORCH-0889 — the pell editor still loads, all formatting works, no regression in subject/body/send flow. | T-12 (manual sim smoke, iOS sim + Android emu) |
| SC-8 | Business-web | An operator can author and send a real test blast end-to-end FROM WEB: pick audience → type subject → type body → tap Send Now → review sheet → confirm → success confirmation → campaign appears in `/marketing/campaigns` with status `sent`. | T-13 (manual e2e smoke on dev server) |
| SC-9 | Business-iOS + business-Android | Native pell composer's variable chips and event-card chips render the same `body_html` as the web composer (round-trip via `tenTapTokenBridge`). Verified by sending a blast from both surfaces and comparing the rendered email in the inbox preview. | T-14 (manual cross-surface smoke) |
| SC-10 | CI / repo-wide | Strict-grep CI gate `orch-0889-disabled-query-loading-state.mjs` passes on the post-fix branch; fails when any of the three marketing routes are reverted to the brittle pattern. | T-15 (CI run) |

---

## Section 5 — Invariants

### Invariants preserved (must verify post-implementation)

| ID | How preserved | Verification |
|---|---|---|
| Constitution #3 — No silent failures | The new disabled-query → loading state is a true loading state, not silence; real errors still surface via `isError` branch. | T-01, T-03, T-05 |
| Constitution #2 — One owner per truth | `useStickyFooterOffset` is the sole owner of FAB offset logic; replaces three inline calculations. | Code review + grep for `+ 96` in marketing routes |
| I-DESKTOP-GATE-VIA-HOOK | `useStickyFooterOffset` calls `useResponsiveLayout().isWideDesktop` — no inline `Platform.OS === 'web' && width >= 1024`. | Code review + strict-grep gate `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` already enforces |
| I-RN-COLOR-FORMATS | All new colors hex/rgba only — `Input` primitive already compliant. | T-08 visual review |
| I-KEYBOARD-NEVER-BLOCKS-INPUT | Composer textarea inherits `KeyboardAvoidingView` from the parent `compose.tsx`. No change. | T-09 manual smoke |
| I-CROSS-SURFACE-IMPACT | This SPEC explicitly enumerates surfaces in §2. | Operator review of §2 |

### New invariants established

| ID | Statement | Enforcement |
|---|---|---|
| **I-DISABLED-QUERY-IS-LOADING** | React Query consumers gating `enabled` on derived conditions MUST treat `data === undefined && !isError` as loading; the `isLoading && data === undefined` guard is forbidden in marketing routes. | Strict-grep CI gate `orch-0889-disabled-query-loading-state.mjs` |
| **I-STICKY-FOOTER-VIA-HOOK** | FAB / sticky-footer bottom offset MUST be sourced from `useStickyFooterOffset()`. Inline `insets.bottom + 96` for FAB positioning in `mingla-business/app/(tabs)/marketing/**/*.tsx` is forbidden. | Strict-grep CI gate `orch-0889-sticky-footer-via-hook.mjs` (NEW; mirror of `orch-0889-disabled-query-loading-state.mjs`) |

---

## Section 6 — Test cases

### 6.1 Implementor regression tests (Step 0.5 happy path — MANDATORY)

**File:** `mingla-business/app/(tabs)/marketing/__tests__/MarketingOverview.disabled-query.test.tsx` (NEW)

| Test | Scenario | Setup | Expected | fails-on-revert verified |
|---|---|---|---|---|
| T-01 | Disabled-query renders skeleton | Mock `useAuth` → `user: null`; mock `useMarketingOverview` → `{ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }`. Render `<MarketingOverviewRoute />`. | `getByTestId('overview-skeleton')` resolves; `queryByText("Couldn't load metrics")` returns null. | Yes (test fails if route guard reverted to `isLoading && data === undefined`) |

### 6.2 Tester adversarial regression tests (Step 0.5 adversarial — MANDATORY)

**File:** `mingla-business/app/(tabs)/marketing/__tests__/MarketingAudiences.disabled-query.adversarial.test.tsx` (NEW)

| Test | Scenario | Setup | Expected | Distinct angle from T-01? |
|---|---|---|---|---|
| T-02 | Audiences disabled-query does NOT show "No buyers yet." | Mock `useAudienceList` → `{ entries: [], reach: new Map(), isLoading: false, isError: false, refetch: jest.fn(), hasResolved: false }`. Render `<MarketingAudiencesRoute />`. | `queryByText('No buyers yet.')` returns null; skeleton present. | Yes — different route, different empty-state text, different hook shape (extends `useAudienceList` return type). |

### 6.3 Full test matrix

| ID | Scenario | Layer | File |
|---|---|---|---|
| T-01 | Overview disabled-query → skeleton (happy) | Component (RTL) | implementor test |
| T-02 | Audiences disabled-query → skeleton, NOT "No buyers yet" (adversarial) | Component (RTL) | tester test |
| T-03 | Audiences loaded → entries render | Component (RTL) | reuse existing if any, else add |
| T-04 | Audiences real error → "Couldn't load audiences" | Component (RTL) | implementor test |
| T-05 | Campaigns disabled-query → spinner | Component (RTL) | implementor test |
| T-06 | Campaigns loaded with 0 rows → "Your first campaign starts here" | Component (RTL) | implementor test |
| T-07 | FAB offset on wide-desktop = 24pt; on narrow web = `insets.bottom + 96` | Hook (`useStickyFooterOffset`) unit | implementor test |
| T-08 | Web composer body renders TextInput, NOT placeholder | Component (RTL) | implementor test |
| T-09 | Web composer accepts keystrokes and fires `onChange` | Component (RTL) | implementor test |
| T-10 | InsertionBar variable insert mutates composer body via imperative handle | Integration (RTL + ref) | implementor test |
| T-11 | InsertionBar event-chip insert produces valid `body_html` round-trippable via `tenTapTokenBridge.htmlToTokenString` | Unit (token bridge round-trip) | implementor test |
| T-12 | Native iOS composer unchanged (regression smoke) | Manual sim | tester (Maestro flow) |
| T-13 | Send-a-blast-end-to-end on web | Manual e2e | tester (operator-assisted on dev server) |
| T-14 | Cross-surface chip rendering parity (web vs iOS) | Manual e2e | tester (operator-assisted) |
| T-15 | Strict-grep CI gate PASS on fixed branch; FAIL on revert | CI | tester |

---

## Section 7 — Implementation order (numbered sequence)

1. **Create new helper hook** `src/hooks/useStickyFooterOffset.ts` (10 LoC + JSDoc).
2. **Extend `useAudienceList`** to return `hasResolved` (or equivalent — see §3.5.3 implementor note). Update its TypeScript return type. Do the same for `useMarketingOverview` and `useCampaigns`.
3. **Patch route loading guards** on Overview / Audiences / Campaigns to use the new `hasResolved` / `data + !isError` shape. Add `testID="overview-skeleton"` / `"audiences-skeleton"` / `"campaigns-spinner"` to the skeleton elements for RTL targeting.
4. **Patch FAB offsets** on Overview / Campaigns / Templates to use `useStickyFooterOffset()`. Remove the inline `+ 96`.
5. **Rewrite `richEditor.tsx` web stub** as the minimal composer per §3.5.6. Validate that ComposerV2Editor's imperative-handle calls produce no console errors.
6. **Add the strict-grep CI gates** (`orch-0889-disabled-query-loading-state.mjs` + `orch-0889-sticky-footer-via-hook.mjs`); register them in `.github/workflows/strict-grep-mingla-business.yml`.
7. **Write the regression test pair** (T-01, T-02) per Step 0.5 gate. Verify fails-on-revert at the commit hash of the fix.
8. **Write all other tests** T-03 through T-11.
9. **Run local typecheck + tests** — must be green before push.
10. **Author the implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH.md` with old→new receipts (diffs for each of the 7 files touched) + test run logs + the fails-on-revert verification.
11. **Stage scoped files only**, commit, push `Seth`, hand back to orchestrator for tester dispatch.

---

## Section 8 — Regression prevention

| Risk | Safeguard | Owner |
|---|---|---|
| Disabled-query mis-paint recurs on a new marketing route | Strict-grep CI gate `orch-0889-disabled-query-loading-state.mjs` rejects the brittle pattern in marketing routes. | CI |
| New marketing route adds FAB with inline `+ 96` | Strict-grep CI gate `orch-0889-sticky-footer-via-hook.mjs` rejects inline arithmetic; requires `useStickyFooterOffset()`. | CI |
| Future PR removes the new invariants | INVARIANT_REGISTRY entry + DECISION_LOG entry document the rationale; any removal requires a new ORCH amending. | Code review |
| Native pell composer breaks during web refactor | `richEditor.native.ts` is NOT touched by this ORCH — strict invariant. Manual sim smoke (T-12) verifies. | Tester |
| Web composer's `body_html` diverges from native, `marketing-send` mis-renders | T-11 verifies token-bridge round-trip; T-14 verifies cross-surface chip rendering parity. | Tester |
| ORCH-0885-C [Composer Tiptap swap] swap blocked because Wave-1 composer is hard to remove | Wave-1 composer lives ONLY in `richEditor.tsx` web file; 0885-C replaces this single file. No other code path depends on Wave-1 internals. | Architecture review at 0885-C SPEC |

---

## Section 9 — File manifest (every file the implementor will create or modify)

### New files (4)

1. `mingla-business/src/hooks/useStickyFooterOffset.ts`
2. `mingla-business/app/(tabs)/marketing/__tests__/MarketingOverview.disabled-query.test.tsx`
3. `.github/scripts/strict-grep/orch-0889-disabled-query-loading-state.mjs`
4. `.github/scripts/strict-grep/orch-0889-sticky-footer-via-hook.mjs`

### Modified files (8)

1. `mingla-business/src/hooks/marketing/useMarketingOverview.ts` — add `hasResolved`
2. `mingla-business/src/hooks/marketing/useAudienceList.ts` — add `hasResolved`
3. `mingla-business/src/hooks/marketing/useCampaigns.ts` — add `hasResolved`
4. `mingla-business/app/(tabs)/marketing/index.tsx` — loading-guard rewrite + FAB offset
5. `mingla-business/app/(tabs)/marketing/campaigns/index.tsx` — loading-guard rewrite + FAB offset
6. `mingla-business/app/(tabs)/marketing/audiences/index.tsx` — loading-guard rewrite
7. `mingla-business/app/(tabs)/marketing/templates/index.tsx` — FAB offset only
8. `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` — full rewrite (minimal composer)

### CI wiring (1)

1. `.github/workflows/strict-grep-mingla-business.yml` — register the two new gates

### Artifact updates at CLOSE (orchestrator-owned, NOT implementor — per ORCH-0744 CLOSE protocol)

1. `Mingla_Artifacts/WORLD_MAP.md` — register ORCH-0889
2. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — add I-DISABLED-QUERY-IS-LOADING + I-STICKY-FOOTER-VIA-HOOK
3. `Mingla_Artifacts/DECISION_LOG.md` — add DEC-XXX (Wave-1 composer stopgap)
4. `Mingla_Artifacts/MASTER_BUG_LIST.md` — mark closed
5. `Mingla_Artifacts/COVERAGE_MAP.md` — update business-web-preview grade
6. `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` — update
7. `Mingla_Artifacts/PRIORITY_BOARD.md` — recompute

**Total scope: 4 new + 8 modified + 1 CI wiring = 13 files in implementor PR.** Artifact updates land in the CLOSE commit (orchestrator), not the implementor PR.

---

## Section 10 — Hard guards (for implementor)

- **DO NOT touch** `richEditor.native.ts`, `marketing-send`, `marketingCampaignService`, `tenTapTokenBridge`, or any DB schema.
- **DO NOT run** `supabase db push --linked`. No DB change. No edge function deploy.
- **DO NOT change** `app-mobile/` or `mingla-admin/` — out of scope.
- **DO NOT delete or merge** with prior incomplete ORCH-0885-A WIP commits — the Wave-1 fix builds on what already shipped.
- **DO NOT include** `Co-Authored-By` lines in the commit message (operator preference, codified).
- **DO NOT bundle** this ORCH with any other CLOSE — one PR per CLOSE per `feedback_one_pr_per_close.md`.
- **DO use** `/ui-ux-pro-max` skill as a pre-flight design step before writing the composer body component code (per `feedback_implementor_uses_ui_ux_pro_max.md`).

---

## Section 11 — Layman summary of the spec

- **Wave-1 fix has three concrete patches.** First, loading-state guards across Overview / Audiences / Campaigns now correctly show a skeleton while web auth bootstraps (instead of falsely showing "couldn't load" / "no buyers yet" / "your first campaign starts here"). Second, the "+ New campaign" FAB on desktop browsers no longer floats 96 pixels above the bottom of the screen — it sits at a sensible canvas-bottom-aligned position. Third, the composer's grey "mobile-only" placeholder gets replaced with a minimal but actually working web composer: you can type the email body, insert variable chips (first name, brand name, event name) and event cards from the existing insertion bar, and apply basic bold/italic/link formatting.
- **What you'll be able to do that you can't today on web:** compose an email blast end-to-end, including variables and event cards, and tap Send Now to actually send it to your audience. No more "open the business app to compose."
- **What this fix is NOT.** It is NOT the full Tiptap composer with side-by-side live preview, keyboard shortcuts, and drag-resize event cards — that lands in ORCH-0885-C [Composer Tiptap swap], a separate multi-week dispatch. The Wave-1 composer is designed so 0885-C can replace it cleanly (single file swap, no DB or pipeline changes).
- **Two new safety rails are added.** A CI gate prevents the disabled-query bug from sneaking back into any marketing route; a second CI gate prevents the FAB-misposition bug from recurring. Both are tied to new repo invariants codified at close.
- **Estimated effort:** half-day to a full day of implementor work; tests + report in scope; tester verifies on iOS sim + Android emu + web browser per parity rule. Orchestrator closes with one PR (no bundling).

---

**Spec status:** READY FOR DISPATCH. Linked investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH.md`.
