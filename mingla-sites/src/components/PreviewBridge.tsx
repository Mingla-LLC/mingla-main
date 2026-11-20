"use client";

import { useEffect } from "react";
import { startPreviewBridge, type PreviewBridgeSection } from "../lib/previewBridge";

/*
 * #4453 website workspace (build contract D) — the private preview's bridge to
 * the workspace that frames it (it replaces #2829 W9r's PreviewTokenBridge and
 * still applies the unsaved colours that one did). Mounted by the private
 * preview route only. It renders NOTHING: the server HTML of a preview is the
 * page itself, and everything the bridge draws is added after the page has
 * loaded, in a layer of its own (lib/previewBridge.ts).
 */
export function PreviewBridge({ localMode, pagePath, sections }: {
  localMode: boolean;
  /** The page shown ("" is Home). */
  pagePath: string;
  /** One entry per block of the page, in block order ("" id: not selectable). Empty on a page without sections. */
  sections: readonly PreviewBridgeSection[];
}) {
  // The list is fixed for a page load; its text is the stable dependency.
  const sectionsKey = JSON.stringify(sections);
  useEffect(() => {
    return startPreviewBridge({ localMode, pagePath, sections: JSON.parse(sectionsKey) as PreviewBridgeSection[] });
  }, [localMode, pagePath, sectionsKey]);
  return null;
}
