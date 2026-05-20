/**
 * useComposerKeyboardShortcuts.web — ORCH-0891 M2 composer keyboard shortcuts.
 *
 * Installs a `keydown` listener on the window (web-only — native sibling is
 * a no-op) that wires the composer route's ⌘ shortcuts per SPEC §3.4.3:
 *
 *   ⌘B (Ctrl+B on Windows/Linux)    → onBold
 *   ⌘I                              → onItalic
 *   ⌘K                              → onLink (link prompt)
 *   ⌘⏎                              → onSendNow (opens review sheet)
 *   ⌘P                              → onTogglePreview (mobile/narrow only)
 *   ⌘D                              → onToggleDrawer (templates)
 *   Esc                             → onCloseAny (close any open modal/sheet)
 *
 * Mac uses `metaKey` (⌘); Windows/Linux uses `ctrlKey`. Platform detection
 * via `navigator.platform` falls through to Ctrl on undefined platforms
 * (safer default).
 *
 * # Why this is web-only
 * Native devices don't have a primary keyboard input model. The composer
 * toolbar buttons cover the same actions on mobile. iOS hardware-keyboard
 * users get the Tiptap-StarterKit-default ⌘B/⌘I/⌘K via the WebView (M1's
 * scope) — that's separate from this hook, which is for the composer
 * Send/Preview/Drawer/Esc shortcuts at the page level.
 *
 * # Listener lifecycle
 * - Installed on mount via useEffect.
 * - Removed on unmount in the cleanup function — NO leaks across route
 *   navigation.
 * - Listener references handlers via a ref so stale-closure bugs don't
 *   fire the wrong action. The ref is updated on every render with the
 *   latest handlers object.
 *
 * Per SPEC_ORCH-0891 §3.4.3 + DESIGN_SPEC §3 (keyboard shortcuts).
 */

import { useEffect, useRef } from "react";

export interface ComposerShortcutHandlers {
  onBold: () => void;
  onItalic: () => void;
  onLink: () => void;
  onSendNow: () => void;
  onTogglePreview: () => void;
  onToggleDrawer: () => void;
  onCloseAny: () => void;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
}

export function useComposerKeyboardShortcuts(
  handlers: ComposerShortcutHandlers,
): void {
  // Keep handlers fresh on every render via a ref so the listener never
  // closes over a stale reference.
  const handlersRef = useRef<ComposerShortcutHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR safety

    const isMac = isMacPlatform();

    const onKeyDown = (e: KeyboardEvent): void => {
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      const h = handlersRef.current;

      // Esc — always wired regardless of ⌘.
      if (e.key === "Escape") {
        h.onCloseAny();
        return;
      }

      // ⌘/Ctrl required for everything below.
      if (!cmd) return;

      // Lowercase key for case-insensitive matching.
      const key = e.key.toLowerCase();

      switch (key) {
        case "b":
          // Don't preventDefault if the composer body's contenteditable
          // already handles ⌘B (Tiptap StarterKit wires this). Calling
          // both is redundant but harmless — Tiptap toggles bold, our
          // handler may also toggle bold via the imperative ref. To
          // avoid double-toggle, defer to Tiptap by preventDefault-ing
          // here and letting our handler do the same work.
          e.preventDefault();
          h.onBold();
          return;
        case "i":
          e.preventDefault();
          h.onItalic();
          return;
        case "k":
          e.preventDefault();
          h.onLink();
          return;
        case "enter":
          e.preventDefault();
          h.onSendNow();
          return;
        case "p":
          e.preventDefault();
          h.onTogglePreview();
          return;
        case "d":
          e.preventDefault();
          h.onToggleDrawer();
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
