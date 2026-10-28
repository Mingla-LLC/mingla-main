/*
 * #2829 W3 — a gögi-shaped v1 artifact that passes the v1 public contract
 * and uses every one of the 22 restaurant block types, so the v1 → v2
 * upgrade and the atelier renderer are exercised on real shapes. Test support
 * only (neutral placeholder ids and media, no customer content).
 */
import type { RestaurantArtifact } from "./artifact";

export const FX = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
export const FX_SITE = FX(90);
const DIGEST = (c: string) => c.repeat(64);

export function fixtureMedia(id: string, kind: "image" | "video" = "image") {
  return kind === "video"
    ? {
      id, url: `/media/${id}/video.mp4`, alt: "", width: 0, height: 0, integrity: DIGEST("b"), object_key: `approved/${FX_SITE}/${id}/${DIGEST("b")}/master.mp4`,
      // #2829 W6 — a 2.5 MiB film: three 1 MiB chunk digests.
      bytes: 2_621_440, chunk_size: 1_048_576, chunk_digests: [DIGEST("1"), DIGEST("2"), DIGEST("3")], duration_ms: 12_000,
    }
    : { id, url: `/media/${id}/1440.webp`, alt: "", width: 1440, height: 960, integrity: DIGEST("c"), object_key: `approved/${FX_SITE}/${id}/${DIGEST("c")}/1440.webp` };
}

const HERO = fixtureMedia(FX(1));
const FEATURE = fixtureMedia(FX(2));
const G1 = fixtureMedia(FX(3));
const G2 = fixtureMedia(FX(4));
const POSTER = fixtureMedia(FX(5));
const FILM = fixtureMedia(FX(6), "video");
const LOGO = fixtureMedia(FX(7));

const menuSections = [
  {
    name: "FOOD - Rice Bowls",
    description: null,
    items: [
      { id: FX(11), name: "Coconut rice", description: "with grilled chicken", price_minor: 850000, currency: "NGN" },
      { id: FX(12), name: "Fish of the day", description: null, price_minor: null, currency: null },
    ],
  },
];

export function gogiV1Fixture(): RestaurantArtifact {
  return structuredClone({
    schema_version: 1,
    site_id: FX_SITE,
    brand_id: FX(91),
    publication_id: FX(92),
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    source_revision_id: FX(93),
    source_digest: DIGEST("a"),
    generated_at: "2026-09-03T00:00:00.000Z",
    pages: [
      {
        role: "home", slug: "home", title: "Home", enabled: true, nav_label: "Home", nav_order: 0,
        blocks: [
          { type: "hero", heading: "Where the city comes to eat", subheading: "A food house open day and night.", media_url: HERO.url, video_url: null, ctas: [{ label: "See the menu", href: "/menu" }] },
          { type: "marquee", phrases: [{ text: "Open late" }, { text: "Rice bowls" }, { text: "Cocktails" }] },
          { type: "rich_text", eyebrow: "Our story", heading: "Open day and night", paragraphs: [{ text: "Come as you are." }, { text: "Rice at noon, shawarma at three." }] },
          { type: "media_feature", eyebrow: "The place", media_url: FEATURE.url, alt: "The room", heading: "The room", caption: "Low light, long tables.", alignment: "left", media_shape: "circle", badge_figure: "24/7", badge_label: "Always on", quote: "Best rice bowls in town.", quote_attribution: "A regular", cta_label: "Read more", cta_href: "/about" },
          { type: "stats", eyebrow: "In numbers", heading: "Why people come", body: "Four reasons.", items: [{ figure: "24/7", label: "Open", icon: "clock", highlight: true }, { figure: "40+", label: "Dishes", icon: "bowl" }] },
          { type: "pull_quote", quote: "A room that never sleeps.", attribution: "The team" },
          { type: "menu_preview", eyebrow: "The menu", heading: "What people order", note: null, sections: menuSections, section_limit: 1, item_limit: 2, images: [G1], cta_label: "Full menu", cta_href: "/menu" },
          { type: "testimonials", heading: "What guests say", items: [{ name: "Ada", quote: "Perfect at 2am." }] },
          { type: "hours_location", heading: "Visit", address: "1 Example Way, Lagos", map_url: "https://maps.example.com/x", hours: [{ day: "Every day", value: "Open 24 hours" }], timezone: "Africa/Lagos", always_open: true },
          { type: "map_embed", heading: "Find us", body: "Right by the water.", latitude: 6.43, longitude: 3.46, place_label: "1 Example Way", directions_url: "https://maps.example.com/d" },
          { type: "divider" },
          { type: "spacer", size: "small" },
        ],
      },
      {
        role: "about", slug: "about", title: "About", enabled: true, nav_label: "About", nav_order: 1,
        blocks: [
          { type: "team", heading: "The team", caption: "The people behind the room.", members: [{ name: "Chef K", role: "Kitchen", media_url: G2.url, alt: "Chef K" }, { name: "Tolu", role: null, media_url: null, alt: null }], preview_count: 2 },
          { type: "video_feature", eyebrow: "Film", group_heading: "The room, on any night", heading: "Friday", caption: "A Friday in the room.", video_url: FILM.url, poster_url: POSTER.url },
          { type: "video_feature", heading: "Saturday", caption: null, video_url: FILM.url, poster_url: POSTER.url },
          { type: "faq", heading: "Questions", items: [{ question: "Do you deliver?", answer: "Yes, through Mingla." }] },
          { type: "cta", heading: "Come by", body: "We're always open.", label: "Directions", href: "https://maps.example.com/d" },
        ],
      },
      {
        role: "menu", slug: "menu", title: "Menu", enabled: true, nav_label: "Menu", nav_order: 2,
        blocks: [
          { type: "menu_board", heading: "The menu", note: "Served all day.", venue_id: FX(20), sections: menuSections },
          { type: "menu_link", heading: "Prefer a PDF?", label: "Download", href: "https://example.com/menu.pdf" },
        ],
      },
      {
        role: "gallery", slug: "gallery", title: "Gallery", enabled: true, nav_label: "Gallery", nav_order: 3,
        blocks: [{ type: "gallery", heading: "In the room", images: [G1, G2] }],
      },
      {
        role: "reservations", slug: "reservations", title: "Reservations", enabled: true, nav_label: "Book", nav_order: 4,
        blocks: [
          { type: "venue_reservation", heading: "Book a table", body: "Groups welcome.", url: "https://host.usemingla.com/b/example/v/main" },
          { type: "offering_grid", heading: "Experiences", offerings: [{ id: FX(30), label: "Tasting night", summary: "Six courses.", url: "https://host.usemingla.com/e/example/tasting" }] },
          { type: "contact_handoff", heading: "Get in touch", body: "Message us.", label: "WhatsApp", href: "https://wa.me/2340000000000" },
        ],
      },
    ],
    navigation: { page_roles: ["home", "about", "menu", "gallery", "reservations"] },
    footer: { address: "1 Example Way, Lagos", hours_summary: "Open 24 hours", legal_text: "© 2026 Example", links: [{ label: "Instagram", href: "https://instagram.com/example" }, { label: "+234 000", href: "tel:+2340000000000" }] },
    site_settings: {
      display_name: "Example Food House",
      short_description: "A food house open day and night.",
      logo: { ...LOGO, alt: "Example Food House logo" },
      colors: { background: "#101013", foreground: "#f0eee9", accent: "#cda052" },
      typography: "condensed-display",
      seo: { title: "Example Food House", description: "Open day and night.", canonical_url: "https://example-food.sites.localhost" },
    },
    media: [HERO, FEATURE, G1, G2, POSTER, FILM, { ...LOGO }],
    commercial_references: [{ kind: "offering", id: FX(30), url: "https://host.usemingla.com/e/example/tasting" }],
  }) as unknown as RestaurantArtifact;
}
