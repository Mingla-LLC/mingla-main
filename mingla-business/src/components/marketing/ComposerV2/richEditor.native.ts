/**
 * pell-rich-editor platform shim — NATIVE side (iOS / Android).
 *
 * Re-exports the real `react-native-pell-rich-editor` SDK. Metro auto-
 * resolves this file on iOS + Android via the `.native.ts` extension;
 * web bundles fall through to `./richEditor.tsx` (placeholder stub).
 *
 * Why this split exists (root-cause fix from ORCH-0886, 2026-05-19):
 * `react-native-pell-rich-editor/src/editor.js` invokes a template literal
 * containing `${window.__DEV__}` at module-load time. Expo Router's
 * static-SSR pass evaluates the bundle in Node (no `window`) and crashes
 * before any React renders — blocking ALL web routes, not just the
 * Marketing Composer screen. Routing the import through this platform-
 * split keeps the editor available on iOS/Android (where it actually
 * works — WebView-based, native env) and substitutes a placeholder
 * component on web so the dev preview + Vercel buyer routes load.
 *
 * Mirrors the same precedent used for `StripeProviderWrapper.native.tsx`
 * and our new Sentry split (`diagnostics/sentry.native.ts`).
 *
 * Public surface — must stay in sync with `./richEditor.tsx`:
 *   - RichEditor (class component + ref API)
 *   - actions (constants enum used by sendAction calls)
 * If a future caller uses RichToolbar / defaultActions / createHTML /
 * getContentCSS, add them here AND to the web stub.
 */

export { RichEditor, actions } from "react-native-pell-rich-editor";

// ORCH-0891 M1 — structural ref-handle type for cross-platform ref typing.
// Pell's RichEditor class instance has all of these methods (and more);
// the web side exports a forwardRef component with the same imperative
// shape. Consumers (ComposerV2Editor) type the ref as
// `useRef<RichEditorHandle>(null)` so the same code compiles on both
// platforms.
export interface RichEditorHandle {
  commandDOM: (js: string) => void;
  insertHTML: (html: string) => void;
  setContentHTML: (html: string) => void;
  sendAction: (action: string, name?: string, value?: unknown) => void;
  insertLink: (text: string, url: string) => void;
}
