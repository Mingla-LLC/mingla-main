import type { ComponentType } from "react";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import type { DesignKey } from "../contracts/generated/designs.ts";
import type { ArtifactPage } from "../lib/pageRouting";
import type { LiveOfferings } from "../lib/offeringCards";
import type { FormsContext } from "../lib/siteForms";
import type { CollectionEntry } from "../lib/siteCollections";
import { AtelierPage } from "./atelier/AtelierPage";
import { VoyagePage } from "./voyage/VoyagePage";
import { NocturnePage } from "./nocturne/NocturnePage";
import { HavenPage } from "./haven/HavenPage";
import { MaisonPage } from "./maison/MaisonPage";
import { JournalPage } from "./journal/JournalPage";
import { GridPage } from "./grid/GridPage";
import { TerraPage } from "./terra/TerraPage";
import { PopPage } from "./pop/PopPage";
import { SunsetPage } from "./sunset/SunsetPage";
import { PulsePage } from "./pulse/PulsePage";

/*
 * #2829 AD-1 — the runtime's design registry: for each design key in
 * site-contracts, the page component that draws it and its versioned,
 * immutable stylesheet (public/designs/<key>/<version>.css). Only the
 * site's own design stylesheet is ever linked.
 */
export type DesignRenderer = {
  stylesheet: (version: number) => string;
  /** #4453 §3.3 — the shared block library's stylesheet, linked BEFORE the design's (signature rules win). */
  sharedStylesheet?: string;
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

/** #4453 — immutable like a design stylesheet (a change is blocks-2.css). */
export const SHARED_STYLESHEET = "/designs/_shared/blocks-1.css";

export const DESIGN_RENDERERS: Readonly<Record<DesignKey, DesignRenderer>> = {
  atelier: { stylesheet: (version) => `/designs/atelier/${version}.css`, Page: AtelierPage },
  voyage: { stylesheet: (version) => `/designs/voyage/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: VoyagePage, drawsNotFound: true },
  // #4453 6a — the gallery designs: the shared page, chrome and library, each with its own stylesheet.
  nocturne: { stylesheet: (version) => `/designs/nocturne/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: NocturnePage },
  haven: { stylesheet: (version) => `/designs/haven/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: HavenPage },
  maison: { stylesheet: (version) => `/designs/maison/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: MaisonPage },
  // #4453 6b — Journal, Grid and Terra, the same way.
  journal: { stylesheet: (version) => `/designs/journal/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: JournalPage },
  grid: { stylesheet: (version) => `/designs/grid/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: GridPage },
  terra: { stylesheet: (version) => `/designs/terra/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: TerraPage },
  // #4453 6c — Pop, Sunset and Pulse, the same way.
  pop: { stylesheet: (version) => `/designs/pop/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: PopPage },
  sunset: { stylesheet: (version) => `/designs/sunset/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: SunsetPage },
  pulse: { stylesheet: (version) => `/designs/pulse/${version}.css`, sharedStylesheet: SHARED_STYLESHEET, Page: PulsePage },
};

/** TEMPORARY(#2829): v1 rollback renderer's stylesheet — remove with RestaurantV1. */
export const LEGACY_V1_STYLESHEET = "/designs/legacy-v1.css";
