import React, { createContext, useContext } from "react";
import type { Text } from "react-native";
import type { WebsiteController } from "./useWebsiteController";
import type { PreviewDevicePreference } from "../../../sites/previewDevice";
import type { WebsiteRoute, WebsiteSection } from "../../../sites/websiteNav";
import type { SitePlanState } from "../../../sites/sitePlanState";
import type { AdminAsk } from "../../../sites/contentApi";

/*
 * #2829 W9r — what every Website section shares: the controller (server
 * state and live operations), navigation, the toast, "Ask an admin", the
 * lock, the remembered preview size and the Website design's unsaved state
 * (the rail dot, the preview's "Unsaved" chip, the leave confirm).
 */
export type WebsiteLock = {
  /** Someone ELSE holds the website lock right now. */
  heldByOther: boolean;
  holderName: string | null;
  canTakeOver: boolean;
  takeOver: () => void;
  takingOver: boolean;
};

/** A sticky bottom bar (design's unsaved bar; desktop editors). */
export type StickyBar = {
  text: string;
  actions: { label: string; variant: "primary" | "ghost" | "secondary"; onPress: () => void; loading?: boolean; disabled?: boolean; testID?: string }[];
};

/** The phone top bar's Save (editors). */
export type TopbarSave = { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; testID?: string };

export type WebsiteContextValue = {
  brandId: string;
  brandName: string;
  controller: WebsiteController;
  phone: boolean;
  section: WebsiteSection;
  go: (route: Exclude<WebsiteRoute, { kind: "redirect" }>) => void;
  /** Phone/editor back: one level up. */
  back: () => void;
  toast: (message: string, kind?: "success" | "info" | "warn" | "error") => void;
  askAdmin: (action: AdminAsk) => void;
  asking: boolean;
  lock: WebsiteLock;
  plan: SitePlanState | null;
  previewPreference: PreviewDevicePreference;
  setPreviewPreference: (next: PreviewDevicePreference) => void;
  openFullScreenPreview: () => void;
  openPreviewSheet: () => void;
  designDirty: boolean;
  setDesignDirty: (dirty: boolean) => void;
  tokenDeclarations: readonly string[] | null;
  setTokenDeclarations: (value: readonly string[] | null) => void;
  headingRef: React.RefObject<Text | null>;
  /** The brand ticked Trips (Past trips, copy). */
  offerings: string[];
  setStickyBar: (bar: StickyBar | null) => void;
  setTopbarSave: (save: TopbarSave | null) => void;
};

const Context = createContext<WebsiteContextValue | null>(null);

export function WebsiteProvider({ value, children }: { value: WebsiteContextValue; children: React.ReactNode }): React.ReactElement {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWebsite(): WebsiteContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useWebsite outside WebsiteProvider");
  return value;
}
