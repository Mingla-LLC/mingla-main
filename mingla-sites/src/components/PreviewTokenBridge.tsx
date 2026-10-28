"use client";

import { useEffect } from "react";
import { previewParentAllowed, previewTokenDeclarations } from "../lib/previewTokens";

/** #2829 W9r — applies unsaved token changes the Business app posts (private preview only). */
export function PreviewTokenBridge({ localMode }: { localMode: boolean }) {
  useEffect(() => {
    const applied = new Set<string>();
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || window.parent === window) return;
      if (!previewParentAllowed(event.origin, { localMode })) return;
      const declarations = previewTokenDeclarations(event.data);
      if (!declarations.length && (event.data as { type?: unknown } | null)?.type !== "mingla:preview-tokens") return;
      const root = document.documentElement;
      for (const name of applied) root.style.removeProperty(name);
      applied.clear();
      for (const [name, value] of declarations) {
        root.style.setProperty(name, value);
        applied.add(name);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [localMode]);
  return null;
}
