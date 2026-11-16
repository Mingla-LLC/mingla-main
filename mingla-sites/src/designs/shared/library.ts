import type { ComponentType } from "react";
import type { BlockType } from "../../contracts/generated/blocks.ts";
import { MOTION_PROFILE_NUMBERS, type DesignDefinition, type MotionNumbers } from "../../contracts/generated/designs.ts";
import type { MotionPreset } from "../../contracts/generated/tokens.ts";
import type { SharedBlockProps } from "./parts";
import { HeroArch, HeroEditorial, HeroFullbleed, MarqueeTicker, RichTextManifesto } from "./blocks/Hero";
import {
  DestinationGridTiles, FeatureCardsNumbered, FeatureCardsTiles, GalleryMosaic, GalleryPinned, GalleryStagger,
  MenuBoardColumns, OfferingGridCards, OfferingGridList, OfferingGridPoster,
} from "./blocks/Offerings";
import {
  FaqSplit, HoursLocationSplit, NewsletterPhoto, OfferingHistoryLedgerCount, OfferingHistorySplit,
  TestimonialsRail, TestimonialsSwitcher, TestimonialsWall,
} from "./blocks/Stories";

/*
 * #4453 §3.3 — the shared block library: one component per shared layout,
 * exactly site-contracts SHARED_LAYOUTS (a test pins the two together and
 * renders every field each block defines through every layout). A design's
 * page maps `type:variant` to these, then adds its own signature layouts.
 */
export const SHARED_BLOCK_LAYOUTS: Readonly<Partial<Record<BlockType, Readonly<Record<string, ComponentType<SharedBlockProps>>>>>> = {
  hero: { fullbleed: HeroFullbleed, editorial: HeroEditorial, arch: HeroArch },
  marquee: { ticker: MarqueeTicker },
  rich_text: { manifesto: RichTextManifesto },
  offering_grid: { poster: OfferingGridPoster, list: OfferingGridList, cards: OfferingGridCards },
  menu_board: { columns: MenuBoardColumns },
  feature_cards: { tiles: FeatureCardsTiles, numbered: FeatureCardsNumbered },
  gallery: { pinned: GalleryPinned, mosaic: GalleryMosaic, stagger: GalleryStagger },
  destination_grid: { tiles: DestinationGridTiles },
  offering_history: { "ledger-count": OfferingHistoryLedgerCount, split: OfferingHistorySplit },
  testimonials: { rail: TestimonialsRail, wall: TestimonialsWall, switcher: TestimonialsSwitcher },
  hours_location: { split: HoursLocationSplit },
  faq: { split: FaqSplit },
  newsletter_signup: { photo: NewsletterPhoto },
};

/**
 * The motion numbers a page runs with: the design's profile, capped at the
 * calm numbers when the owner picked `calm`; null when the owner picked
 * `none` (nothing animates; reduced motion is handled in CSS and the module).
 */
export function pageMotion(design: DesignDefinition, preset: MotionPreset): MotionNumbers | null {
  if (preset === "none") return null;
  const own = MOTION_PROFILE_NUMBERS[design.motion.profile];
  if (preset !== "calm") return own;
  const calm = MOTION_PROFILE_NUMBERS.calm;
  return {
    stagger_ms: Math.min(own.stagger_ms, calm.stagger_ms),
    stagger_cap: Math.min(own.stagger_cap, calm.stagger_cap),
    rise_px: Math.min(own.rise_px, calm.rise_px),
    duration_ms: Math.max(own.duration_ms, calm.duration_ms),
    hero_scale: Math.min(own.hero_scale, calm.hero_scale),
    hero_settle_ms: Math.min(own.hero_settle_ms, calm.hero_settle_ms),
    hero_drift_pct: Math.min(own.hero_drift_pct, calm.hero_drift_pct),
  };
}

/** The page wrapper's motion attributes and custom properties. */
export function motionAttributes(design: DesignDefinition, preset: MotionPreset): { "data-motion": "none" | "on"; "data-mg-profile": string; style: Record<string, string> } {
  const numbers = pageMotion(design, preset);
  if (!numbers) return { "data-motion": "none", "data-mg-profile": design.motion.profile, style: {} };
  return {
    "data-motion": "on",
    "data-mg-profile": design.motion.profile,
    style: {
      "--mg-stagger": `${numbers.stagger_ms}`,
      "--mg-rise-y": `${numbers.rise_px}px`,
      "--mg-dur": `${numbers.duration_ms}`,
      "--mg-dur-ms": `${numbers.duration_ms}ms`,
      "--mg-hero-scale": `${numbers.hero_scale}`,
      "--mg-hero-settle": `${numbers.hero_settle_ms}ms`,
      "--mg-hero-drift": `${numbers.hero_drift_pct}%`,
    },
  };
}
