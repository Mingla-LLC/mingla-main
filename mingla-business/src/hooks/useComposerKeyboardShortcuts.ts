/**
 * useComposerKeyboardShortcuts — native no-op variant.
 *
 * On native (iOS / Android), keyboard shortcuts are not the primary
 * input model — the composer toolbar buttons cover the same actions.
 * Metro picks `useComposerKeyboardShortcuts.web.ts` on web; native
 * bundles fall through to this file and the hook is a no-op.
 *
 * Per SPEC_ORCH-0891 §3.4.3.
 */

export interface ComposerShortcutHandlers {
  onBold: () => void;
  onItalic: () => void;
  onLink: () => void;
  onSendNow: () => void;
  onTogglePreview: () => void;
  onToggleDrawer: () => void;
  onCloseAny: () => void;
}

export function useComposerKeyboardShortcuts(
  _handlers: ComposerShortcutHandlers,
): void {
  // No-op on native. Web side at .web.ts installs a keydown listener.
}
