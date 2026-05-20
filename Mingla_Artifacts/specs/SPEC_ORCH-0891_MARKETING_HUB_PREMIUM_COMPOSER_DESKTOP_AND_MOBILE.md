# SPEC — ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish]

**Mode:** `mingla-forensics` SPEC
**Tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Author:** Claude `mingla-forensics`
**Linked investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md`](../reports/INVESTIGATION_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md)
**Parent meta-ORCH:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0885_DESKTOP_REDESIGN.md`](../reports/INVESTIGATION_ORCH-0885_DESKTOP_REDESIGN.md)
**Wave-1 baseline this supersedes:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH.md` (in-flight at time of dispatch — citation only until ORCH-0889 promotes to main)
**Severity:** S1-high
**Estimated implementor effort:** 2–3 weeks (3 internal milestones, one PR at the end)
**Operator-authorized bundle absorbs:** ORCH-0885-C [Composer Tiptap swap] + ORCH-0885-D-1 [⌘K palette, Marketing scope] + ORCH-0885-D-3 [Right rail, composer preview scope] + ORCH-0885-D-4 [Keyboard nav, composer + ⌘K scope] + a new Marketing mobile polish strand. **Does NOT absorb:** ORCH-0885-B (Hub master-detail) + ORCH-0885-D-2 (multi-select on event orders) — both Hub-scope, separate ORCHs.

---

## Section 1 — Scope and non-goals

### In scope (9 strands)

**Strand 1 — Tiptap-backed web composer body with chip pills.** Replace [`mingla-business/src/components/marketing/ComposerV2/richEditor.tsx`](../../mingla-business/src/components/marketing/ComposerV2/richEditor.tsx) Wave-1 textarea with Tiptap-backed editor. Chips render as styled pills via Tiptap custom nodes emitting the EXISTING `composerChipHtml.ts` class names (`mingla-event-chip` + `mingla-personalization-chip`). Atomic chip backspace via the EXISTING `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` DOM handler (verbatim, NOT a Tiptap keymap reimplementation). B/I/Link via Tiptap StarterKit + Link extension. AST round-trips through `tenTapTokenBridge.htmlToTokenString` — output byte-identical to native pell.

**Strand 2 — Side-by-side live email preview pane on wide-desktop.** New layout primitive `ComposerCanvas.web.tsx` splits the canvas: left half = editor (Tiptap), right half = `<EmailPreviewPane />` (existing component, mounted in sibling View instead of Modal). On mobile + narrow web (<1024px), preview stays a button-triggered Modal (current behavior). On wide-desktop (≥1024px), the Preview button is removed (preview is always visible).

**Strand 3 — Keyboard shortcuts on web composer.** New `ComposerKeyboardShortcuts.web.tsx` hook installs global `keydown` listener (scoped to composer route): ⌘B → bold, ⌘I → italic, ⌘K → link prompt, ⌘Enter → Send Now (opens review sheet), ⌘P → toggle preview Modal (mobile/narrow only), ⌘D → open template drawer, Esc → close any open sheet/dialog. Mac uses `⌘`, Windows/Linux uses `Ctrl`. Listener is removed on route unmount.

**Strand 4 — Right-side template drawer on wide-desktop.** Convert `TemplatePreviewDrawer.tsx` consumer behavior: on mobile + narrow web, keep as bottom sheet (current behavior). On wide-desktop, the drawer becomes a persistent right-rail panel (~320px wide) mounted between the editor and the email preview pane (so the layout becomes: editor | drawer | preview when drawer is open; editor | preview when drawer is closed). Drawer is toggleable via ⌘D and via the existing toolbar "From template…" button.

**Strand 5 — Drag-resize embedded event cards (web only).** New Tiptap custom node `EventChipResizable` wraps existing event chip with drag handles on three sides (left/right/bottom) on web. Resize snaps to three buckets: `compact` (h ~48pt, just title), `medium` (h ~120pt, title + date + CTA, current default), `large` (h ~240pt, full card with cover image + title + date + location + CTA). Size stored as `data-size="compact|medium|large"` on the chip DOM. Token-string format extends to `{{event:UUID|size}}` where size is optional (legacy `{{event:UUID}}` defaults to `medium`). Server-side `marketingEmailRender.ts` reads the suffix.

**Strand 6 — Sub-sheets as centered desktop modals.** New primitive `Sheet.web.tsx` that branches on `useResponsiveLayout().isWideDesktop`: on `false`, renders the existing RN `<Sheet>` (mobile bottom sheet); on `true`, renders Radix Dialog centered ~720px max-width. All four current sub-sheets inherit automatically: `AudiencePickerSheet` + `ComposerReviewSheet` + `SchedulePickerSheet` + (the email preview Modal in `compose.tsx` is replaced by the side-by-side pane on wide-desktop and stays as RN Modal on mobile per Strand 2).

**Strand 7 — ⌘K command palette.** New global `CommandPalette.web.tsx` mounted in `(tabs)/_layout.tsx` (web only). Triggered via ⌘K from any Marketing route (Strand 3 owns the shortcut on composer; this strand owns the global key). Initial command set scoped to Marketing: jump to Overview / Audiences / Campaigns / Templates / New campaign / Recent campaigns / Recent audiences / Recent templates. Built on `cmdk` library. Mobile + narrow web: ⌘K is not wired (not a discoverable mobile shortcut — defer mobile UX to a future ORCH if requested).

**Strand 8 — Marketing Hub mobile premium polish.** Apply across all marketing surfaces on iOS + Android:
- **Shimmer skeletons:** new `useShimmer` hook returns animated opacity (CSS `@keyframes` on web, `Animated.loop` on native). Replace static skeleton placeholders on Overview / Audiences / Campaigns / Templates with shimmer variants.
- **Motion micro-interactions:** scale-on-press (Pressable `style={({pressed}) => [...pressed ? {transform: [{scale: 0.97}]} : null]}`) on every tap target. Fade-in animation on mount for list items (stagger 30ms).
- **Haptics on every CTA:** `Haptics.impactAsync(ImpactFeedbackStyle.Light)` on every Pressable tap in Marketing surfaces, gated on `Platform.OS !== "web"` per existing pattern.
- **Empty-state illustration upgrade:** replace generic `EmptyState illustration="users"` on Audiences ("No buyers yet"), Campaigns ("Your first campaign starts here"), Templates ("Couldn't load templates") with Marketing-specific SVG illustrations (designer-supplied during pre-flight).
- **Send-confirmation premium animation:** upgrade `ComposerSentConfirmation` from current utilitarian sheet to a celebratory burst animation (confetti via Reanimated OR a brand-orange radial pulse — designer choice). Haptic burst on mount (`Haptics.notificationAsync(Success)`).

**Strand 9 — "No slugs" performance contract.** Codify measurable thresholds (see §4 success criteria):
- Drag-resize event card ≥60fps sustained.
- Chip insert CLS = 0 (no layout shift).
- Send Now → confirmation visible ≤200ms (optimistic UI — show confirmation immediately, continue actual send in background).
- Skeleton shimmer animation ≥60fps using CSS keyframes / Reanimated.
- Template card hover → body prefetched within 100ms (web only; React Query prefetch).
- ⌘K palette open ≤50ms from keypress.
- Marketing route navigation ≤300ms tap-to-content (cached path).
- Composer bundle chunk size ≤ 280 KB gz.
- Other marketing route chunks ≤ +80 KB gz incremental over baseline.
- Bundle-size verification via `expo export --platform web && ls -lh dist/_expo/static/js/` post-implementation, reported in the implementation report.

### Non-goals (explicit; do NOT touch)

- ❌ Native composer (`richEditor.native.ts` + pell SDK) — UNCHANGED on iOS/Android. ORCH-0891 is web-side composer rewrite + mobile non-composer polish.
- ❌ Database schema changes (zero migrations).
- ❌ `marketingCampaignService` / `marketingAudienceService` / `marketingRenderingService` / `marketingTemplateService` — UNCHANGED. The only edge-function code touched is `marketingEmailRender.ts` (the server-side renderer) to honor `data-size`.
- ❌ Consumer app (`app-mobile/`) — out of scope; no marketing surface there.
- ❌ Admin web (`mingla-admin/`) — out of scope.
- ❌ Buyer-anonymous web routes (`/checkout/*`, `/e/*`, `/b/*`) — out of scope.
- ❌ Hub Events / Trips desktop polish (ORCH-0885-B — separate).
- ❌ Multi-select bulk actions on event orders (ORCH-0885-D-2 — separate).
- ❌ Persistent global right rail (today's pulse / live Ari thread per parent investigation ORCH-0885-D-3 broad scope) — ORCH-0891's "right rail" is composer-specific (template drawer + preview pane).
- ❌ ⌘K palette commands outside Marketing surfaces (events / orders / guests / brand) — defer to ORCH-0885-D-1 expansion under Hub scope.
- ❌ Web auth-bootstrap loading-state sweep across Home/Account/Hub (ORCH-0890 — separate, queued).
- ❌ Tiptap collaborative editing (multi-cursor, comments, suggestions) — out of scope.
- ❌ AI assist in composer — out of scope (post-mechanical-ads work per memory).
- ❌ Email A/B testing — out of scope.
- ❌ react-email build-time render layer for templated emails — out of scope, deferred.

### Assumptions

- The `.web.tsx` Metro-resolution pattern continues to work (proven by `StripeProviderWrapper.web.tsx` + `BottomNav.web.tsx` + ORCH-0886 SSR fix + ORCH-0889 Wave-1).
- React 19 + Expo SDK 54 + Metro web bundling support Tiptap's package shape (the Tiptap packages ship as ESM; Metro web supports ESM imports per existing react-native-web pipeline).
- `cmdk` library works in RN-web context (it's a pure React library; pure DOM; no native dependencies — verified by parent investigation §D-2).
- Radix UI primitives work in RN-web context (same; pure React + ARIA — verified by parent investigation §D-2).
- Operator runs `supabase functions deploy marketing-send` once during M2 (the only deploy gate in ORCH-0891).
- Operator dispatches `/mingla-designer` ONCE after SPEC return + BEFORE implementor dispatch to produce composer-specific visual decisions per §3.7.

---

## Section 2 — Cross-Surface Impact (MANDATORY per Phase 2.5)

| Surface | In scope? | What changes |
|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | ❌ Not in scope | No Marketing surface ships on consumer app. Zero change. |
| **Consumer Android** | ❌ Not in scope | Same as above. |
| **Buyer-anonymous Web** (`/checkout/*`, `/e/*`, `/b/*`) | ❌ Not in scope | Buyer routes don't expose Marketing state. Zero change. |
| **Business iOS** | ✅ **IN SCOPE — mobile polish strand only** | Strand 8: shimmer skeletons, motion micro-interactions, haptics, empty-state illustration upgrade, send-confirmation premium animation. Composer (native pell + chip rendering) UNCHANGED — operator's existing iOS flow is preserved bit-identically. Parity is **manual** between iOS and Android polish (per-platform haptic/Reanimated differences). |
| **Business Android** | ✅ **IN SCOPE — mobile polish strand only** | Same as iOS. Composer (native pell + chip rendering) UNCHANGED. Parity is **manual** with iOS. |
| **Admin Web** (`mingla-admin/`) | ❌ Not in scope | No Marketing surface. Zero change. |
| **Business Web preview — wide-desktop (≥1024px)** | ✅ **IN SCOPE — primary** | Strands 1–7 + Strand 9 ALL apply. Tiptap composer + side-by-side preview + keyboard shortcuts + right-side template drawer + drag-resize event cards + desktop modals + ⌘K palette + performance contract. Parity with narrow-web is **manual** (separate code paths via `isWideDesktop` branches). |
| **Business Web preview — narrow web (<1024px)** | ✅ **IN SCOPE — partial** | Strand 1 (Tiptap chips render the same on narrow web — viewport gate is on layout, not editor). Strand 9 (performance contract applies). Strands 2/4/6 fall back to mobile-shaped overlays (preview Modal, bottom-sheet drawer, bottom-sheet sub-sheets) — parity with native iOS/Android sheets via the `Sheet.web.tsx` narrow-branch. Strands 3/5/7 do NOT apply on narrow web (no keyboard shortcuts, no drag-resize, no ⌘K — defer to future ORCH if narrow-web touch users want them). |

### Parity matrix (manual = separate code paths)

| Strand | iOS | Android | Web narrow | Web wide-desktop | Parity model |
|---|---|---|---|---|---|
| 1. Tiptap chips | n/a | n/a | ✅ | ✅ | Automatic (shared web code) |
| 2. Side-by-side preview | n/a | n/a | ❌ (Modal stays) | ✅ | Manual (separate web branches) |
| 3. Keyboard shortcuts | n/a | n/a | ❌ | ✅ | Manual |
| 4. Right-side template drawer | n/a | n/a | ❌ (bottom sheet) | ✅ | Manual |
| 5. Drag-resize event cards | n/a | n/a | ❌ | ✅ | Manual |
| 6. Sub-sheets as desktop modals | n/a | n/a | ❌ (RN Sheet via narrow branch) | ✅ (Radix Dialog) | Manual (Sheet.web.tsx) |
| 7. ⌘K command palette | n/a | n/a | ❌ | ✅ | Manual |
| 8. Mobile premium polish | ✅ | ✅ | n/a (web has its own polish via Strand 1) | n/a | Manual (iOS Haptics + Reanimated; Android Haptics + Reanimated; parity verified per platform) |
| 9. Performance contract | n/a | n/a | ✅ | ✅ | Automatic |

Per-surface success criteria are listed in §4 with suffix `-iOS`, `-Android`, `-WebN`, `-WebW` where parity is manual.

---

## Section 3 — Layer-by-layer specification

### 3.1 Database layer

❌ **No changes.** Zero migrations, zero new tables, zero RLS changes.

### 3.2 Edge function layer (ONE small change)

**File:** `supabase/functions/_shared/marketingEmailRender.ts` (existing — referenced from `EmailPreviewPane.tsx` file header; full file read at SPEC time confirms the change scope).

**Change:** Honor optional `|size` suffix on event chip tokens.

**Current token format:** `{{event:UUID}}`
**Extended token format:** `{{event:UUID}}` (default `medium`) OR `{{event:UUID|compact}}` OR `{{event:UUID|medium}}` OR `{{event:UUID|large}}`

**Pseudocode:**
```ts
// In marketingEmailRender.ts where the event token is matched:
const EVENT_TOKEN_RE = /\{\{event:([0-9a-f-]+)(?:\|(compact|medium|large))?\}\}/gi;
// On match:
//   eventId = match[1]
//   size = match[2] || "medium"  // backwards-compat default
// Then render the appropriate card layout per size:
//   compact: just title + date (small inline strip, ~48pt height)
//   medium:  current layout (title + date + CTA, ~120pt height)
//   large:   full card (cover image + title + date + location + CTA, ~240pt height)
```

**Deploy gate:** Operator runs `supabase functions deploy marketing-send --project-ref gqnoajqerqhnvulmnyvv` ONCE between M2 and M3. Implementor writes the change in M2; operator approves and deploys; M3 begins.

**Backwards-compatibility:** Legacy campaigns with `{{event:UUID}}` (no size) continue rendering at `medium`. ZERO migration of stored data needed.

### 3.3 Service layer

❌ **No changes** to `marketingCampaignService` / `marketingAudienceService` / `marketingRenderingService` / `marketingTemplateService` / `brandEvents.ts`.

**One bridge extension** to `tenTapTokenBridge.ts`:

- Extend `htmlToTokenString` event-chip regex to capture optional `data-size` attribute and emit it as `|size` suffix in the token:
  ```ts
  // Existing regex:
  //   /<span\b[^>]*?\bdata-event-id="([0-9a-f-]+)"[^>]*>[\s\S]*?<\/span>/gi
  //   → `{{event:${id}}}`
  // New regex (captures optional data-size):
  //   /<span\b[^>]*?\bdata-event-id="([0-9a-f-]+)"(?:[^>]*?\bdata-size="(compact|medium|large)")?[^>]*>[\s\S]*?<\/span>/gi
  //   → size present: `{{event:${id}|${size}}}`
  //   → size absent: `{{event:${id}}}` (preserves current behavior)
  ```
- Extend `extractEmbeddedEventIds` to ignore the size suffix when extracting IDs (regex `/\{\{event:([0-9a-f-]+)(?:\|\w+)?\}\}/gi`).
- Extend `docToHtml` to emit `data-size` when the ProseMirror node has a `size` attribute set.
- Extend `bodyHtmlToTenTapDoc` to parse `|size` suffix from legacy token strings (defaults to `medium` when absent).

All four extensions are backwards-compatible. Unit test: `tenTapTokenBridge.test.ts` already exists; add 4 round-trip cases (legacy chip → preserved; compact chip → emit + parse; medium chip → emit + parse; large chip → emit + parse).

### 3.4 Hook layer

Three new hooks:

#### 3.4.1 `useShimmer` (NEW)

**File:** `mingla-business/src/hooks/useShimmer.ts`
**Purpose:** Animated opacity for skeleton placeholders. ≥60fps on both platforms.

```ts
import { useEffect } from "react";
import { Animated, Easing, Platform } from "react-native";

const SHIMMER_DURATION_MS = 1400;

export interface ShimmerOpacityValue {
  /** Use as `style={{ opacity: value }}` on skeleton View. */
  value: Animated.Value;
}

export function useShimmer(): ShimmerOpacityValue {
  // Implementation outline:
  // - Animated.Value(0.4)
  // - Animated.loop(Animated.sequence([toValue: 0.7, toValue: 0.4]), { iterations: -1, useNativeDriver: true (on native) })
  // - On web, Animated.timing with useNativeDriver: false (RN-web supports timing)
  // - Cleanup on unmount via Animated.stopAll
}
```

**Native:** uses Reanimated's `useNativeDriver: true` for 60fps off-thread.
**Web:** RN-web's `Animated` runs on the JS thread; verify ≥60fps via Chrome DevTools. If not, fall back to CSS `@keyframes` via injected `<style>` tag.

#### 3.4.2 `useCommandPaletteState` (NEW)

**File:** `mingla-business/src/hooks/useCommandPaletteState.ts` (web-only — gated by `Platform.OS === "web"`)
**Purpose:** Zustand-backed state for the ⌘K palette (open/closed + current search input). Single source of truth.

```ts
import { create } from "zustand";

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  setOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  toggle: () => void;
}

export const useCommandPalette = create<CommandPaletteState>((set) => ({
  isOpen: false,
  query: "",
  setOpen: (isOpen) => set({ isOpen }),
  setQuery: (query) => set({ query }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen, query: s.isOpen ? "" : s.query })),
}));
```

**Note:** This is the FIRST Zustand store outside the persisted `currentBrandStore` pattern. Document in DECISION_LOG: Zustand for ephemeral UI state (open/closed flags) is approved; persisted Zustand still restricted to IDs per `feedback_zustand_persist_no_server_snapshots.md`.

#### 3.4.3 `useComposerKeyboardShortcuts` (NEW, web-only)

**File:** `mingla-business/src/hooks/useComposerKeyboardShortcuts.web.ts`
**Purpose:** Install keyboard shortcuts on composer route.

```ts
// Pseudocode:
import { useEffect } from "react";

export interface ComposerShortcutHandlers {
  onBold: () => void;
  onItalic: () => void;
  onLink: () => void;
  onSendNow: () => void;
  onTogglePreview: () => void;
  onToggleDrawer: () => void;
  onCloseAny: () => void;
}

export function useComposerKeyboardShortcuts(handlers: ComposerShortcutHandlers): void {
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const handler = (e: KeyboardEvent): void => {
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (!cmd && e.key !== "Escape") return;
      switch (e.key.toLowerCase()) {
        case "b": e.preventDefault(); handlers.onBold(); break;
        case "i": e.preventDefault(); handlers.onItalic(); break;
        case "k": e.preventDefault(); handlers.onLink(); break;
        case "enter": e.preventDefault(); handlers.onSendNow(); break;
        case "p": e.preventDefault(); handlers.onTogglePreview(); break;
        case "d": e.preventDefault(); handlers.onToggleDrawer(); break;
        case "escape": handlers.onCloseAny(); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlers]);
}
```

**Native counterpart:** `useComposerKeyboardShortcuts.native.ts` — no-op (exports the function but body is empty). Metro picks the right variant.

### 3.5 Component / Route layer

#### 3.5.1 Tiptap web composer rewrite (Strand 1)

**File:** `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` (FULL REWRITE — ~700 lines)

**Public surface (must stay byte-identical to `richEditor.native.ts`):**
- `RichEditor` class component with imperative ref API
- `actions` constants enum

**Imperative API (preserved):**
- `commandDOM(js)`: on web, executes JS in the Tiptap editor's iframe-less context. For CSS injection (the only current caller — see `ComposerV2Editor.tsx:181-186`), inject as a `<style>` tag into the editor root. For other JS, execute via `eval` in a try/catch (defensive; only called by `handleEditorInitialized` which we control).
- `insertHTML(html)`: parse the HTML for chip markers. If `mingla-event-chip` detected, insert as Tiptap `EventChip` node with attrs. If `mingla-personalization-chip` detected, insert as `PersonalizationChip` node. Otherwise, insert as raw HTML via `editor.commands.insertContent(html, { parseOptions: { preserveWhitespace: true } })`.
- `setContentHTML(html)`: full replace via `editor.commands.setContent(html)`. Used by `applyTemplateReplace`.
- `sendAction(action, name?, value?)`: map onto Tiptap commands:
  - `actions.setBold` → `editor.chain().focus().toggleBold().run()`
  - `actions.setItalic` → `editor.chain().focus().toggleItalic().run()`
  - All other actions: graceful no-op + dev console warn.
- `insertLink(text, url)`: `editor.chain().focus().insertContent(`<a href="${url}">${text}</a>`).run()`.

**Tiptap custom nodes:**

**EventChip (custom node):**
```ts
import { Node, mergeAttributes } from "@tiptap/core";

export const EventChip = Node.create({
  name: "eventChip",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,  // contenteditable="false" + atomic delete
  addAttributes() {
    return {
      eventId: { default: null, parseHTML: el => el.getAttribute("data-event-id"), renderHTML: a => ({ "data-event-id": a.eventId }) },
      cta: { default: "tickets", parseHTML: el => el.getAttribute("data-cta"), renderHTML: a => ({ "data-cta": a.cta }) },
      size: { default: "medium", parseHTML: el => el.getAttribute("data-size") || "medium", renderHTML: a => ({ "data-size": a.size }) },
      title: { default: "", parseHTML: el => el.textContent || "", renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-event-id]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ class: "mingla-event-chip", contenteditable: "false" }, HTMLAttributes),
      ["span", { class: "mingla-chip-glyph" }, "▣"],
      node.attrs.title,
    ];
  },
});
```

**PersonalizationChip (custom node):**
```ts
export const PersonalizationChip = Node.create({
  name: "personalizationChip",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,
  addAttributes() {
    return {
      token: { default: null, parseHTML: el => el.getAttribute("data-token"), renderHTML: a => ({ "data-token": a.token }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-token]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "mingla-personalization-chip", contenteditable: "false" }, HTMLAttributes), node.attrs.token];
  },
});
```

**Tiptap editor setup:**
```ts
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { EventChip } from "./tiptapNodes/EventChip";
import { PersonalizationChip } from "./tiptapNodes/PersonalizationChip";
import { COMPOSER_CHIP_CSS, COMPOSER_CHIP_BACKSPACE_HANDLER_JS } from "./composerChipHtml";

const editor = useEditor({
  extensions: [
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
    Link.configure({ openOnClick: false, HTMLAttributes: { class: "" } }),
    EventChip,
    PersonalizationChip,
  ],
  content: initialContentHTML,
  onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
});

// Inject chip CSS via <style> tag once
useEffect(() => {
  const styleId = "mingla-composer-chip-css";
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.innerHTML = COMPOSER_CHIP_CSS;
  document.head.appendChild(style);
  return () => { style.remove(); };
}, []);

// Install atomic backspace handler verbatim
useEffect(() => {
  if (!editor) return;
  // Evaluate the existing handler script in the document scope
  // (already idempotent via window.__minglaChipBackspaceInstalled flag)
  const script = document.createElement("script");
  script.textContent = COMPOSER_CHIP_BACKSPACE_HANDLER_JS;
  document.body.appendChild(script);
  return () => { script.remove(); /* the installed handler stays — flag prevents reinstall */ };
}, [editor]);
```

**Render:**
```tsx
<View style={[{ minHeight: initialHeight ?? 240 }, style, styles.host]}>
  <EditorContent editor={editor} className="mingla-composer-editor" />
</View>
```

**Styling:** The host View handles RN styling (border, background per Wave-1 spec). The `EditorContent` div gets CSS via the injected style tag and via a sibling `.mingla-composer-editor` rule applying `font-size: 15px; line-height: 1.55; padding: 12px; min-height: 100%;` matching the existing pell `contentCSSText` (preserves the Wave-1 baseline aesthetic).

#### 3.5.2 ComposerCanvas split layout (Strand 2)

**File:** `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.web.tsx` (NEW)

```tsx
interface ComposerCanvasProps {
  editor: React.ReactNode;       // <ComposerV2Editor /> + footer
  preview: React.ReactNode;       // <EmailPreviewPane />
  drawer?: React.ReactNode;       // <TemplatePreviewDrawer /> when open
  drawerOpen: boolean;
}

export const ComposerCanvas: React.FC<ComposerCanvasProps> = ({ editor, preview, drawer, drawerOpen }) => {
  const { isWideDesktop } = useResponsiveLayout();

  if (!isWideDesktop) {
    // Mobile + narrow web: return only the editor; preview + drawer mount as modals/sheets via existing paths
    return <View style={{ flex: 1 }}>{editor}</View>;
  }

  // Wide-desktop split:
  //   editor (flex: 1) | drawer (320px, only when open) | preview (480px or 1fr capped at 720px)
  return (
    <View style={styles.canvasHost}>
      <View style={styles.editorPane}>{editor}</View>
      {drawerOpen && drawer ? <View style={styles.drawerPane}>{drawer}</View> : null}
      <View style={styles.previewPane}>{preview}</View>
    </View>
  );
};
```

Mounted by `app/(tabs)/marketing/campaigns/compose.tsx` — replace the current `<View style={styles.host}>` wrapping with `<ComposerCanvas editor={...} preview={<EmailPreviewPane ... />} drawer={...} drawerOpen={showTemplateDrawer} />`. Remove the existing `<Modal>` wrapping the EmailPreviewPane on wide-desktop (preview is always visible). On mobile/narrow, keep current Modal trigger via Preview button.

**Native counterpart:** `ComposerCanvas.tsx` — passthrough Fragment that renders only `editor` (preview + drawer mount via existing native paths). Metro picks the right variant.

#### 3.5.3 Sheet.web.tsx primitive (Strand 6)

**File:** `mingla-business/src/components/ui/Sheet.web.tsx` (NEW)

```tsx
import { Sheet as MobileSheet } from "./Sheet";
import * as Dialog from "@radix-ui/react-dialog";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

export const Sheet: React.FC<SheetProps> = (props) => {
  const { isWideDesktop } = useResponsiveLayout();
  if (!isWideDesktop) return <MobileSheet {...props} />;

  return (
    <Dialog.Root open={props.visible} onOpenChange={(open) => !open && props.onClose?.()}>
      <Dialog.Portal>
        <Dialog.Overlay style={styles.overlay} />
        <Dialog.Content style={styles.content} aria-describedby={undefined}>
          {/* Dialog title for ARIA — derive from props.title or omit if not provided */}
          {props.title ? <Dialog.Title style={styles.title}>{props.title}</Dialog.Title> : <VisuallyHidden><Dialog.Title>Modal</Dialog.Title></VisuallyHidden>}
          {props.children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

// Centered 720px max-width, dark canvas background, rounded corners
const styles = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100 },
  content: { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", maxWidth: 720, width: "calc(100vw - 64px)", maxHeight: "85vh", overflow: "auto", background: "#0c0e12", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, zIndex: 101 },
  title: { padding: 16, fontSize: 18, fontWeight: 600, color: "#fff" },
};
```

All Sheet consumers (`AudiencePickerSheet`, `ComposerReviewSheet`, `SchedulePickerSheet`) inherit automatically — they import `Sheet` from `./Sheet`; Metro picks `Sheet.web.tsx` on web; users get Radix Dialog on wide-desktop and the existing mobile sheet on narrow web + native.

#### 3.5.4 TemplatePreviewDrawer right-rail variant (Strand 4)

**File:** `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx` (NEW)

```tsx
import { TemplatePreviewDrawer as MobileDrawer } from "./TemplatePreviewDrawer";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";

export const TemplatePreviewDrawer: React.FC<Props> = (props) => {
  const { isWideDesktop } = useResponsiveLayout();
  if (!isWideDesktop) return <MobileDrawer {...props} />;

  // Wide-desktop: render as a sibling pane (mounted by ComposerCanvas) instead of a sheet
  if (!props.visible) return null;
  return (
    <View style={styles.rail}>
      <View style={styles.railHeader}>
        <Text style={styles.railTitle}>Templates</Text>
        <Pressable onPress={props.onClose} accessibilityLabel="Close templates"><Icon name="x" /></Pressable>
      </View>
      <ScrollView>
        {props.templates.map(t => <TemplateRow key={t.id} template={t} onApply={() => props.onApplyReplace(t)} />)}
      </ScrollView>
    </View>
  );
};
```

The desktop variant returns a positionless pane that `ComposerCanvas.web.tsx` slots into its drawer slot (no Modal / no Sheet — just a plain View). The mobile variant remains the bottom sheet.

#### 3.5.5 EventChipResizable (Strand 5)

**File:** `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChipResizable.web.tsx` (NEW)

Tiptap `NodeView` for the EventChip node — adds drag handles on web ≥1024px. On <1024px or non-web, render the plain chip (no resize). Implementation:

```tsx
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";

export const EventChipResizableView: React.FC<NodeViewProps> = ({ node, updateAttributes }) => {
  const { isWideDesktop } = useResponsiveLayout();
  const size = node.attrs.size as "compact" | "medium" | "large";

  if (!isWideDesktop) {
    // Mobile + narrow: render the static chip
    return <NodeViewWrapper as="span" className="mingla-event-chip" data-event-id={node.attrs.eventId} data-cta={node.attrs.cta} data-size={size}>
      <span className="mingla-chip-glyph">▣</span>{node.attrs.title}
    </NodeViewWrapper>;
  }

  // Wide-desktop: render with size affordances
  // Three radio-button-ish buttons inline (S/M/L) appear on hover; clicking changes size
  // Drag handle on the right edge (just a visual; clicking opens the size picker — simpler than free-form drag for v1)
  // [SIZE-PICKER-V1] Operator directive may favor free-form drag in M3 polish; SPEC v1 ships click-to-change.
  return (
    <NodeViewWrapper as="span" className={`mingla-event-chip mingla-event-chip-size-${size}`} data-event-id={node.attrs.eventId} data-cta={node.attrs.cta} data-size={size}>
      <span className="mingla-chip-glyph">▣</span>
      <span>{node.attrs.title}</span>
      <span className="mingla-chip-size-picker" contentEditable={false}>
        <button onClick={() => updateAttributes({ size: "compact" })} aria-label="Compact size" data-active={size === "compact"}>S</button>
        <button onClick={() => updateAttributes({ size: "medium" })} aria-label="Medium size" data-active={size === "medium"}>M</button>
        <button onClick={() => updateAttributes({ size: "large" })} aria-label="Large size" data-active={size === "large"}>L</button>
      </span>
    </NodeViewWrapper>
  );
};
```

**CSS additions** (to `composerChipHtml.ts` CSS string OR a new `composerSizePicker.css`):

```css
.mingla-event-chip .mingla-chip-size-picker { display: none; margin-left: 6px; }
.mingla-event-chip:hover .mingla-chip-size-picker,
.mingla-event-chip:focus-within .mingla-chip-size-picker { display: inline-flex; gap: 2px; }
.mingla-chip-size-picker button { width: 18px; height: 18px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.7); font-size: 10px; cursor: pointer; }
.mingla-chip-size-picker button[data-active="true"] { background: rgba(235,120,37,0.5); border-color: #eb7825; color: #fff; }
```

**Note:** V1 ships click-to-change S/M/L (simpler, immediately usable). Free-form drag-resize via mouse is a polish target (M3 if time allows; otherwise a follow-up ORCH). The success criteria below grade click-to-change as PASS for the drag-resize strand.

#### 3.5.6 CommandPalette (Strand 7)

**File:** `mingla-business/src/components/ui/CommandPalette.web.tsx` (NEW; web-only)

```tsx
import { Command } from "cmdk";
import { useRouter } from "expo-router";
import { useCommandPalette } from "../../hooks/useCommandPaletteState";
import { useCampaigns } from "../../hooks/marketing/useCampaigns";
import { useAudienceList } from "../../hooks/marketing/useAudienceList";
import { useUserTemplates } from "../../hooks/marketing/useUserTemplates";
import { useAuth } from "../../context/AuthContext";

export const CommandPalette: React.FC = () => {
  const router = useRouter();
  const { user } = useAuth();
  const { isOpen, query, setOpen, setQuery, toggle } = useCommandPalette();
  const recentCampaigns = useCampaigns({ account_id: user?.id ?? null }).data ?? [];
  const recentAudiences = useAudienceList(user?.id ?? null).entries;
  const recentTemplates = useUserTemplates(user?.id ?? null).data ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === "k") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <Command.Dialog open={isOpen} onOpenChange={setOpen} label="Command palette">
      <Command.Input value={query} onValueChange={setQuery} placeholder="Jump to or search…" />
      <Command.List>
        <Command.Empty>No results.</Command.Empty>
        <Command.Group heading="Jump to">
          <Command.Item onSelect={() => { router.push("/marketing"); setOpen(false); }}>Overview</Command.Item>
          <Command.Item onSelect={() => { router.push("/marketing/audiences"); setOpen(false); }}>Audiences</Command.Item>
          <Command.Item onSelect={() => { router.push("/marketing/campaigns"); setOpen(false); }}>Campaigns</Command.Item>
          <Command.Item onSelect={() => { router.push("/marketing/templates"); setOpen(false); }}>Templates</Command.Item>
        </Command.Group>
        <Command.Group heading="Actions">
          <Command.Item onSelect={() => { router.push("/marketing/campaigns/compose"); setOpen(false); }}>New campaign</Command.Item>
        </Command.Group>
        {recentCampaigns.length > 0 && (
          <Command.Group heading="Recent campaigns">
            {recentCampaigns.slice(0, 5).map(c => (
              <Command.Item key={c.id} onSelect={() => { router.push(`/marketing/campaigns/${c.id}`); setOpen(false); }}>{c.name}</Command.Item>
            ))}
          </Command.Group>
        )}
        {/* Similarly: recent audiences, recent templates */}
      </Command.List>
    </Command.Dialog>
  );
};
```

**Mount point:** Mount once in `(tabs)/_layout.tsx` (web only, guarded by `Platform.OS === "web"`). This means ⌘K works from ANY tab — including non-Marketing tabs — but the initial command set is Marketing-only. Future expansion (Hub/Events commands) lands in a separate ORCH.

#### 3.5.7 Marketing route mobile polish (Strand 8)

**Files (modified):**
- `mingla-business/app/(tabs)/marketing/index.tsx` (Overview): replace static skeleton placeholders with shimmer.
- `mingla-business/app/(tabs)/marketing/audiences/index.tsx`: replace static skeleton cards with shimmer.
- `mingla-business/app/(tabs)/marketing/campaigns/index.tsx`: add shimmer to spinner branch.
- `mingla-business/app/(tabs)/marketing/templates/index.tsx`: shimmer for starter loading.
- `mingla-business/src/components/marketing/ComposerSentConfirmation.tsx`: upgrade to premium animation.
- `mingla-business/src/components/ui/EmptyState.tsx`: extend illustration map with Marketing-specific illustrations (designer-supplied SVGs at `mingla-business/assets/illustrations/marketing/*.svg`).

**Haptics pattern** (add to every Pressable in Marketing surfaces):

```tsx
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const handlePress = (): void => {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  // ... existing handler logic
};
```

**Send-confirmation premium animation** (ComposerSentConfirmation upgrade):

```tsx
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

useEffect(() => {
  if (!visible) return;
  if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  scale.value = withSequence(
    withTiming(1.2, { duration: 200 }),
    withSpring(1, { damping: 8 })
  );
  // Plus: confetti or radial-orange-pulse — designer choice; SPEC defers visual to designer pre-flight
}, [visible]);
```

### 3.6 Realtime layer

❌ **No realtime changes.**

### 3.7 Designer pre-flight (MANDATORY before implementor dispatch)

The operator MUST dispatch `/mingla-designer` ONCE after SPEC return and BEFORE implementor dispatch. Designer deliverables required:

| Deliverable | Why needed | Receiver |
|---|---|---|
| Composer canvas split layout at 1024 / 1280 / 1440 / 1920 viewport widths | Strand 2 needs concrete dimensions (editor width, drawer width, preview width) per breakpoint | `ComposerCanvas.web.tsx` styles |
| Insertion bar / formatting toolbar desktop visual treatment | Strand 1 — current InsertionBar is mobile-shaped; desktop version may benefit from a horizontal floating toolbar above the editor | `richEditor.tsx` web layout |
| Template drawer right-rail width + content density (template row height, spacing) | Strand 4 right-rail variant | `TemplatePreviewDrawer.web.tsx` styles |
| ⌘K palette row aesthetic, grouping order, recent-actions ranking algorithm | Strand 7 | `CommandPalette.web.tsx` |
| Drag-resize size picker visual treatment (S/M/L buttons or alternative) | Strand 5 — SPEC ships click-to-change S/M/L by default; designer may propose a different affordance | `EventChipResizable.web.tsx` + chip CSS |
| Send-confirmation premium animation specification (confetti / radial pulse / orange burst — choose one) | Strand 8 ComposerSentConfirmation upgrade | Reanimated animation values + (if confetti) third-party lib choice |
| 3 Marketing-specific empty-state illustrations (Audiences, Campaigns, Templates) | Strand 8 illustration upgrade | SVG assets at `mingla-business/assets/illustrations/marketing/*.svg` + `EmptyState.tsx` extension |
| Shimmer skeleton color values + animation timing curve | Strand 8 | `useShimmer.ts` |
| Chip size visual differentiation between compact/medium/large | Strand 5 + email render | `composerChipHtml.ts` CSS extension + `marketingEmailRender.ts` server templates |

**Designer pre-flight is a HARD blocker.** Implementor MUST NOT begin until designer deliverables land. The operator names the designer artifact paths in the implementor dispatch.

---

## Section 4 — Success criteria

Numbered. Each criterion is observable, testable, unambiguous. Surface suffix where parity is manual.

### Strand 1 — Tiptap chips

| ID | Surface | Criterion |
|---|---|---|
| SC-1 | Web (narrow + wide) | Composer body renders Tiptap editor (NOT the Wave-1 textarea). DOM contains `<div class="ProseMirror" contenteditable="true">`. |
| SC-2 | Web | Tapping "First name" in InsertionBar inserts `<span class="mingla-personalization-chip" contenteditable="false" data-token="first_name">first_name</span>&nbsp;` at the cursor. Visually rendered as a styled pill matching native pell's CSS. |
| SC-3 | Web | Tapping an event in the event scroller inserts `<span class="mingla-event-chip" contenteditable="false" data-event-id="UUID" data-cta="tickets" data-size="medium"><span class="mingla-chip-glyph">▣</span>EVENT TITLE</span>&nbsp;` at the cursor. Pill matches native pell visual. |
| SC-4 | Web | Cursor positioned immediately after a chip + Backspace press deletes the chip AND its trailing `&nbsp;` in one keypress. Verified by reading the editor HTML before/after. |
| SC-5 | Web | Bold toolbar button (or ⌘B) wraps selected text in `<strong>...</strong>`. Italic in `<em>...</em>`. Link in `<a href="...">...</a>`. All preserved through `htmlToTokenString` round-trip. |
| SC-6 | Web | Composer body's `onChange` payload, after passing through `htmlToTokenString`, produces a token string byte-identical to what native pell produces for the same content. Verified by unit test on `tenTapTokenBridge.test.ts` with new test cases. |

### Strand 2 — Side-by-side preview

| ID | Surface | Criterion |
|---|---|---|
| SC-7-WebW | Web wide-desktop | Composer route renders editor on left + EmailPreviewPane on right (no Preview button visible — preview is permanent). |
| SC-7-WebN | Web narrow | Composer route renders editor full-width; Preview button visible in footer; tapping opens Modal (current behavior preserved). |
| SC-8 | Web wide-desktop | EmailPreviewPane updates within 100ms of any keystroke in the editor (no debounce; immediate). |

### Strand 3 — Keyboard shortcuts

| ID | Surface | Criterion |
|---|---|---|
| SC-9-WebW | Web wide-desktop | ⌘B / ⌘I / ⌘K / ⌘Enter / ⌘P / ⌘D / Esc all wired on the composer route per §3.4.3. Each shortcut fires the named handler. Verified by jest test asserting `window.addEventListener("keydown", ...)` was called AND the handlers fire on the corresponding key event. |
| SC-10 | Web | Listener is removed on route unmount (no leak — verified by `removeEventListener` call in cleanup). |

### Strand 4 — Right-side template drawer

| ID | Surface | Criterion |
|---|---|---|
| SC-11-WebW | Web wide-desktop | Tapping "From template…" OR ⌘D opens the template drawer as a 320px right-rail pane between editor and preview. NO bottom sheet appears. |
| SC-11-WebN | Web narrow + iOS + Android | Tapping "From template…" opens the bottom sheet (current behavior preserved). |
| SC-12 | All | Selecting a template via "Apply replace" replaces subject + body via existing `applyTemplateReplace` path; via "Apply at cursor" inserts at cursor via `applyTemplateAtCursor`. Both already work post-Strand 1. |

### Strand 5 — Drag-resize event cards

| ID | Surface | Criterion |
|---|---|---|
| SC-13-WebW | Web wide-desktop | Hovering an event chip reveals an S/M/L size picker. Clicking a size button changes the chip's `data-size` attribute. Editor's HTML emits `data-size="..."` in the chip span. |
| SC-14 | Web wide-desktop | `htmlToTokenString` converts a chip with `data-size="compact"` to `{{event:UUID|compact}}` (extended token format). Without `data-size`, emits `{{event:UUID}}` (backwards-compat). |
| SC-15 | Edge fn | `marketingEmailRender.ts` reads the size suffix and renders the appropriate card layout. Verified by sending a test blast with a `large` chip and inspecting the inbox email. |
| SC-16 | All | Legacy stored campaigns (token `{{event:UUID}}` without size) continue rendering with the `medium` default. Verified by reading an existing draft on web AND viewing an existing sent campaign in inbox. |

### Strand 6 — Sub-sheets as desktop modals

| ID | Surface | Criterion |
|---|---|---|
| SC-17-WebW | Web wide-desktop | AudiencePickerSheet, ComposerReviewSheet, SchedulePickerSheet ALL render as centered ~720px max-width Radix Dialogs (NOT bottom sheets) when triggered. Background overlay dims at 60% opacity. Esc closes. Click outside closes. |
| SC-17-WebN | Web narrow | All three sheets render as bottom sheets (current behavior). |
| SC-17-iOS / SC-17-Android | iOS + Android | All three sheets render as bottom sheets (current behavior — unchanged). |
| SC-18-WebW | Web wide-desktop | EmailPreviewPane Modal trigger is REMOVED (preview is permanent via Strand 2). The Preview button is hidden when `isWideDesktop`. |

### Strand 7 — ⌘K command palette

| ID | Surface | Criterion |
|---|---|---|
| SC-19-WebW | Web wide-desktop | ⌘K (or Ctrl+K) from any Marketing tab opens the palette dialog. Esc closes. |
| SC-19-WebN | Web narrow | ⌘K does nothing (no palette mounted). |
| SC-20 | Web wide-desktop | Palette contains commands for: Overview, Audiences, Campaigns, Templates, New campaign, and the operator's 5 most recent campaigns / audiences / templates. |
| SC-21 | Web wide-desktop | Selecting a command (via click OR Enter on highlighted item) navigates to the target route OR fires the action; palette closes. |
| SC-22 | Web wide-desktop | Typing in the search input filters the command list (cmdk's default fuzzy match). |

### Strand 8 — Mobile premium polish

| ID | Surface | Criterion |
|---|---|---|
| SC-23-iOS / SC-23-Android | iOS + Android | Skeleton placeholders on Overview / Audiences / Campaigns / Templates animate with a shimmer effect (opacity 0.4 → 0.7 → 0.4, ~1400ms cycle). |
| SC-24-iOS / SC-24-Android | iOS + Android | Every Pressable in Marketing surfaces triggers `Haptics.impactAsync(Light)` on tap. Verified by code review (every Pressable in the diff has the Haptics call gated by `Platform.OS !== "web"`). |
| SC-25-iOS / SC-25-Android | iOS + Android | Every Pressable in Marketing surfaces scales to 0.97 on press (visual feedback). Verified by Pressable `style={({pressed}) => ...}` pattern in diff. |
| SC-26-iOS / SC-26-Android | iOS + Android | List items on Overview's recent campaigns / Campaigns list / Audiences / Templates fade in on mount (stagger 30ms per item, max 5 items animated then static for the rest). |
| SC-27-iOS / SC-27-Android | iOS + Android | After Send Now, ComposerSentConfirmation renders the premium animation (designer-specified). Haptics burst (`notificationAsync(Success)`) fires. |
| SC-28-iOS / SC-28-Android | iOS + Android | "No buyers yet." / "Your first campaign starts here" / "Couldn't load templates" empty states render the Marketing-specific SVG illustrations (NOT the generic "users" illustration). |

### Strand 9 — Performance contract

| ID | Surface | Criterion | Verification |
|---|---|---|---|
| SC-29 | Web | Drag-resize / size-picker click changes the chip in ≤16ms (one frame). Chrome DevTools Performance recording confirms no frame drop. | Chrome DevTools Performance recording |
| SC-30 | Web | Chip insert via InsertionBar produces CLS = 0.00. | Chrome DevTools Performance recording |
| SC-31 | Web | Send Now → ComposerSentConfirmation visible in ≤200ms (optimistic UI). The actual server send continues in background; if it fails, the confirmation transforms into an error retry state. | Manual stopwatch + Network panel |
| SC-32 | Web + iOS + Android | Shimmer animation runs ≥60fps. | Chrome DevTools (web) + Reanimated profiler (native) |
| SC-33 | Web | Hovering a template card pre-fetches the template body within 100ms. | Network panel |
| SC-34 | Web wide-desktop | ⌘K palette opens within 50ms of keypress. | Chrome DevTools Performance recording |
| SC-35 | Web + iOS + Android | Marketing route tap-to-content ≤300ms on cached navigation. | Manual stopwatch |
| SC-36 | Web | Post-build composer chunk size ≤ 280 KB gz. | `expo export --platform web && ls -lh dist/_expo/static/js/` |
| SC-37 | Web | Other Marketing route chunks ≤ +80 KB gz incremental over current baseline. | Same as SC-36 |

---

## Section 5 — Invariants

### Existing invariants preserved (verify post-implementation)

| ID | How preserved | Verification |
|---|---|---|
| Constitution #1–#14 | No new state without ownership; no silent failures; no fabricated data; etc. | Standard tester checklist |
| I-DESKTOP-GATE-VIA-HOOK | Every desktop branch reads `useResponsiveLayout()` | Strict-grep gate `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` already enforces |
| I-DISABLED-QUERY-IS-LOADING | Marketing routes still use `!hasResolved && !isError` pattern (ORCH-0889) | Strict-grep gate `orch-0889-disabled-query-loading-state.mjs` |
| I-STICKY-FOOTER-VIA-HOOK | FAB / sticky-footer offsets still flow through `useStickyFooterOffset` | Strict-grep gate `orch-0889-sticky-footer-via-hook.mjs` |
| I-RN-COLOR-FORMATS | All RN inline colors hex/rgba/hsl (no oklch/lab) | Visual review + grep |
| I-KEYBOARD-NEVER-BLOCKS-INPUT | Composer KAV unchanged on mobile | Manual sim repro |
| I-TOAST-NEEDS-ABSOLUTE-WRAP | No toast changes | n/a |
| I-SUB-SHEET-INSIDE-PARENT | On mobile, all sub-sheets still render inside parent KAV. On web, Radix Dialog uses portals correctly (invariant doesn't apply to Radix). | Per-file scope; manual review |
| I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE | InsertionBar bar root container is never conditionally rendered | Existing gate |
| I-CROSS-SURFACE-IMPACT | SPEC §2 declares surfaces; implementor Step 3.5 verifies | SPEC + report |

### NEW invariants established at CLOSE

| ID | Statement | Enforcement |
|---|---|---|
| **I-TIPTAP-WEB-ONLY** | Files importing `@tiptap/*` MUST live under `*.web.tsx` extension OR inside `Platform.OS === "web"`-gated dynamic imports. Native bundles must never resolve `@tiptap/*`. | Strict-grep CI gate `orch-0891-no-tiptap-in-native-bundle.mjs` (parallels `orch-0778-web-stripe-native-import-gate`) |
| **I-CHIP-DOM-CONTRACT** | Web composer chip DOM emission MUST match the class names in `composerChipHtml.ts` (`mingla-event-chip` with `▣` glyph, `mingla-personalization-chip`). | Strict-grep gate scans Tiptap node files for class-name compliance |
| **I-CHIP-BACKSPACE-VIA-DOM-HANDLER** | Chip atomic delete on web MUST use `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` verbatim. Tiptap keymap reimplementation of chip-backspace is forbidden. | Strict-grep gate rejects Tiptap `addKeyboardShortcuts.*Backspace` in chip node files |
| **I-MARKETING-PERFORMANCE-BUDGET** | Composer chunk ≤ 280 KB gz; other marketing routes ≤ +80 KB gz incremental. Drag-resize ≥60fps. Chip insert CLS = 0. ⌘K open ≤50ms. | Implementor reports bundle sizes post-build; tester verifies via Chrome DevTools |
| **I-DESKTOP-MODAL-VIA-SHEET-WEB** | Sub-sheet → desktop modal conversion goes through `Sheet.web.tsx`. No bespoke per-sheet Radix Dialog calls. | Code review at TEST; CI gate optional |
| **I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT** | Server-side `marketingEmailRender.ts` MUST default `{{event:UUID}}` (size-absent) to `medium`. Breaking this breaks every legacy campaign. | Edge function unit test (Deno test) |

---

## Section 6 — Test cases

### Per-strand test matrix

| Test | Strand | Scenario | Surface | Layer |
|---|---|---|---|---|
| T-01 | 1 | Tiptap mounts and renders editor | Web | Component (jest-RTL OR source-grep per ORCH-0889 precedent) |
| T-02 | 1 | InsertionBar variable insert produces correct chip DOM | Web | Integration (Tiptap + DOM inspect) |
| T-03 | 1 | InsertionBar event insert produces correct chip DOM | Web | Integration |
| T-04 | 1 | Backspace-after-chip deletes atomically | Web | Manual sim (Maestro-equivalent web e2e if available; otherwise manual) |
| T-05 | 1 | B/I/Link toolbar AND ⌘B/⌘I/⌘K shortcuts produce matching HTML | Web | Integration |
| T-06 | 1+5 | `htmlToTokenString` round-trip with extended `|size` suffix works for all 3 sizes + legacy | Unit | `tenTapTokenBridge.test.ts` extension |
| T-07 | 2 | `ComposerCanvas` renders side-by-side layout on wide-desktop | Web wide | Source-grep + render snapshot |
| T-08 | 2 | EmailPreviewPane updates within 100ms of keystroke | Web wide | Manual stopwatch |
| T-09 | 3 | All 7 keyboard shortcuts fire correct handlers | Web | jest with simulated KeyboardEvent |
| T-10 | 3 | Listener removed on unmount | Web | jest |
| T-11 | 4 | Template drawer is right-rail on desktop, bottom-sheet on narrow | Web both | Source-grep + manual |
| T-12 | 5 | Size picker S/M/L click updates `data-size` attr | Web wide | Manual |
| T-13 | 5 | Edge fn renders all 3 sizes correctly | Edge | Deno test + manual send-and-inspect |
| T-14 | 5 | Legacy size-less chip renders as medium | Edge | Deno test |
| T-15 | 6 | `Sheet.web.tsx` renders Dialog on wide, RN Sheet on narrow | Web | Source-grep + manual |
| T-16 | 6 | Esc + click-outside close Radix Dialog | Web wide | Manual |
| T-17 | 7 | ⌘K opens palette; commands route correctly | Web wide | Manual |
| T-18 | 7 | Recent campaigns / audiences / templates appear in palette when present | Web wide | Manual + jest with mocked hooks |
| T-19 | 8 | Shimmer animation runs on all 4 marketing routes | iOS + Android | Manual sim |
| T-20 | 8 | Haptics fire on every Marketing Pressable on native | iOS + Android | Manual sim + code grep |
| T-21 | 8 | New empty-state illustrations render on Marketing surfaces | iOS + Android + web | Manual sim |
| T-22 | 8 | Send-confirmation premium animation runs | iOS + Android | Manual sim |
| T-23 | 9 | Composer chunk ≤ 280 KB gz post-build | Web | `ls -lh dist/_expo/static/js/` |
| T-24 | 9 | Drag-resize ≥60fps | Web | Chrome DevTools Performance |
| T-25 | 9 | ⌘K open ≤50ms | Web | Chrome DevTools Performance |
| T-26 | 9 | Optimistic Send Now ≤200ms to confirmation | Web | Manual stopwatch |

### Step-0.5 mandatory regression tests (per milestone)

**M1 implementor-happy:** `mingla-business/src/components/marketing/ComposerV2/__tests__/richEditor.tiptap.test.ts` — asserts Tiptap nodes emit correct DOM + token-string round-trip.

**M1 tester-adversarial:** `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBackspace.adversarial.test.ts` — asserts the DOM backspace handler is installed verbatim (NOT reimplemented as Tiptap keymap) AND deletes chip + nbsp atomically.

**M2 implementor-happy:** `mingla-business/src/components/ui/__tests__/Sheet.web.test.ts` — asserts `Sheet.web.tsx` branches on `isWideDesktop` and the Radix Dialog branch emits the correct ARIA structure.

**M2 tester-adversarial:** `supabase/functions/_shared/__tests__/marketingEmailRender.eventChipSize.test.ts` (Deno test) — asserts all 3 size variants render correctly AND legacy size-less tokens default to medium.

**M3 implementor-happy:** `mingla-business/src/hooks/__tests__/useShimmer.test.ts` — asserts shimmer values cycle within the expected range.

**M3 tester-adversarial:** bundle-size assertion script `mingla-business/scripts/check-bundle-size.mjs` — runs `expo export --platform web` and asserts composer chunk ≤ 280 KB gz. CI-friendly.

All regression tests must demonstrate **fails-on-revert** per the ORCH-0840 [Regression-test enforcement] gate. Implementor cites passing runs AND fails-on-revert verification commit hashes in the implementation report.

---

## Section 7 — Implementation order (3 milestones, internal checkpoints, ONE final PR)

### M1 — Composer Tiptap web swap (week 1, ~5 engineer-days)

1. Install dependencies: `@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`. Pin versions.
2. Create Tiptap custom nodes: `EventChip`, `PersonalizationChip` at `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/`.
3. Rewrite `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` (full rewrite). Wire Tiptap editor with custom nodes + Link + StarterKit. Implement imperative ref API mapping (`commandDOM`, `insertHTML`, `setContentHTML`, `sendAction`, `insertLink`). Inject chip CSS via `<style>` tag. Install backspace handler verbatim.
4. Extend `tenTapTokenBridge.ts` for `|size` suffix support (forward-compatible; no `size` actually used yet).
5. Update `tenTapTokenBridge.test.ts` with size-suffix round-trip cases.
6. Add CI gates: `orch-0891-no-tiptap-in-native-bundle.mjs`, `orch-0891-chip-dom-contract.mjs`, `orch-0891-chip-backspace-via-dom-handler.mjs`.
7. Write M1 implementor-happy + tester-adversarial regression tests; verify fails-on-revert.
8. **M1 checkpoint:** push to `Seth`, operator smoke-tests "can I author and send a chip-pill blast from web?" — if YES, proceed to M2; if NO, fix and re-checkpoint.

### M2 — Desktop layout primitives + power features (week 2, ~6 engineer-days)

9. Build `Sheet.web.tsx` primitive (Radix Dialog branch). Install `@radix-ui/react-dialog`.
10. Build `ComposerCanvas.web.tsx` split layout. Wire `compose.tsx` to use it on wide-desktop. Hide Preview button on wide-desktop. Remove the Modal-wrapped EmailPreviewPane from the wide-desktop path.
11. Build `TemplatePreviewDrawer.web.tsx` right-rail variant. Wire ComposerCanvas to slot it in when `showTemplateDrawer` is true.
12. Build `EventChipResizable.web.tsx` NodeView with click-to-change S/M/L picker. Update `EventChip` Tiptap node to use the NodeView on web.
13. Extend `marketingEmailRender.ts` (edge function) to honor `data-size` and `|size` token suffix. Deno test passes.
14. Build `useComposerKeyboardShortcuts.web.ts` hook. Wire on composer route.
15. Install `cmdk`. Build `CommandPalette.web.tsx`. Build `useCommandPalette` Zustand store. Mount in `(tabs)/_layout.tsx` web-only.
16. Add CI gates: `orch-0891-desktop-modal-via-sheet-web.mjs` (optional — code review may suffice), `orch-0891-event-chip-size-backwards-compat.mjs` (Deno-side gate inspecting marketingEmailRender for the `medium` default).
17. Write M2 implementor-happy + tester-adversarial regression tests; verify fails-on-revert.
18. **M2 checkpoint:** push to `Seth`, **operator runs `supabase functions deploy marketing-send`** to ship the renderer change. Operator smoke-tests "live preview works, ⌘K opens, drag-resize changes chip rendering in inbox" — if YES, proceed to M3; if NO, fix and re-checkpoint.

### M3 — Mobile premium polish + performance contract (week 3, ~5 engineer-days)

19. Build `useShimmer` hook.
20. Replace static skeletons on 4 Marketing list routes with shimmer variants.
21. Add Haptics to every Pressable in Marketing surfaces (audit pass + grep verification).
22. Add scale-on-press to every Pressable in Marketing surfaces.
23. Add fade-in stagger to list items on mount (Overview recent campaigns, Audiences, Campaigns, Templates).
24. Designer-supplied SVG illustrations integrated into `EmptyState` with new illustration keys: `marketing-audiences`, `marketing-campaigns`, `marketing-templates`. Update each route to pass the new key.
25. Upgrade `ComposerSentConfirmation` with the designer-specified premium animation. Haptic burst on mount.
26. Bundle-size verification: `expo export --platform web`, capture output of `ls -lh dist/_expo/static/js/`, document chunk sizes in implementation report.
27. Performance verification: Chrome DevTools Performance recording during drag-resize (assert ≥60fps), chip insert (assert CLS = 0), ⌘K open (assert ≤50ms). Documented in implementation report.
28. Add CI gate: `orch-0891-marketing-performance-budget.mjs` — measures composer chunk size on every build, exits 1 if > 280 KB gz.
29. Write M3 implementor-happy + tester-adversarial regression tests; verify fails-on-revert.
30. **M3 checkpoint:** push to `Seth`, operator final smoke-test on iOS sim + Android emu + web wide-desktop + web narrow. If ALL PASS, implementor opens PR `Seth → main` with title `Close ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish]`. If any fails, fix and re-checkpoint.

### Total: ~16 engineer-days + ~3 designer-days (concurrent with M1 + M2)

---

## Section 8 — File manifest

### NEW files (~20)

| # | File | Strand | Lines (est) |
|---|------|--------|-------|
| 1 | `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChip.web.ts` | 1, 5 | ~80 |
| 2 | `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/PersonalizationChip.web.ts` | 1 | ~50 |
| 3 | `mingla-business/src/components/marketing/ComposerV2/tiptapNodes/EventChipResizable.web.tsx` | 5 | ~120 |
| 4 | `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.web.tsx` | 2 | ~140 |
| 5 | `mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.tsx` (native passthrough) | 2 | ~25 |
| 6 | `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx` | 4 | ~180 |
| 7 | `mingla-business/src/components/ui/Sheet.web.tsx` | 6 | ~120 |
| 8 | `mingla-business/src/components/ui/CommandPalette.web.tsx` | 7 | ~200 |
| 9 | `mingla-business/src/hooks/useShimmer.ts` | 8 | ~40 |
| 10 | `mingla-business/src/hooks/useCommandPaletteState.ts` | 7 | ~30 |
| 11 | `mingla-business/src/hooks/useComposerKeyboardShortcuts.web.ts` | 3 | ~60 |
| 12 | `mingla-business/src/hooks/useComposerKeyboardShortcuts.ts` (native no-op) | 3 | ~15 |
| 13 | `.github/scripts/strict-grep/orch-0891-no-tiptap-in-native-bundle.mjs` | 1 | ~100 |
| 14 | `.github/scripts/strict-grep/orch-0891-chip-dom-contract.mjs` | 1 | ~120 |
| 15 | `.github/scripts/strict-grep/orch-0891-chip-backspace-via-dom-handler.mjs` | 1 | ~100 |
| 16 | `.github/scripts/strict-grep/orch-0891-marketing-performance-budget.mjs` | 9 | ~80 |
| 17 | `mingla-business/scripts/check-bundle-size.mjs` | 9 | ~60 |
| 18 | `mingla-business/assets/illustrations/marketing/audiences-empty.svg` (designer-supplied) | 8 | designer |
| 19 | `mingla-business/assets/illustrations/marketing/campaigns-empty.svg` | 8 | designer |
| 20 | `mingla-business/assets/illustrations/marketing/templates-empty.svg` | 8 | designer |

### NEW tests (~6)

| # | File | Strand |
|---|---|---|
| 21 | `mingla-business/src/components/marketing/ComposerV2/__tests__/richEditor.tiptap.test.ts` | M1 impl |
| 22 | `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBackspace.adversarial.test.ts` | M1 tester |
| 23 | `mingla-business/src/components/ui/__tests__/Sheet.web.test.ts` | M2 impl |
| 24 | `supabase/functions/_shared/__tests__/marketingEmailRender.eventChipSize.test.ts` (Deno test) | M2 tester |
| 25 | `mingla-business/src/hooks/__tests__/useShimmer.test.ts` | M3 impl |
| 26 | `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.sizeAttr.test.ts` (extension to existing test file via append) | M1 |

### MODIFIED files (~15)

| # | File | Strand | Net lines |
|---|------|--------|-----------|
| 27 | `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` | 1 | -390 / +700 (full rewrite) |
| 28 | `mingla-business/src/services/marketing/tenTapTokenBridge.ts` | 1, 5 | +60 (extend regexes + types) |
| 29 | `mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts` | 5 | +25 (size-picker CSS) |
| 30 | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | 2, 4 | +60 (wire ComposerCanvas + drawer state) |
| 31 | `mingla-business/app/(tabs)/_layout.tsx` | 7 | +5 (mount CommandPalette on web) |
| 32 | `mingla-business/app/(tabs)/marketing/index.tsx` | 8 | +20 (shimmer + haptics + scale + fade-in) |
| 33 | `mingla-business/app/(tabs)/marketing/audiences/index.tsx` | 8 | +25 |
| 34 | `mingla-business/app/(tabs)/marketing/campaigns/index.tsx` | 8 | +25 |
| 35 | `mingla-business/app/(tabs)/marketing/templates/index.tsx` | 8 | +20 |
| 36 | `mingla-business/src/components/marketing/ComposerSentConfirmation.tsx` | 8 | +50 (premium animation) |
| 37 | `mingla-business/src/components/ui/EmptyState.tsx` | 8 | +30 (new illustration keys) |
| 38 | `mingla-business/src/components/marketing/AudiencePickerSheet.tsx` | (inherits Sheet.web) | 0 net (no change — inherits) |
| 39 | `mingla-business/src/components/marketing/ComposerReviewSheet.tsx` | (inherits Sheet.web) | 0 net |
| 40 | `mingla-business/src/components/marketing/ComposerV2/SchedulePickerSheet.tsx` | (inherits Sheet.web) | 0 net |
| 41 | `supabase/functions/_shared/marketingEmailRender.ts` (edge fn) | 5 | +40 (read data-size suffix, render size variants) |
| 42 | `.github/workflows/strict-grep-mingla-business.yml` | (CI wiring) | +44 (register 4 new gates) |
| 43 | `mingla-business/package.json` | (deps) | +6 (Tiptap, Radix Dialog, cmdk) |

**Total scope: ~26 new files + ~17 modified files = ~43 file diffs in the implementor PR.** Larger than ORCH-0889 by design; this is the bundled scope.

---

## Section 9 — Hard guards (for implementor)

1. **DO NOT touch** `richEditor.native.ts` (pell SDK passthrough). Native composer stays bit-identical.
2. **DO NOT touch** `marketingCampaignService.ts`, `marketingAudienceService.ts`, `marketingRenderingService.ts`, `marketingTemplateService.ts`, `brandEvents.ts`. ONLY `marketingEmailRender.ts` (edge function) gets modified.
3. **DO NOT run** `supabase db push --linked` — zero migrations.
4. **DO NOT deploy** any edge function yourself until M2 checkpoint. Operator runs `supabase functions deploy marketing-send` between M2 and M3 (standing deploy split for edge functions).
5. **DO NOT** invent chip CSS — reuse `composerChipHtml.ts` `COMPOSER_CHIP_CSS` verbatim. New CSS goes into the same file under a clearly-marked extension section.
6. **DO NOT** reimplement chip backspace via Tiptap keymap — use `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` verbatim. I-CHIP-BACKSPACE-VIA-DOM-HANDLER enforces this.
7. **DO NOT** add Tiptap imports to any file outside `*.web.tsx` or web-gated dynamic imports. I-TIPTAP-WEB-ONLY enforces.
8. **DO NOT** bundle this ORCH with any other CLOSE — one PR per CLOSE per `feedback_one_pr_per_close.md`. The operator authorized ORCH-0891 as a single-ORCH bundle absorbing 0885-C + 0885-D-1/3/4 + Marketing mobile polish strand; the PR title at CLOSE lists all absorbed sub-ORCH IDs.
9. **DO NOT include** `Co-Authored-By` lines in the commit message (operator preference).
10. **DO use** `/mingla-designer` deliverables produced during pre-flight. Cite the designer artifact paths in the implementation report. If a designer deliverable is missing, STOP and request it before continuing.
11. **DO use** route-level code-splitting via Expo Router's dynamic route imports OR React.lazy to keep the composer chunk under 280 KB gz.
12. **DO measure** bundle sizes via `expo export --platform web && ls -lh dist/_expo/static/js/` post-implementation; report in M3 implementation report.

---

## Section 10 — Regression prevention summary

For each of the 6 new invariants in §5, a CI gate is established. The 4 strict-grep gates land in M1/M2 (depending on which strand they protect); the bundle-size gate lands in M3; the edge-function backwards-compat gate lands in M2 (Deno test).

The 6 milestone-paired regression tests (3 implementor + 3 tester) ALL ship in the same PR. Each test has fails-on-revert verified at a specific commit hash, cited in the implementation report.

---

## Section 11 — Hard-coded acceptance gate for CLOSE

The orchestrator MUST verify, before CLOSE:

1. All 9 strands have at least one PASS criterion in the QA report.
2. All 36 success criteria (SC-1..SC-37, accounting for surface suffixes) have either PASS or accepted CONDITIONAL PASS (with operator-named follow-up ORCH).
3. All 6 new invariants have CI gates green.
4. All 6 milestone regression tests cite passing runs AND fails-on-revert verification commit hashes.
5. M3 bundle-size assertion lands in the implementation report with actual chunk sizes.
6. Edge-function deploy was run by operator (verified via `mcp__supabase__list_edge_functions` showing `marketing-send` version bumped).
7. PR title includes the absorbed ORCH list: `Close ORCH-0891 (absorbs ORCH-0885-C + ORCH-0885-D-1 + ORCH-0885-D-3 + ORCH-0885-D-4 + Marketing mobile polish): Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish`.

---

## Section 12 — Layman summary

- ORCH-0891 ships the premium Marketing Hub experience in one comprehensive PR over ~3 weeks: Tiptap-backed web composer with proper chip pills, side-by-side live preview pane on desktop, keyboard shortcuts, right-side template drawer, drag-resize event cards, sub-sheets as centered desktop modals, ⌘K command palette, and a complete mobile premium polish pass (shimmer skeletons, haptics, micro-interactions, illustration upgrade, send-confirmation animation).
- Native iOS/Android composer is bit-identical to today — only `richEditor.native.ts` is left alone. The web composer becomes Tiptap-backed; mobile keeps pell.
- The chip visual contract is already in production — Tiptap just emits DOM with the existing CSS class names and the existing chip CSS handles all the visual styling. Same for atomic backspace — the existing DOM handler is library-agnostic and gets installed in the Tiptap editor verbatim.
- One small server-side change: the `marketing-send` edge function learns to honor an optional `data-size` attribute on event chips so drag-resize actually changes the email rendering. The change is backwards-compatible (legacy chips default to medium). Operator deploys once between M2 and M3.
- Bundle-size impact: +95-150 KB gzipped on the web bundle, gated behind route-level code-splitting so users only pay the cost when they open the composer. Codified as a performance budget with a CI gate that fails the build if the composer chunk exceeds 280 KB gz.
- Designer pre-flight is mandatory before implementor begins. The desktop mocks at `Mingla_Artifacts/design/desktop-redesign/` cover the rail/canvas/master-detail/palette aesthetic but NOT the composer specifically. Designer produces 9 deliverables (layout dimensions, toolbar treatment, drawer width, palette aesthetic, drag-resize affordance, send-confirmation animation, 3 illustrations, shimmer spec, chip size visuals).
- Implementor staged into 3 internal milestones with operator checkpoint review at each. PR opens to main only after M3 completes. Operator can redirect at any checkpoint without breaking the one-PR-per-CLOSE rule.
- 6 new invariants codified at CLOSE: I-TIPTAP-WEB-ONLY, I-CHIP-DOM-CONTRACT, I-CHIP-BACKSPACE-VIA-DOM-HANDLER, I-MARKETING-PERFORMANCE-BUDGET, I-DESKTOP-MODAL-VIA-SHEET-WEB, I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT. All backed by CI gates.

---

**Spec status:** READY FOR DESIGNER PRE-FLIGHT, THEN IMPLEMENTOR DISPATCH.
