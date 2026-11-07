/**
 * #4271 — the scanner invite sheet, loaded when a host first opens it. The brand
 * and event scanner routes both render it, so a static import hoisted the whole
 * sheet into the eager web __common chunk.
 */
import { createOnIntentLazySheet } from "../ui/OnIntentLazySheet";
import type { InviteScannerSheetProps } from "./InviteScannerSheet";

export const LazyInviteScannerSheet = createOnIntentLazySheet<InviteScannerSheetProps>(
  async () => (await import("./InviteScannerSheet")).InviteScannerSheet,
  { loadingLabel: "Loading scanner invite" },
);
