/*
 * #2829 W7 — a neutral voyage site for tests: the same block composition as
 * the travel reference pages (home, about, contact, questions, trips,
 * destinations, stories, a legal page), on the voyage design with its
 * defaults. Built on the W5 fixture so the media manifest, collections and
 * ended trips are real. Every word is invented for tests and names no real
 * brand; pictures are the fixture's placeholder media.
 */
import type { ArtifactV2 } from "./generated/artifactV2.ts";
import type { RichTextDoc } from "./generated/richText.ts";
import { VOYAGE } from "./generated/designs.ts";
import { resolveTokens } from "./generated/tokens.ts";
import { FX, fixtureMedia } from "./gogiV1.fixture";
import { W5, w5Artifact } from "./w5Content.fixture";

const text = (value: string) => ({ type: "text" as const, text: value });
const doc = (...paragraphs: string[]): RichTextDoc => ({ type: "doc", children: paragraphs.map((p) => ({ type: "paragraph" as const, children: [text(p)] })) });

const HERO = fixtureMedia(FX(1)).url;
const FEATURE = fixtureMedia(FX(2)).url;
const POSTER = fixtureMedia(FX(5)).url;
const FILM = fixtureMedia(FX(6), "video").url;

const faq = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `Fixture question ${i + 1}?`, answer: `Fixture answer ${i + 1}.` }));

export function voyageSyntheticArtifact(): ArtifactV2 {
  const artifact = w5Artifact({ storiesAtRoot: true });
  artifact.design = { key: "voyage", version: 1 };
  artifact.tokens = resolveTokens(VOYAGE.tokens, {});
  artifact.fonts = structuredClone(VOYAGE.fonts);
  artifact.font_assets = [
    { family: "Plus Jakarta Sans", weight: 400, style: "normal", unicode_range: "U+0000-00FF", digest: "e".repeat(64), bytes: 1000 },
    { family: "Just Another Hand", weight: 400, style: "normal", unicode_range: "U+0000-00FF", digest: "f".repeat(64), bytes: 1000 },
  ];
  artifact.font_fallbacks = [];
  artifact.brand = { ...artifact.brand, display_name: "Fixture & Friends", short_description: "Invented for tests." };
  artifact.routes = { ...artifact.routes, trips: "trips", destinations: "places", stories: "" };
  artifact.navigation = {
    items: [
      { label: "Trips", href: "/trips" },
      { label: "Places", href: "/places" },
      { label: "Journal", href: "/journal" },
      { label: "More", href: "/about-us", children: [
        { label: "About us", href: "/about-us" },
        { label: "Contact", href: "/contact-us" },
        { label: "Questions", href: "/faqs" },
        { label: "Privacy", href: "/privacy" },
      ] },
    ],
    header_cta: { label: "Browse trips", href: "/trips" },
  };
  artifact.footer = {
    tagline_lines: ["Go somewhere.", "Meet someone."],
    location: "Fixture City",
    email: "hello@fixture.invalid",
    columns: [
      { heading: "Places", links: [{ label: "Harbour Coast", href: "/places/harbour-coast" }] },
      { heading: "Information", links: [{ label: "Questions", href: "/faqs" }, { label: "About us", href: "/about-us" }] },
    ],
    socials: [{ network: "instagram", url: "https://instagram.com/fixture.invalid" }],
    copyright: "Copyright © {year} {site_name}. All rights reserved.",
  };
  artifact.pages = [
    {
      path: "",
      title: "Home",
      enabled: true,
      kind: "standard",
      blocks: [
        { type: "hero", variant: "cover-bottom-search", heading: "Go somewhere. Meet someone.", heading_lines: [{ text: "Go somewhere." }, { text: "Meet someone." }], show_search: true, media_url: HERO, ctas: [] },
        { type: "feature_cards", variant: "tile-bar", cards: [
          { title: "Small groups", body: "Fixture sentence one.", icon: "travel_explore" },
          { title: "Local nights", body: "Fixture sentence two.", icon: "festival" },
          { title: "New friends", body: "Fixture sentence three.", icon: "diversity_1" },
          { title: "Easy dates", body: "Fixture sentence four.", icon: "event_available" },
        ] },
        { type: "offering_grid", variant: "photo-card", heading: "Upcoming Trips", kind: "trip", mode: "upcoming", empty_text: "Fixture empty sentence.", empty_cta_label: "Get in touch", empty_cta_href: "/contact-us" },
        { type: "testimonials", variant: "quote-wall", heading: "Reviews from the road", intro: "Fixture intro.", from_collection: true },
        { type: "destination_grid", variant: "badge-tile", heading: "Where we go", cta_label: "See all places", cta_href: "/places", destinations: [{ slug: "harbour-coast" }] },
        { type: "story_grid", variant: "card", heading: "From the journal", limit: 3, cta_label: "See all stories", cta_href: "/journal" },
        { type: "newsletter_signup", variant: "card", heading: "Subscribe", body: "Fixture newsletter sentence.", button_label: "Subscribe" },
      ],
    },
    {
      path: "about-us",
      title: "About us",
      enabled: true,
      kind: "standard",
      blocks: [
        { type: "page_header", variant: "cover-center", heading: "About us", subheading: "Fixture line.", media_url: FEATURE },
        { type: "video_feature", variant: "brand-film", video_url: FILM, poster_url: POSTER },
        { type: "rich_text", variant: "prose", heading: "Fixture heading", body: doc("Fixture paragraph."), width: "narrow" },
        { type: "feature_cards", variant: "statement", cards: [{ title: "Our view", body: "Fixture vision." }, { title: "Our aim", body: "Fixture mission." }] },
        { type: "media_feature", variant: "split-panel", media_url: FEATURE, alt: "A fixture picture", heading: "Fixture split", caption: "Fixture lede.", alignment: "right" },
        { type: "offering_history", variant: "ledger", heading: "Trips so far", intro: "Fixture ledger intro.", kind: "trip", series: [{ label: "Mountain ski series", offering_ids: [{ id: W5.tripEnded2 }, { id: W5.tripEnded3 }] }], linked_offering_ids: [{ id: W5.tripEnded1 }], cta_label: "Browse dates", cta_href: "/trips" },
        { type: "feature_cards", variant: "tile-bar", cards: [{ title: "Choice", body: "One." }, { title: "Booking", body: "Two." }, { title: "Rooms", body: "Three." }, { title: "Tailored", body: "Four." }] },
        { type: "contact_details", variant: "tiles", email: "hello@fixture.invalid", location: "Fixture City" },
      ],
    },
    {
      path: "contact-us",
      title: "Contact us",
      enabled: true,
      kind: "standard",
      blocks: [
        { type: "page_header", variant: "cover-center", heading: "Contact us", subheading: "First fixture line.\nSecond fixture line.", media_url: FEATURE },
        { type: "contact_form", variant: "panel", heading: "Get in touch", message_label: "Your message", submit_label: "Send", fallback_email: "hello@fixture.invalid" },
        { type: "contact_details", variant: "tiles", heading: "Fixture & Friends", body: "Fixture sentence.", email: "hello@fixture.invalid", location: "Fixture City" },
      ],
    },
    {
      path: "faqs",
      title: "Questions",
      enabled: true,
      kind: "standard",
      blocks: [
        { type: "page_header", variant: "cover-center", heading: "Questions", media_url: FEATURE },
        { type: "faq", variant: "accordion-columns", items: faq(10) },
        { type: "cta", variant: "dark-panel-glow", heading: "Still wondering", body: "Fixture sentence.", label: "Contact us", href: "/contact-us" },
      ],
    },
    {
      path: "trips",
      title: "Trips",
      enabled: true,
      kind: "collection_index",
      collection: "trips",
      blocks: [
        { type: "page_header", variant: "cover-center", heading: "Trips", media_url: FEATURE },
        { type: "offering_grid", variant: "photo-card", heading: "All trips", kind: "trip", mode: "all", show_filters: true },
        { type: "faq", variant: "accordion-columns", heading: "Frequently Asked Questions", items: faq(2) },
      ],
    },
    {
      path: "places",
      title: "Places",
      enabled: true,
      kind: "collection_index",
      collection: "destinations",
      blocks: [
        { type: "page_header", variant: "cover-center", heading: "Places", media_url: FEATURE },
        { type: "destination_grid", variant: "badge-tile", heading: "Destinations" },
      ],
    },
    {
      path: "journal",
      title: "Journal",
      enabled: true,
      kind: "collection_index",
      collection: "stories",
      blocks: [
        { type: "page_header", variant: "cover-center", heading: "Journal", media_url: FEATURE },
        { type: "story_grid", variant: "card", heading: "Latest notes", limit: 12 },
      ],
    },
    {
      path: "privacy",
      title: "Privacy",
      enabled: true,
      kind: "standard",
      blocks: [
        { type: "page_header", variant: "cover-center", heading: "Privacy" },
        { type: "rich_text", variant: "prose", body: { type: "doc", children: [
          { type: "heading", level: 2, children: [text("Fixture section")] },
          { type: "paragraph", children: [text("Fixture terms.")] },
          { type: "list", ordered: false, items: [{ type: "list_item", children: [text("One")] }, { type: "list_item", children: [text("Two")] }] },
        ] } },
      ],
    },
  ];
  return artifact;
}
