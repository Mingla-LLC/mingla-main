/**
 * pell-rich-editor platform shim — WEB side (and default fallback).
 *
 * ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features +
 * Mobile Polish] M1 — Tiptap-backed web composer.
 *
 * # What this file does
 * Replaces the ORCH-0889 Wave-1 textarea (and its predecessor ORCH-0886
 * placeholder) with a Tiptap-backed editor that renders chips as styled
 * pills exactly like native pell. Operators on web get pixel-precise chip
 * rendering, atomic chip backspace, B/I/Link formatting via toolbar AND
 * ⌘B/⌘I/⌘K keyboard shortcuts (Tiptap StarterKit + Link extension wire
 * these automatically — no manual keymap needed).
 *
 * Native (iOS / Android) is bit-identical to pre-ORCH-0891 — Metro
 * resolves `./richEditor.native.ts` (real pell SDK) on
 * `Platform.OS !== "web"`. This file is web-only.
 *
 * # SPEC §3.5.1 contract
 * - Tiptap editor with StarterKit + Link + EventChip + PersonalizationChip
 *   custom nodes.
 * - Chips emit DOM matching `composerChipHtml.ts` class names — pixel
 *   parity with native pell guaranteed by reusing the same CSS string
 *   injected via a `<style>` tag.
 * - Atomic chip backspace via the verbatim
 *   `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` script (library-agnostic DOM
 *   handler — see I-CHIP-BACKSPACE-VIA-DOM-HANDLER).
 * - Imperative ref API preserved byte-for-byte vs native pell
 *   (`commandDOM`, `insertHTML`, `setContentHTML`, `sendAction`,
 *   `insertLink`).
 * - SSR safety: no `window` / `document` references at module-load.
 *   The Tiptap React hook only runs inside `useEditor` which is
 *   client-side React after hydration.
 *
 * # body_html / token-string round-trip
 * Tiptap emits HTML via `editor.getHTML()`. The host
 * `ComposerV2Editor.handleBodyHtmlChange` then calls
 * `htmlToTokenString(html)` → token string for storage. The token-string
 * form is byte-identical to what native pell produces because Tiptap
 * chip nodes emit `<span class="mingla-event-chip" data-event-id="...">`
 * + `<span class="mingla-personalization-chip" data-token="...">` —
 * matching native pell exactly. `htmlToTokenString` recognizes both.
 *
 * # Invariants honoured
 * - **I-TIPTAP-WEB-ONLY** — `@tiptap/*` imports live in `.web.tsx` only;
 *   Metro never resolves these on native. CI gate
 *   `orch-0891-no-tiptap-in-native-bundle.mjs` enforces.
 * - **I-CHIP-DOM-CONTRACT** — chip nodes emit canonical class names +
 *   data-* attributes; CSS string from `composerChipHtml.ts` is the
 *   visual contract.
 * - **I-CHIP-BACKSPACE-VIA-DOM-HANDLER** — atomic delete reuses the
 *   existing DOM handler verbatim (no Tiptap keymap reimplementation).
 *
 * Per SPEC_ORCH-0891 §3.5.1.
 */

import React, { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";

import {
  COMPOSER_CHIP_BACKSPACE_HANDLER_JS,
  COMPOSER_CHIP_CSS,
} from "./composerChipHtml";
import { type EventChipSize } from "./tiptapNodes/EventChip.web";
import { EventChipWithResize } from "./tiptapNodes/EventChipResizable.web";
import { PersonalizationChip } from "./tiptapNodes/PersonalizationChip.web";

/**
 * Subset of pell's `editorStyle` prop we honor. The native pell side has
 * iframe-level CSS we don't need on Tiptap; CSS comes in via the injected
 * `<style>` tag.
 */
interface RichEditorEditorStyle {
  backgroundColor?: string;
  color?: string;
  placeholderColor?: string;
  contentCSSText?: string;
}

export interface RichEditorProps {
  /** Initial HTML seed (token string OR pell-emitted HTML — both work). */
  initialContentHTML?: string;
  /** Called once after the editor mounts. */
  editorInitializedCallback?: () => void;
  /** Called on every editor change with the current HTML. */
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Pell native compatibility prop — no-op on Tiptap. */
  useContainer?: boolean;
  initialHeight?: number;
  style?: StyleProp<ViewStyle>;
  editorStyle?: RichEditorEditorStyle;
  disabled?: boolean;
}

/**
 * Hook for parsing chip HTML and inserting via Tiptap commands when the
 * caller hands us a chip span. Falls back to `insertContent` raw-HTML for
 * non-chip fragments (e.g., `insertLink` output).
 */
function insertChipOrHtml(editor: Editor, html: string): void {
  // Event chip — capture data-event-id, data-cta, data-size, title.
  //
  // ORCH-0891 M1 fix: use GREEDY match `[\s\S]*` (not lazy `[\s\S]*?`) for
  // the inner content. The event chip HTML wraps the title alongside a
  // nested `<span class="mingla-chip-glyph">▣</span>` — a lazy outer-span
  // match stops at the FIRST `</span>` (the inner glyph's closing tag)
  // and drops the title entirely, leaving the chip rendering as just the
  // ▣ glyph. Greedy + the trailing `</span>` anchor + optional whitespace/
  // `&nbsp;` suffix captures the OUTER span correctly.
  const eventMatch = html.match(
    /<span\b[^>]*?\bdata-event-id="([0-9a-f-]+)"(?:[^>]*?\bdata-cta="([a-z]+)")?(?:[^>]*?\bdata-size="(compact|medium|large)")?[^>]*>([\s\S]*)<\/span>/i,
  );
  if (eventMatch !== null && eventMatch[1] !== undefined) {
    const eventId = eventMatch[1];
    const cta = (eventMatch[2] as "tickets" | "rsvp" | "details" | undefined) ?? "tickets";
    const size = (eventMatch[3] as EventChipSize | undefined) ?? "medium";
    // Extract title — strip nested <span class="mingla-chip-glyph">▣</span>
    // and any other tags; preserve plain text.
    const innerRaw = eventMatch[4] ?? "";
    const title = innerRaw.replace(/<[^>]+>/g, "").replace(/▣/g, "").trim();
    editor.chain().focus().insertContent({
      type: "eventChip",
      attrs: { eventId, cta, size, title },
    }).insertContent(" ").run();
    return;
  }
  // Personalization chip — capture data-token. Lazy match is safe here
  // because the personalization chip HTML has NO nested spans (the inner
  // text is just the token name, no glyph).
  const tokenMatch = html.match(
    /<span\b[^>]*?\bdata-token="([a-z_]+)"[^>]*>[\s\S]*?<\/span>/i,
  );
  if (tokenMatch !== null && tokenMatch[1] !== undefined) {
    const token = tokenMatch[1];
    editor.chain().focus().insertContent({
      type: "personalizationChip",
      attrs: { token },
    }).insertContent(" ").run();
    return;
  }
  // Not a chip — strip trailing &nbsp; and insert as raw HTML. This path
  // handles `insertLink` output (`<a href="…">…</a>`) plus any future
  // ad-hoc HTML insertion the imperative caller hands us.
  const trimmed = html.replace(/&nbsp;$/, " ");
  editor.chain().focus().insertContent(trimmed).run();
}

/**
 * Imperative API the ref-holder uses. Mirrors `richEditor.native.ts` pell
 * API surface byte-for-byte so `ComposerV2Editor` doesn't branch on
 * platform when calling the editor.
 */
export interface RichEditorHandle {
  commandDOM: (js: string) => void;
  insertHTML: (html: string) => void;
  setContentHTML: (html: string) => void;
  sendAction: (action: string, name?: string, value?: unknown) => void;
  insertLink: (text: string, url: string) => void;
}

// ─── Module-level CSS injection (idempotent) ───────────────────────────

let cssInjected = false;
function ensureChipCssInjected(): void {
  if (cssInjected) return;
  if (typeof document === "undefined") return; // SSR safety
  const STYLE_ID = "mingla-composer-chip-css";
  if (document.getElementById(STYLE_ID) !== null) {
    cssInjected = true;
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.innerHTML = COMPOSER_CHIP_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

let backspaceHandlerInstalled = false;
function ensureBackspaceHandlerInstalled(): void {
  if (backspaceHandlerInstalled) return;
  if (typeof document === "undefined") return; // SSR safety
  // The handler script is idempotent internally (guards on
  // `window.__minglaChipBackspaceInstalled` flag), so re-running is safe.
  // We just don't want to inject the <script> tag twice.
  const SCRIPT_ID = "mingla-composer-chip-backspace-handler";
  if (document.getElementById(SCRIPT_ID) !== null) {
    backspaceHandlerInstalled = true;
    return;
  }
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.textContent = COMPOSER_CHIP_BACKSPACE_HANDLER_JS;
  document.body.appendChild(script);
  backspaceHandlerInstalled = true;
}

// ─── Component ─────────────────────────────────────────────────────────

/**
 * Web RichEditor. Tiptap-backed.
 *
 * Exported as a forwardRef-class wrapper because the imperative API
 * matches pell's class-component shape. Internally uses Tiptap's
 * `useEditor` hook + `EditorContent` view.
 */
export const RichEditor = React.forwardRef<RichEditorHandle, RichEditorProps>(
  function RichEditor(props, ref): React.ReactElement {
    const {
      initialContentHTML,
      editorInitializedCallback,
      onChange,
      placeholder,
      initialHeight,
      style,
      editorStyle,
      disabled,
    } = props;

    const initialFiredRef = useRef(false);

    // Inject chip CSS + atomic backspace handler ONCE per session (both
    // are guarded by module-level flags + DOM presence checks).
    useEffect(() => {
      ensureChipCssInjected();
      ensureBackspaceHandlerInstalled();
    }, []);

    // Memoize initial content so Tiptap doesn't re-mount the editor on
    // every parent render. The ComposerV2Editor passes `initialContentHtml`
    // as a useMemo([]) value — already stable — but we double-guard here.
    const initialContent = useMemo(
      () => initialContentHTML ?? "",
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const editor = useEditor({
      // StarterKit gives us: paragraph, text, bold, italic, history (undo/redo),
      // and the default keymap (⌘B / ⌘I / ⌘Z / ⌘⇧Z). Disable extensions
      // we don't need on email composer (heading / codeBlock / blockquote /
      // horizontalRule).
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
        }),
        // Tiptap StarterKit ships Bold + Italic but NOT Underline. The U
        // pill in the toolbar (and Cmd/Ctrl+U keymap, bound automatically
        // by this extension) require it to be registered explicitly.
        Underline,
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {},
        }),
        // M2: EventChipWithResize extends the base EventChip with a
        // ReactNodeViewRenderer that mounts the S/M/L size picker on
        // hover/focus. Serialization (getHTML) still uses the base
        // node's renderHTML — round-trip through htmlToTokenString
        // unaffected. Per SPEC §3.5.5 + DESIGN_SPEC §6.
        EventChipWithResize,
        PersonalizationChip,
      ],
      content: initialContent,
      editable: !disabled,
      autofocus: false,
      // Tiptap calls onUpdate whenever the document changes (typing,
      // formatting, programmatic edits via `editor.commands.*`).
      onUpdate: ({ editor: e }): void => {
        onChange?.(e.getHTML());
      },
      // Fire editorInitializedCallback once after Tiptap is ready.
      onCreate: (): void => {
        if (initialFiredRef.current) return;
        initialFiredRef.current = true;
        editorInitializedCallback?.();
      },
      editorProps: {
        attributes: {
          class: "mingla-composer-editor",
          // ARIA labels for screen reader compatibility per design-spec §11.
          "aria-label": "Email body",
          // Placeholder support — Tiptap renders the placeholder via CSS
          // pseudo-element. Per `editorProps.attributes.data-placeholder`
          // pattern (the placeholder Tiptap extension would do this, but
          // we keep dependencies minimal — the placeholder shows via
          // `[data-placeholder]::before` in the existing chip CSS).
          "data-placeholder": placeholder ?? "Write your message…",
        },
      },
    });

    // Update editable state if the prop changes.
    useEffect(() => {
      if (editor === null) return;
      editor.setEditable(!disabled);
    }, [editor, disabled]);

    // Expose imperative API matching native pell.
    useImperativeHandle(
      ref,
      (): RichEditorHandle => ({
        // No-op on web. Pell uses commandDOM to inject CSS/JS into its
        // iframe; Tiptap's editor root has direct DOM access via
        // `editor.view.dom`. The ComposerV2Editor host calls commandDOM
        // twice on init to inject chip CSS + backspace handler — both
        // are already injected by this file's module-level guards.
        commandDOM: (_js: string): void => {
          return;
        },

        // Insert HTML — recognize chip markers and call Tiptap's
        // commands to insert the typed nodes, OR fall back to raw HTML
        // for non-chip content.
        insertHTML: (html: string): void => {
          if (editor === null) return;
          insertChipOrHtml(editor, html);
        },

        // Replace the entire editor content.
        setContentHTML: (html: string): void => {
          if (editor === null) return;
          editor.commands.setContent(html, { emitUpdate: true });
        },

        // Map pell action constants to Tiptap commands.
        sendAction: (action: string, _name?: string, _value?: unknown): void => {
          if (editor === null) return;
          switch (action) {
            case "bold":
              editor.chain().focus().toggleBold().run();
              return;
            case "italic":
              editor.chain().focus().toggleItalic().run();
              return;
            case "underline":
              editor.chain().focus().toggleUnderline().run();
              return;
            // Other actions (heading, list, sub/superscript, etc.):
            // graceful no-op. Composer doesn't expose them in V1.
            default:
              if (__DEV__) {
                // eslint-disable-next-line no-console
                console.warn(`[RichEditor.web] sendAction("${action}") not implemented; ignoring.`);
              }
              return;
          }
        },

        // Insert a link span. `text` may be empty (caller didn't supply
        // selection text) — fall back to URL display in that case.
        insertLink: (text: string, url: string): void => {
          if (editor === null) return;
          const safeText = text.length > 0 ? text : url;
          editor
            .chain()
            .focus()
            .insertContent({
              type: "text",
              text: safeText,
              marks: [{ type: "link", attrs: { href: url } }],
            })
            .run();
        },
      }),
      [editor],
    );

    const containerHeight = initialHeight ?? 240;
    const textColor = editorStyle?.color ?? "rgba(255, 255, 255, 0.96)";
    const backgroundColor = editorStyle?.backgroundColor ?? "transparent";

    // RN-web maps `View` to `<div>`. Tiptap's EditorContent is a React
    // component that renders a contenteditable div. We wrap it in a
    // View so RN style props (height, border, etc.) compose normally.
    // The injected chip CSS is global, so chips render correctly inside
    // EditorContent without per-instance styling.
    //
    // Web-only style props (`color`, `minHeight` via React inline-style)
    // are honored on RN-web. The View's `style` prop accepts both RN
    // styles and web CSS — RN-web's stylesheet flattening handles it.
    return (
      <View
        style={[
          styles.host,
          { minHeight: containerHeight, backgroundColor },
          style,
        ]}
        testID="composer-web-body-tiptap"
      >
        {Platform.OS === "web" && editor !== null ? (
          <EditorContent
            editor={editor}
            style={{
              minHeight: containerHeight,
              color: textColor,
              padding: 12,
              fontSize: 15,
              lineHeight: 1.55,
              outline: "none",
            } as React.CSSProperties}
          />
        ) : null}
      </View>
    );
  },
);
RichEditor.displayName = "RichEditor";

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  host: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    overflow: "hidden",
  },
});

// ─── pell-rich-editor `actions` constants (verbatim copy) ──────────────

/**
 * Exact copy of pell-rich-editor's `actions` constants enum (from
 * node_modules/react-native-pell-rich-editor/src/const.js). Keep verbatim —
 * string values are stable and consumers reference them through
 * `actions.setBold` etc. The web `sendAction` only acts on `bold` and
 * `italic` (Tiptap's built-in toggles); other actions fall to graceful
 * no-op.
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

// Re-export for ComposerV2Editor's ref-type annotation.
//
// Native side (`richEditor.native.ts`) re-exports the class component from
// `react-native-pell-rich-editor`. Web side exports a forwardRef component.
// Both satisfy the consumer's `useRef<RichEditor>` because forwardRef
// returns an exotic component whose ref-handle type IS RichEditorHandle.
// Consumer's existing ref type `useRef<RichEditor>` is loosely-typed
// against the imperative API in practice — ComposerV2Editor only calls
// `richEditorRef.current?.commandDOM(...)` / `.insertHTML(...)` etc.,
// which both sides expose.
