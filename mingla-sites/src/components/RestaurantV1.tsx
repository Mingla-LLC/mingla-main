/* eslint-disable @next/next/no-img-element -- media is already sanitized, responsive, immutable, and integrity-checked by the controlled route. */
import Link from "next/link";
import { Fragment } from "react";
import type { RestaurantArtifact, RestaurantBlock } from "../contracts/artifact";
import {
  hrefForPage,
  homePage,
  navigablePages,
  type ArtifactPage,
} from "../lib/pageRouting";
import { isCanonicalMinglaHref, isSafeHref } from "../contracts/artifact";
import { ConsentControl } from "./ConsentControl";
import { MenuCart, type CartItem } from "./MenuCart";
import { HeroVideo } from "./HeroVideo";
import { ReelVideo } from "./ReelVideo";
import { RevealOnScroll } from "./RevealOnScroll";
import { HeaderScrollState } from "./HeaderScrollState";
import { menuSectionSlug } from "../lib/menuSections";
import { CartScope } from "./CartScope";
import { HeaderCart } from "./HeaderCart";
import { SiteNav } from "./SiteNav";
import { SiteTheme } from "./SiteTheme";
import { SiteRuntimeClient } from "./SiteRuntimeClient";
import { TrackedLink } from "./TrackedLink";
import type { SiteEventContext } from "../lib/clientAnalytics";

function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function items(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : []; }

function firstBlock(
  blocks: RestaurantBlock[],
  type: RestaurantBlock["type"],
): RestaurantBlock | undefined {
  return blocks.find((block) => block.type === type);
}

function SafeLink({ href, children, className, context, ctaKind = "checkout", offeringId }: { href: unknown; children: React.ReactNode; className?: string; context?: SiteEventContext; ctaKind?: "offering" | "reservation" | "checkout" | "contact" | "menu"; offeringId?: string }) {
  if (!isSafeHref(href)) return null;
  if (context && isCanonicalMinglaHref(href)) return <TrackedLink href={href} className={className} context={context} ctaKind={ctaKind} offeringId={offeringId}>{children}</TrackedLink>;
  const external = !href.startsWith("/");
  return <a href={href} className={className} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{children}{external ? <span className="sr-only"> (opens in a new tab)</span> : null}</a>;
}


/**
 * #2830 — format a menu price, or render NOTHING.
 *
 * Mingla stores price in MINOR units and allows NULL, which means "price on
 * request" — gogi's own printed menu has items like that. Rendering a missing
 * price as 0, or picking a currency when none is recorded, would be fabricated
 * data on a real restaurant's real menu. Both parts must be present, or the
 * row simply carries no number.
 */
function formatMenuPrice(minor: unknown, currency: unknown): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      /*
       * #2830 -- "narrowSymbol" so a naira price reads "₦8,500" and not
       * "NGN 8,500", which is what the brand's own menu shows. Inside the
       * existing try: an environment without the ICU data for it throws, and
       * the catch already falls back rather than showing nothing.
       */
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  } catch {
    return null;
  }
}


/*
 * #2830 — the second half of a headline in the brand's accent colour.
 *
 * gogi's own hero reads "WHERE LAGOS" in ivory over "COMES TO EAT" in gold, and
 * that two-tone split is most of what makes it look designed rather than
 * typeset. The rule is generic — split at the word midpoint — so every brand
 * gets the effect in ITS OWN accent, and nothing about gogi is hardcoded.
 *
 * Short headings are left alone: splitting "Our menu" into "Our" and "menu"
 * would look like a mistake.
 */
export function splitHeadline(value: string): { lead: string; accent: string } {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return { lead: value, accent: "" };
  const at = Math.floor(words.length / 2);
  return { lead: words.slice(0, at).join(" "), accent: words.slice(at).join(" ") };
}

/*
 * #3149 -- THE EYEBROW IS THE BRAND'S, OR THERE IS NO EYEBROW.
 *
 * Every section used to be handed a fixed label here -- "Gallery", "Film",
 * "Team", "Story", "Visit" -- because a block had nowhere to carry the brand's
 * own. That is Mingla writing copy on a restaurant's own website, and it is
 * the single loudest reason our render read as a template: gogi's site writes
 * "The place", "The menu", "Straight from @gogilagos" over the same sections.
 *
 * #2830 established the descriptor as the least-wrong placeholder while there
 * was no field. There is a field now, so the placeholder is gone rather than
 * improved. A block that supplies nothing renders NO eyebrow element at all --
 * a missing line is honest, an invented one is not (Constitution rule 9).
 *
 * What survives from #2830 is the duplicate guard: a brand that writes the
 * same words twice gets them printed once. The live page rendered "VISIT /
 * VISIT" and "IN THE ROOM / IN THE ROOM", and a brand can still type that.
 */
function Eyebrow({ label, heading }: { label: unknown; heading: unknown }) {
  const written = typeof label === "string" ? label.trim() : "";
  if (!written) return null;
  const beneath = typeof heading === "string" ? heading.trim().toLowerCase() : "";
  if (beneath === written.toLowerCase()) return null;
  return <p className="eyebrow">{written}</p>;
}

function Block({ block, context, primaryHeading = false, facts }: { block: RestaurantBlock; context: SiteEventContext; primaryHeading?: boolean; facts?: React.ReactNode }) {
  switch (block.type) {
    case "hero": {
      const Heading = primaryHeading ? "h1" : "h2";
      const headline = splitHeadline(text(block.heading, "Welcome"));
      /*
       * The scrim lives in CSS only. It used to be set here AND in `.hero::after`
       * with the same 0.82 gradient, so it compounded to ~0.97 and buried the
       * brand's own photography.
       */
      return <section className="hero" style={isSafeHref(block.media_url) ? { backgroundImage: `url(${JSON.stringify(block.media_url).slice(1, -1)})` } : undefined}>{isSafeHref(block.video_url) && isSafeHref(block.media_url) ? <HeroVideo src={text(block.video_url)} poster={text(block.media_url)} /> : null}<div><Heading>{headline.lead}{headline.accent ? <>{" "}<span className="accent-line">{headline.accent}</span></> : null}</Heading>{block.subheading ? <p>{text(block.subheading)}</p> : null}<div className="hero-actions">{items(block.ctas).slice(0, 2).map((cta, index) => <SafeLink key={index} href={cta.href} context={context} className={index ? "button ghost" : "button accent"}>{text(cta.label, "Learn more")}</SafeLink>)}</div></div>{facts}{primaryHeading ? <span className="hero-scroll" aria-hidden="true">Scroll</span> : null}</section>;
    }
    case "rich_text": return <section className="prose editorial-prose"><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading)}</h2>{items(block.paragraphs).map((paragraph, index) => <p key={index}>{text(paragraph.text)}</p>)}</section>;
    case "media_feature": return <section className="feature editorial-feature"><div className="editorial-media">{isSafeHref(block.media_url) ? <img src={text(block.media_url)} alt={text(block.alt)} width={960} height={720} /> : null}</div><div><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading)}</h2><p>{text(block.caption)}</p></div></section>;
    case "cta": return <section className="cta"><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading)}</h2><p>{text(block.body)}</p><SafeLink href={block.href} context={context} className="button accent">{text(block.label, "Continue")}</SafeLink></section>;
    case "offering_grid": return <section className="editorial-grid"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Experiences")} /><h2>{text(block.heading, "Experiences")}</h2><div className="grid">{items(block.offerings).map((offering, index) => <article className="tile" key={text(offering.id, String(index))}><h3>{text(offering.label, "Experience")}</h3><p>{text(offering.summary)}</p><SafeLink href={offering.url} context={context} ctaKind="offering" offeringId={text(offering.id)}>View on Mingla</SafeLink></article>)}</div></section>;
    case "venue_reservation": return <section className="cta"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Make a reservation")} /><h2>{text(block.heading, "Make a reservation")}</h2><p>{text(block.body)}</p><SafeLink href={block.url} context={context} ctaKind="reservation" className="button accent">Continue with Mingla</SafeLink></section>;
    case "menu_link": return <section className="menu-link"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Explore the menu")} /><h2>{text(block.heading, "Explore the menu")}</h2><SafeLink href={block.href} context={context} ctaKind="menu" className="button accent">{text(block.label, "View menu")}</SafeLink></section>;
    case "menu_board": {
      const sections = items(block.sections);
      const orderable = typeof block.venue_id === "string";
      /*
       * ORDERING IS ON only when the published site names one verified venue.
       * With no venue — or more than one — Mingla will not guess which kitchen
       * a website order belongs to, so the menu is shown and the cart is not.
       * A menu you cannot order from is a disappointment; an order cooked in
       * the wrong building is a refund and someone's ruined night.
       */
      if (orderable) {
        const cartItems: CartItem[] = sections.flatMap((section) =>
          items(section.items).map((item) => ({
            id: text(item.id),
            name: text(item.name),
            price_minor: typeof item.price_minor === "number" ? item.price_minor : null,
            currency: typeof item.currency === "string" ? item.currency : null,
            description: item.description == null ? null : text(item.description),
            section: text(section.name),
          })),
        );
        return <section className="menu-board"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Menu")} /><h2>{text(block.heading, "Menu")}</h2>{block.note ? <p className="menu-note">{text(block.note)}</p> : null}<MenuCart items={cartItems} /></section>;
      }
      return <section className="menu-board"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Menu")} /><h2>{text(block.heading, "Menu")}</h2>{block.note ? <p className="menu-note">{text(block.note)}</p> : null}{sections.map((section, sectionIndex) => <div className="menu-section" id={menuSectionSlug(text(section.name))} key={`${text(section.name)}-${sectionIndex}`}><h3>{text(section.name)}</h3>{section.description ? <p className="menu-section-note">{text(section.description)}</p> : null}<ul className="menu-list">{items(section.items).map((item, itemIndex) => { const price = formatMenuPrice(item.price_minor, item.currency); return <li className="menu-row" key={`${text(item.name)}-${itemIndex}`}><div className="menu-row-head"><span className="menu-item-name">{text(item.name)}</span><span className="menu-leader" aria-hidden="true" />{price ? <span className="menu-price">{price}</span> : null}</div>{item.description ? <p className="menu-item-note">{text(item.description)}</p> : null}</li>; })}</ul></div>)}</section>;
    }
    case "video_feature":
      return <section className="video-feature"><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading)}</h2>{block.caption ? <p className="video-caption">{text(block.caption)}</p> : null}<ReelVideo src={text(block.video_url)} poster={text(block.poster_url)} label={text(block.heading, "Video")} /></section>;
    case "team":
      return <section className="team"><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading, "The team")}</h2>{block.caption ? <p>{text(block.caption)}</p> : null}<ul className="team-grid">{items(block.members).map((member, index) => <li key={`${text(member.name)}-${index}`}>{isSafeHref(member.media_url) ? <img src={text(member.media_url)} alt={text(member.alt)} width={480} height={480} loading="lazy" /> : <span className="team-initial" aria-hidden="true">{text(member.name).slice(0, 1)}</span>}<strong>{text(member.name)}</strong>{member.role ? <span>{text(member.role)}</span> : null}</li>)}</ul></section>;
    case "gallery": { const galleryImages = items(block.images).slice(0, 12); return <section className="editorial-gallery"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Gallery")} /><h2>{text(block.heading, "Gallery")}</h2><div className={galleryImages.length <= 4 ? "gallery gallery-strip" : "gallery"}>{galleryImages.map((image, index) => isSafeHref(image.url) ? <img key={index} src={text(image.url)} alt={text(image.alt)} width={640} height={640} /> : null)}</div></section>; }
    case "hours_location": return <section className="feature"><div><Eyebrow label={block.eyebrow} heading={text(block.heading, "Hours & location")} /><h2>{text(block.heading, "Hours & location")}</h2><p>{text(block.address)}</p><SafeLink href={block.map_url}>Open map</SafeLink></div><div className="hours">{items(block.hours).map((row, index) => <p key={index}><strong>{text(row.day)}</strong><span>{text(row.value)}</span></p>)}</div></section>;
    case "testimonials": return <section><Eyebrow label={block.eyebrow} heading={text(block.heading, "What guests say")} /><h2>{text(block.heading, "What guests say")}</h2><div className="grid">{items(block.items).slice(0, 8).map((item, index) => <blockquote className="tile" key={index}>“{text(item.quote)}”<footer>{text(item.name)}</footer></blockquote>)}</div></section>;
    case "faq": return <section><Eyebrow label={block.eyebrow} heading={text(block.heading, "Questions")} /><h2>{text(block.heading, "Questions")}</h2>{items(block.items).slice(0, 12).map((item, index) => <details key={index}><summary>{text(item.question)}</summary><p>{text(item.answer)}</p></details>)}</section>;
    case "contact_handoff": return <section className="cta"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Get in touch")} /><h2>{text(block.heading, "Get in touch")}</h2><p>{text(block.body)}</p><SafeLink href={block.href} context={context} ctaKind="contact" className="button accent">{text(block.label, "Contact")}</SafeLink></section>;
    case "divider": return <hr />;
    case "spacer": return <div className={`spacer ${["small", "medium", "large"].includes(text(block.size)) ? text(block.size) : "medium"}`} aria-hidden="true" />;
  }
}

/**
 * #2830 — renders ONE page.
 *
 * It used to concatenate every enabled page into a single document and link
 * between them with anchors, so Home and Visit were literally the same page.
 * That is why the hours block appeared three times on the live Gogi site, and
 * why "5 pages" was never true. The artifact has always modelled real pages —
 * slug, title, nav order, per-page SEO — and only the renderer collapsed them.
 */
/*
 * #2830 -- a run of reels is one grid, not a stack of full-width sections.
 * gogi's gallery shows six films four-across; ours rendered each as its own
 * banner, so the page was six screens of one video each. A LONE reel is still
 * a feature -- a single card floating in a grid would look like a mistake.
 */
type RenderGroup =
  | { kind: "block"; block: RestaurantBlock; index: number }
  | { kind: "reels"; reels: { block: RestaurantBlock; index: number }[] };

export function groupReels(blocks: RestaurantBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.type !== "video_feature") {
      groups.push({ kind: "block", block, index });
      continue;
    }
    const reels: { block: RestaurantBlock; index: number }[] = [];
    while (index < blocks.length && blocks[index]!.type === "video_feature") {
      reels.push({ block: blocks[index]!, index });
      index += 1;
    }
    index -= 1;
    if (reels.length > 1) groups.push({ kind: "reels", reels });
    else groups.push({ kind: "block", block: reels[0]!.block, index: reels[0]!.index });
  }
  return groups;
}

/*
 * #3149 -- a run of reels is ONE grid, so it gets ONE heading, and that
 * heading is read off the FIRST reel in the run.
 *
 * The grid had no heading at all: six films appeared under nothing, while
 * every other section on the page announced itself. gogi title theirs ("The
 * room, on any given night" over the home run), so the words belong to the
 * brand and there is nowhere else to put them -- a grid is not a block, it is
 * several, and only the first one can speak for the group without the page
 * printing the same heading four times.
 *
 * NO group_heading MEANS NO HEADING. The grid then renders exactly as it did
 * before, which is the behaviour every already-published site keeps.
 */
function reelGridHeading(first: RestaurantBlock): React.ReactNode {
  const heading = typeof first.group_heading === "string"
    ? first.group_heading.trim()
    : "";
  if (!heading) return null;
  return <div className="reel-grid-head"><Eyebrow label={first.eyebrow} heading={heading} /><h2>{heading}</h2></div>;
}

export function RestaurantV1({
  artifact,
  page,
}: {
  artifact: RestaurantArtifact;
  page?: ArtifactPage;
}) {
  const home = homePage(artifact);
  const current = page ?? home;
  if (!current) return null;
  const isHome = current.role === "home";
  const context = { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id };
  const navPages = navigablePages(artifact);
  const primaryHeroIndex = current.blocks.findIndex((block) => block.type === "hero");
  const hoursLocation = firstBlock(current.blocks, "hours_location");
  const reservation = firstBlock(current.blocks, "venue_reservation");
  const menu = firstBlock(current.blocks, "menu_link");
  const contact = firstBlock(current.blocks, "contact_handoff");
  const primaryAction = reservation?.type === "venue_reservation"
    ? { href: reservation.url, label: "Reserve", kind: "reservation" as const }
    : menu?.type === "menu_link"
      ? { href: menu.href, label: text(menu.label, "View menu"), kind: "menu" as const }
      : null;
  const address = hoursLocation?.type === "hours_location"
    ? text(hoursLocation.address, artifact.footer.address)
    : text(artifact.footer.address);
  const hours = hoursLocation?.type === "hours_location"
    ? items(hoursLocation.hours)[0]
    : undefined;
  /*
   * The bag appears only when this site has a menu that can actually be
   * ordered from -- one page carrying a menu_board that names a verified venue.
   * Everything else gets no cart at all rather than a cart that cannot check
   * out.
   */
  const orderablePage = artifact.pages.find((page) =>
    page.enabled === true &&
    (page.blocks ?? []).some(
      (block) => block.type === "menu_board" && typeof block.venue_id === "string",
    ));
  /*
   * #2830 — a site you can order from says so in the header, as gogi's does.
   * Only when there IS an orderable menu, and only if the page has not already
   * claimed the slot with a reservation or a menu link.
   */
  const headerAction = primaryAction ?? (orderablePage
    ? {
      href: hrefForPage(orderablePage as ArtifactPage),
      label: "Order now",
      kind: "menu" as const,
    }
    : null);
  const contactLink = contact?.type === "contact_handoff"
    ? { href: contact.href, label: text(contact.label, "Contact") }
    : artifact.footer.links?.[0];
  /*
   * #2830 -- an inner page gets a header band, as every inner page on the
   * reference does. Its backdrop is the brand's OWN hero photograph, not a
   * stock image and not a guess: if the home page has no hero, the band simply
   * renders flat.
   */
  const pageBackdrop = text(
    firstBlock(homePage(artifact)?.blocks ?? [], "hero")?.media_url,
  );
  /*
   * #3149 -- the header is FIXED, so it no longer occupies any space and three
   * page shapes reach this renderer. A hero-led page wants its hero to run
   * under the transparent header. A page with no hero renders `.page-header`,
   * which carries its own clearance. What is left is a page whose hero sits
   * further down: everything above it would start behind the header, so main
   * is offset by the header's height. Only the renderer knows the block order,
   * so only the renderer can tell these apart.
   */
  const contentStartsUnderHeader = primaryHeroIndex > 0;
  /*
   * #2830 -- the facts sit INSIDE the hero, at its foot, as they do on the
   * site this renders. They used to be a band below it, which pushed them off
   * a full-height hero entirely and read as a separate section.
   */
  const factRail = <aside className="fact-rail" aria-label="Restaurant facts"><dl><div><dt>Visit</dt><dd>{address || "See restaurant details"}</dd></div><div><dt>Hours</dt><dd>{hours ? `${text(hours.day)} ${text(hours.value)}` : "See current opening hours"}</dd></div><div><dt>Contact</dt><dd>{contactLink && isSafeHref(contactLink.href) ? <SafeLink href={contactLink.href} context={context} ctaKind="contact">{contactLink.label}</SafeLink> : "Contact the restaurant"}</dd></div></dl></aside>;
  return <CartScope siteId={artifact.site_id}><SiteTheme artifact={artifact} /><SiteRuntimeClient context={context} /><RevealOnScroll /><HeaderScrollState /><a className="skip" href="#main">Skip to content</a><header className="site-header"><Link href="/" className="brand">{artifact.site_settings.display_name}</Link><SiteNav links={navPages.map((navPage) => ({ role: navPage.role, label: String(navPage.nav_label ?? ""), href: hrefForPage(navPage), current: navPage.role === current.role }))} />{orderablePage ? <HeaderCart menuHref={hrefForPage(orderablePage as ArtifactPage)} onMenuPage={orderablePage.role === current.role} /> : null}{headerAction ? <SafeLink href={headerAction.href} context={context} ctaKind={headerAction.kind} className="header-action accent">{headerAction.label}</SafeLink> : null}</header><main id="main" className={contentStartsUnderHeader ? "header-offset" : undefined}>{primaryHeroIndex < 0 ? <header className="page-header" style={isSafeHref(pageBackdrop) ? { backgroundImage: `url(${JSON.stringify(pageBackdrop).slice(1, -1)})` } : undefined}><div><h1>{current.title}</h1><nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">{current.title}</span></nav></div></header> : null}<div className="page-content">{groupReels(current.blocks).map((group, groupIndex) => group.kind === "reels" ? <section className="reel-grid" key={`reels-${groupIndex}`}>{reelGridHeading(group.reels[0]!.block)}{group.reels.map(({ block, index }) => <figure className="reel-card" key={`${block.type}-${index}`}><ReelVideo src={text(block.video_url)} poster={text(block.poster_url)} label={text(block.heading, "Film")} /><figcaption>{text(block.heading)}</figcaption></figure>)}</section> : <Fragment key={`${group.block.type}-${group.index}`}><Block block={group.block} context={context} primaryHeading={group.index === primaryHeroIndex} facts={isHome && group.index === primaryHeroIndex ? factRail : undefined} /></Fragment>)}</div></main><footer className="footer"><div><strong>{artifact.site_settings.display_name}</strong>{artifact.footer.address ? <p>{artifact.footer.address}</p> : null}<p>{artifact.footer.legal_text}</p></div><nav aria-label="Footer navigation">{navPages.map((navPage) => <Link key={navPage.role} href={hrefForPage(navPage)}>{navPage.nav_label}</Link>)}</nav><div>{artifact.footer.links?.map((link) => <SafeLink key={link.href} href={link.href}>{link.label}</SafeLink>)}</div><ConsentControl siteId={artifact.site_id} brandId={artifact.brand_id} publicationId={artifact.publication_id} /></footer></CartScope>;
}
