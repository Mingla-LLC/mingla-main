/*
 * #3149 wave 4 — the rebuilt footer, and the URL of a page that no longer
 * exists.
 *
 * Every string in the footer is asserted to come from somewhere real: the
 * brand's own content, Mingla's own menu data, or Mingla's own chrome. That
 * third category has exactly one member and it is named here, because a footer
 * is where a template quietly starts writing copy on a restaurant's behalf.
 *
 * The retired-page half is a routing claim rather than a rendering one, so it
 * exercises the resolver the route calls rather than grepping the route.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantV1 } from "./RestaurantV1";
import type { RestaurantArtifact } from "../contracts/artifact";
import { assertRestaurantArtifact } from "../contracts/artifact";
import { socialIconFor } from "./SocialIcon";
import {
  hrefForPage,
  navigablePages,
  pageForSlug,
  replacementForRetiredSlug,
} from "../lib/pageRouting";
import { menuGroupOf, menuSubNameOf } from "../lib/menuSections";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const SITE = U(90);
const HERO = {
  type: "hero",
  heading: "Where Lagos Comes to Eat",
  media_url: `/media/${U(80)}/960.webp`,
  ctas: [],
};
const MEDIA = [{
  id: U(80),
  url: `/media/${U(80)}/960.webp`,
  alt: "",
  width: 960,
  height: 720,
  integrity: "8".repeat(64),
  object_key: `approved/${SITE}/${U(80)}/960.webp`,
}];

const section = (name: string) => ({
  name,
  items: [{ id: U(50), name: `${name} dish`, price_minor: 1_000_000, currency: "NGN" }],
});

const MENU_BOARD = {
  type: "menu_board",
  heading: "The menu",
  venue_id: U(70),
  sections: [
    section("FOOD — Rice Bowls"),
    section("FOOD — Flat Burgers"),
    section("FOOD — Shawarmas"),
    section("DRINKS — Cocktails"),
  ],
};

const PAGES = [
  {
    role: "home",
    slug: "home",
    title: "Home",
    enabled: true,
    nav_label: "Home",
    nav_order: 0,
    blocks: [HERO],
  },
  {
    role: "menu",
    slug: "menu",
    title: "Menu",
    enabled: true,
    nav_label: "Menu",
    nav_order: 1,
    blocks: [MENU_BOARD],
  },
  {
    role: "about",
    slug: "about",
    title: "About",
    enabled: true,
    nav_label: "About",
    nav_order: 2,
    blocks: [{ type: "pull_quote", quote: "Find gögi." }],
  },
  {
    role: "reservations",
    slug: "reservations",
    title: "Reservations",
    enabled: true,
    nav_label: "Reservations",
    nav_order: 4,
    blocks: [{
      type: "venue_reservation",
      heading: "Book a table at gögi",
      body: "gögi is walk-in and always open.",
      url: `https://host.usemingla.com/reserve/${U(91)}`,
    }],
  },
];

function artifactOf(overrides: Record<string, unknown> = {}): RestaurantArtifact {
  const artifact = {
    schema_version: 1,
    site_id: SITE,
    brand_id: U(91),
    publication_id: U(92),
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    source_revision_id: U(93),
    source_digest: "a".repeat(64),
    generated_at: "2026-09-10T00:00:00Z",
    pages: PAGES,
    navigation: { page_roles: PAGES.map((page) => page.role) },
    footer: {
      address: "69 Admiralty Way, Lekki Phase 1, Lagos",
      hours_summary: "Open 24 hours, 7 days",
      legal_text: "Gogi Lagos Ltd",
      links: [
        { label: "Call 0912 711 7528", href: "tel:+2349127117528" },
        { label: "Instagram", href: "https://www.instagram.com/gogilagos/" },
      ],
    },
    site_settings: {
      display_name: "gögi",
      short_description: "A 24/7 food house at 69 Admiralty Way, Lekki Phase 1, Lagos.",
      seo: { canonical_url: "https://gogi.sites.usemingla.com" },
    },
    media: MEDIA,
    commercial_references: [],
    ...overrides,
  } as unknown as RestaurantArtifact;
  assertRestaurantArtifact(artifact);
  return artifact;
}

const footerOf = (artifact = artifactOf()): string => {
  const html = renderToStaticMarkup(
    <RestaurantV1 artifact={artifact} page={artifact.pages[0]!} />,
  );
  return html.slice(html.indexOf('<footer class="footer">'));
};

const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("#3149 wave 4 the footer's four columns", () => {
  const footer = footerOf();

  it("leads with the brand's own name and its own description", () => {
    expect(footer).toContain("<strong>gögi</strong>");
    expect(footer).toContain("A 24/7 food house at 69 Admiralty Way");
  });

  it("draws the contact buttons ITSELF, from where each link goes", () => {
    // Two, not three: gögi publish no WhatsApp destination, so no WhatsApp
    // button is invented to fill the row out.
    expect(footer.split('class="social-button"').length - 1).toBe(2);
    expect(footer).toContain('class="social-icon"');
    expect(footer).not.toMatch(/<i class="fa/);
    // Nothing is fetched to draw them, and the buttons are still named.
    expect(footer).toContain("<span class=\"sr-only\">Instagram</span>");
  });

  it("names the site's own pages under SITE", () => {
    expect(footer).toContain("<h2>Site</h2>");
    for (const label of ["Home", "Menu", "About", "Reservations"]) {
      expect(footer).toContain(`>${label}</a>`);
    }
  });

  it("takes the MENU column from Mingla, and prints the course, not the row", () => {
    expect(footer).toContain("<h2>Menu</h2>");
    // Mingla's names carry the course as a prefix; a footer column reading
    // "FOOD — Rice Bowls" looks like a database row.
    expect(footer).toContain(">Rice Bowls</a>");
    expect(footer).toContain(">Flat Burgers</a>");
    expect(footer).toContain(">Shawarmas</a>");
    expect(footer).toContain(">Cocktails</a>");
    expect(footer).not.toContain("FOOD —");
    expect(footer).not.toContain("DRINKS —");
    // And each one is a link INTO the menu at that course.
    expect(footer).toContain('href="/menu#rice-bowls"');
  });

  it("prints no MENU column at all when Mingla has no menu", () => {
    const bare = footerOf(artifactOf({
      pages: PAGES.filter((page) => page.role !== "menu"),
      navigation: {
        page_roles: PAGES.filter((page) => page.role !== "menu").map((p) => p.role),
      },
    }));
    expect(bare).not.toContain("<h2>Menu</h2>");
    expect(bare).toContain("<h2>Site</h2>");
  });

  it("carries no PDF link, because gögi publish no menu PDF", () => {
    /*
     * The reference's footer offers one. Ours will not link a file that does
     * not exist — there is no `menu_link` block and no PDF in their media — so
     * the row is absent rather than broken.
     */
    expect(textOf(footer)).not.toContain("Download the PDF");
    expect(footer).not.toContain(".pdf");
  });

  it("prints the address, the phone and the hours under FIND US", () => {
    expect(footer).toContain("<h2>Find us</h2>");
    expect(footer).toContain("69 Admiralty Way, Lekki Phase 1, Lagos");
    expect(footer).toContain("Call 0912 711 7528");
    expect(footer).toContain('class="footer-hours">Open 24 hours, 7 days</p>');
  });

  it("caps the menu column so a 20-course menu cannot become the page", () => {
    const many = footerOf(artifactOf({
      pages: PAGES.map((page) =>
        page.role === "menu"
          ? {
            ...page,
            blocks: [{
              ...MENU_BOARD,
              sections: Array.from({ length: 12 }, (unused, index) =>
                section(`FOOD — Course ${index + 1}`)),
            }],
          }
          : page
      ),
    }));
    const menuColumn = many.slice(many.indexOf("<h2>Menu</h2>"));
    const column = menuColumn.slice(0, menuColumn.indexOf("</nav>"));
    expect(column.split("</a>").length - 1).toBe(6);
  });
});

describe("#3149 wave 4 the bottom bar", () => {
  const footer = footerOf();

  it("carries the brand's own legal line", () => {
    expect(footer).toContain("<p>Gogi Lagos Ltd</p>");
  });

  it("credits MINGLA, and links where a restaurant would go to get one", () => {
    expect(footer).toContain(
      '<a href="https://usemingla.com/host" target="_blank" rel="noopener noreferrer" class="footer-credit">Powered by Mingla',
    );
  });

  it("does NOT copy the reference's own builder credit", () => {
    // "Demo site by somethingelse" is their credit, not ours to reproduce.
    expect(textOf(footer).toLowerCase()).not.toContain("somethingelse");
    expect(textOf(footer).toLowerCase()).not.toContain("demo site by");
  });

  it("renders the credit for every site, brand content or not", () => {
    // It is the runtime's, not the artifact's — a brand with an empty footer
    // still carries it, and no brand field can remove it.
    const bare = footerOf(artifactOf({ footer: { links: [] } }));
    expect(bare).toContain("Powered by Mingla");
    expect(bare).not.toContain("<h2>Find us</h2>\n");
  });
});

describe("#3149 wave 4 a link the destination chooses", () => {
  it("reads the icon off the href, and only off a host it knows", () => {
    expect(socialIconFor("tel:+2349127117528")).toBe("phone");
    expect(socialIconFor("https://www.instagram.com/gogilagos/")).toBe("instagram");
    expect(socialIconFor("https://wa.me/2349127117528")).toBe("whatsapp");
    expect(socialIconFor("https://gogi.example.com")).toBeNull();
  });

  it("is not fooled by a host that merely CONTAINS a known one", () => {
    // A substring match would put gögi's badge on a stranger's domain.
    expect(socialIconFor("https://instagram.com.example.net/gogi")).toBeNull();
    expect(socialIconFor("https://evil.test/?x=instagram.com")).toBeNull();
    expect(socialIconFor("mailto:hi@example.com")).toBeNull();
    expect(socialIconFor("not a url")).toBeNull();
  });
});

describe("#3149 wave 4 a retired page's URL still goes somewhere", () => {
  const artifact = artifactOf();

  it("sends /contact to the page that replaced it", () => {
    expect(pageForSlug(artifact, "contact")).toBeNull();
    const replacement = replacementForRetiredSlug(artifact, "contact");
    expect(replacement).not.toBeNull();
    expect(hrefForPage(replacement!)).toBe("/reservations");
  });

  it("does NOT redirect while the page is still live", () => {
    const withContact = artifactOf({
      pages: [...PAGES, {
        role: "contact",
        slug: "contact",
        title: "Visit",
        enabled: true,
        nav_label: "Visit",
        nav_order: 5,
        blocks: [{ type: "pull_quote", quote: "Find gögi." }],
      }],
      navigation: { page_roles: [...PAGES.map((p) => p.role), "contact"] },
    });
    expect(pageForSlug(withContact, "contact")).not.toBeNull();
    expect(replacementForRetiredSlug(withContact, "contact")).toBeNull();
  });

  it("404s rather than guessing when no replacement exists", () => {
    const noReservations = artifactOf({
      pages: PAGES.filter((page) => page.role !== "reservations"),
      navigation: {
        page_roles: PAGES.filter((p) => p.role !== "reservations").map((p) => p.role),
      },
    });
    expect(replacementForRetiredSlug(noReservations, "contact")).toBeNull();
  });

  it("redirects nothing else", () => {
    for (const slug of ["about", "menu", "gallery", "nonsense", "reservations"]) {
      expect(replacementForRetiredSlug(artifact, slug)).toBeNull();
    }
  });

  it("keeps the retired role out of the navigation", () => {
    expect(navigablePages(artifact).map((page) => page.role)).toEqual([
      "home",
      "menu",
      "about",
      "reservations",
    ]);
  });
});

describe("#3149 wave 4 one owner splits a Mingla section name", () => {
  it("gives the menu chips the course and the footer the dish", () => {
    expect(menuGroupOf("FOOD — Rice Bowls")).toBe("FOOD");
    expect(menuSubNameOf("FOOD — Rice Bowls")).toBe("Rice Bowls");
  });

  it("leaves a name with no separator whole, both ways", () => {
    expect(menuGroupOf("Desserts")).toBe("Desserts");
    expect(menuSubNameOf("Desserts")).toBe("Desserts");
  });

  it("handles the en dash and the hyphen the same way", () => {
    for (const dash of ["—", "–", "-"]) {
      expect(menuSubNameOf(`FOOD ${dash} Rice Bowls`)).toBe("Rice Bowls");
    }
  });
});
