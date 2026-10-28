import type { ComponentType } from "react";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import type { DesignKey } from "../contracts/generated/designs.ts";
import type { ArtifactPage } from "../lib/pageRouting";
import type { LiveOfferings } from "../lib/offeringCards";
import type { FormsContext } from "../lib/siteForms";
import type { CollectionEntry } from "../lib/siteCollections";
import { AtelierPage } from "./atelier/AtelierPage";
import { VoyagePage } from "./voyage/VoyagePage";

/*
 * #2829 AD-1 — the runtime's design registry: for each design key in
 * site-contracts, the page component that draws it and its versioned,
 * immutable stylesheet (public/designs/<key>/<version>.css). Only the
 * site's own design stylesheet is ever linked.
 */
export type DesignRenderer = {
  stylesheet: (version: number) => string;
  /** #2829 W7 — the design draws its own 404 page (others keep the generic one). */
  drawsNotFound?: boolean;
  Page: ComponentType<{
    artifact: ArtifactV2;
    page?: ArtifactPage;
    live?: LiveOfferings;
    forms?: FormsContext;
    entry?: CollectionEntry;
    saveData?: boolean;
    /** #2829 W7 — this request's CSP nonce (a design's own inline script). */
    nonce?: string;
    /** #2829 W7 — draw the design's 404 page (the host has a site; the address does not). */
    notFound?: boolean;
  }>;
};

export const DESIGN_RENDERERS: Readonly<Record<DesignKey, DesignRenderer>> = {
  atelier: { stylesheet: (version) => `/designs/atelier/${version}.css`, Page: AtelierPage },
  voyage: { stylesheet: (version) => `/designs/voyage/${version}.css`, Page: VoyagePage, drawsNotFound: true },
};

/** TEMPORARY(#2829): v1 rollback renderer's stylesheet — remove with RestaurantV1. */
export const LEGACY_V1_STYLESHEET = "/designs/legacy-v1.css";
