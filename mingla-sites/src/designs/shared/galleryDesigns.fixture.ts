import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import type { BlockType } from "../../contracts/generated/blocks.ts";
import { compositionFooter, compositionHeader, compositionVariant, DESIGNS, type DesignKey } from "../../contracts/generated/designs.ts";
import { resolveTokens } from "../../contracts/generated/tokens.ts";
import { fontStretch } from "../../contracts/generated/fontSlots.ts";
import type { RichTextDoc } from "../../contracts/generated/richText.ts";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { FX, fixtureMedia } from "../../contracts/gogiV1.fixture";

/*
 * #4453 6a — a site on a gallery design (Nocturne, Haven, Maison; 6b: Journal, Grid, Terra), built on
 * the Voyage synthetic fixture: the design's own tokens and faces, the
 * design's default chrome, every stored block moved to the design's layout
 * for a NEW composition, and a Home that carries the design's heaviest
 * layouts (hero, ticker, manifesto, offerings, cards, gallery, history,
 * reviews, hours, FAQ, newsletter). Invented content only.
 */

const text = (value: string) => ({ type: "text" as const, text: value });
const doc = (...paragraphs: string[]): RichTextDoc => ({ type: "doc", children: paragraphs.map((p) => ({ type: "paragraph" as const, children: [text(p)] })) });

/** One woff2 face per family the design draws (bytes are placeholders; real sizes are pinned in the budget test). */
function fixtureAssets(key: DesignKey): ArtifactV2["font_assets"] {
  const fonts = DESIGNS[key].fonts;
  const slots = [fonts.display, fonts.body, fonts.accent, fonts.label ?? null].filter((slot) => slot !== null);
  const seen = new Set<string>();
  const assets: ArtifactV2["font_assets"] = [];
  slots.forEach((slot, index) => {
    const style = slot!.italic && slot === fonts.accent ? "italic" : "normal";
    const id = `${slot!.family}/${style}`;
    if (seen.has(id)) return;
    seen.add(id);
    // #4453 6b — a width-axis slot's face carries its range, as the publish pipeline records it.
    assets.push({ family: slot!.family, weight: slot!.weights[0]!, style, unicode_range: "U+0000-00FF", digest: String(index + 1).repeat(64).slice(0, 64), bytes: 1000, ...(slot!.width ? { stretch: fontStretch(slot!.width) } : {}) });
  });
  return assets;
}

export function galleryHomeBlocks(key: DesignKey): Array<Record<string, unknown>> {
  const design = DESIGNS[key];
  const pick = (type: BlockType) => compositionVariant(design, type);
  const images = [1, 2, 3, 4, 5].map((n) => {
    const media = fixtureMedia(FX(n));
    return { id: media.id, url: media.url, alt: `Fixture picture ${n}`, width: media.width, height: media.height };
  });
  return [
    { type: "hero", variant: pick("hero"), eyebrow: "Small rooms above the bay · Fixture Coast", heading: "Wake up over the bay.", heading_lines: [{ text: "Wake up" }, { text: "over the bay." }], subheading: "A small house on a quiet island. Breakfast whenever you wake.", media_url: fixtureMedia(FX(1)).url, ctas: [{ label: "Book a stay", href: "/trips" }, { label: "See the rooms", href: "/places" }] },
    { type: "marquee", variant: pick("marquee"), phrases: [{ text: "Sea-view rooms" }, { text: "Breakfast till noon" }, { text: "Longtail transfers" }, { text: "Sunset deck" }] },
    { type: "rich_text", variant: pick("rich_text"), eyebrow: "The house", body: doc("Twenty-two rooms, one long table and a bay that changes colour every hour.") },
    { type: "offering_grid", variant: pick("offering_grid"), eyebrow: "Upcoming", heading: "Trips from the house", kind: "trip", mode: "upcoming", empty_text: "New trips appear here as soon as they are on sale.", empty_cta_label: "Get in touch", empty_cta_href: "/contact-us" },
    { type: "feature_cards", variant: pick("feature_cards"), heading: "Why guests return", cards: [
      { title: "Quiet rooms", body: "Thick walls, linen and the sea.", icon: "travel_explore" },
      { title: "Slow mornings", body: "Breakfast whenever you wake.", icon: "event_available" },
      { title: "Island guides", body: "Friends who grew up here.", icon: "diversity_1" },
    ] },
    { type: "gallery", variant: pick("gallery"), eyebrow: "The house", heading: "Light, water, linen", images },
    { type: "offering_history", variant: pick("offering_history"), eyebrow: "Since we opened", heading: "Trips we've run", kind: "trip" },
    { type: "testimonials", variant: pick("testimonials"), eyebrow: "Guests", heading: "What guests say", from_collection: true },
    { type: "hours_location", variant: pick("hours_location"), heading: "Find us", address: "1 Fixture Pier, Fixture Coast", map_url: "https://maps.example.com/x", hours: [{ day: "Check-in", value: "From 2 pm" }, { day: "Check-out", value: "Until noon" }], timezone: "Africa/Lagos", always_open: false },
    { type: "faq", variant: pick("faq"), eyebrow: "Questions", heading: "Before you come", items: [{ question: "How do I get there?", answer: "A longtail from the pier, twenty minutes." }, { question: "Is breakfast included?", answer: "Every morning, until noon." }] },
    { type: "newsletter_signup", variant: pick("newsletter_signup"), eyebrow: "Letters", heading: "Hear from the house", body: "One letter a season, never more.", button_label: "Join" },
  ];
}

export function galleryArtifact(key: DesignKey): ArtifactV2 {
  const design = DESIGNS[key];
  const artifact = voyageSyntheticArtifact();
  artifact.design = { key, version: design.version };
  artifact.tokens = resolveTokens(design.tokens, {});
  artifact.fonts = structuredClone(design.fonts);
  artifact.font_assets = fixtureAssets(key);
  artifact.navigation = { ...artifact.navigation, header_variant: compositionHeader(design)!, header_cta: { label: "Book a stay", href: "/trips" } };
  artifact.footer = { ...artifact.footer, footer_variant: compositionFooter(design)! };
  for (const page of artifact.pages) {
    page.blocks = page.blocks.map((block) => {
      const type = block.type as BlockType;
      return design.variants[type].includes(String(block.variant)) ? block : { ...block, variant: compositionVariant(design, type) };
    }) as typeof page.blocks;
  }
  const home = artifact.pages.find((page) => page.path === "")!;
  home.blocks = galleryHomeBlocks(key) as unknown as typeof home.blocks;
  // The gallery carries the artifact's own approved picture records (a media_list holds the records themselves).
  const pictures = artifact.media.filter((item) => !/\.(mp4|webm|mov)$/i.test(item.url) && item.id !== FX(7)).slice(0, 5);
  const gallery = home.blocks.find((block) => block.type === "gallery") as unknown as { images: unknown };
  gallery.images = structuredClone(pictures);
  return artifact;
}
