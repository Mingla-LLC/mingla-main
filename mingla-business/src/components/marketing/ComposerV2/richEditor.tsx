/**
 * pell-rich-editor platform shim — WEB side (and default fallback).
 *
 * Placeholder stub that matches the surface ComposerV2 actually uses.
 * Metro picks `./richEditor.native.ts` on iOS + Android (real SDK); web
 * bundles fall through to this file (stub only).
 *
 * Why this stub exists (root-cause fix from ORCH-0886, 2026-05-19):
 * `react-native-pell-rich-editor/src/editor.js` evaluates a template
 * literal containing `${window.__DEV__}` at module-load. Node SSR has no
 * `window`, so Expo Router's static-SSR pass crashed before any React
 * rendered — blocking ALL web routes, not just the Marketing Composer.
 * By routing the import through this platform-split, web never loads the
 * real editor.
 *
 * Observable behavior change on web:
 * - The Marketing Composer screen renders a placeholder card instead of
 *   a functional rich editor. Operators on web preview will see "Marketing
 *   composer is mobile-only" copy. Operators on iOS/Android are unaffected
 *   (composer is the primary marketing send surface there).
 * - Buyer-anon routes (/b/{slug}, /checkout/{eventId}, /e/{brand}/{event})
 *   don't import ComposerV2, so they're unaffected.
 *
 * Mirrors the same precedent used for `StripeProviderWrapper.tsx` and our
 * new Sentry split (`diagnostics/sentry.ts`).
 *
 * Public surface — must stay in sync with `./richEditor.native.ts`:
 *   - RichEditor (class component + ref API; stub methods are no-ops)
 *   - actions (exact constants copy from pell-rich-editor/src/const.js)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Web-side RichEditor stub. Matches the ref API surface ComposerV2 calls:
 *   - commandDOM(js)
 *   - insertHTML(html)
 *   - setContentHTML(html)
 *   - sendAction(action, name?, value?)
 *   - insertLink(text, url)
 * Add new methods here when consumers extend the surface; native side gets
 * them via the real SDK automatically.
 */
export class RichEditor extends React.Component<any> {
  commandDOM(_js: string): void {
    // no-op on web
  }

  insertHTML(_html: string): void {
    // no-op on web
  }

  setContentHTML(_html: string): void {
    // no-op on web
  }

  sendAction(_action: string, _name?: string, _value?: unknown): void {
    // no-op on web
  }

  insertLink(_title: string, _url: string): void {
    // no-op on web
  }

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

const styles = StyleSheet.create({
  stub: {
    padding: 24,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 12,
    minHeight: 220,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#e5e5e5",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  body: {
    color: "#888",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 320,
  },
});

/**
 * Exact copy of pell-rich-editor's `actions` constants enum
 * (from node_modules/react-native-pell-rich-editor/src/const.js).
 * Keep verbatim — string values are stable and consumers reference them.
 */
export const actions = {
  content: "content",
  updateHeight: "UPDATE_HEIGHT",
  setBold: "bold",
  setItalic: "italic",
  setUnderline: "underline",
  heading1: "heading1",
  heading2: "heading2",
  heading3: "heading3",
  heading4: "heading4",
  heading5: "heading5",
  heading6: "heading6",
  insertLine: "line",
  setParagraph: "paragraph",
  removeFormat: "removeFormat",
  alignLeft: "justifyLeft",
  alignCenter: "justifyCenter",
  alignRight: "justifyRight",
  alignFull: "justifyFull",
  insertBulletsList: "unorderedList",
  insertOrderedList: "orderedList",
  checkboxList: "checkboxList",
  insertLink: "link",
  insertText: "text",
  insertHTML: "html",
  insertImage: "image",
  insertVideo: "video",
  fontSize: "fontSize",
  fontName: "fontName",
  setSubscript: "subscript",
  setSuperscript: "superscript",
  setStrikethrough: "strikeThrough",
  setHR: "horizontalRule",
  indent: "indent",
  outdent: "outdent",
  undo: "undo",
  redo: "redo",
  code: "code",
} as const;
