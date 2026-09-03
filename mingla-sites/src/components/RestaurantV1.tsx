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
import { RevealOnScroll } from "./RevealOnScroll";
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
      maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  } catch {
    return null;
  }
}


/**
 * #2830 — an eyebrow that would only echo the heading is not rendered.
 *
 * Each section carries a fixed category label above its heading — the
 * eyebrow-then-rule rhythm the design uses. The headings underneath are the
 * BRAND'S OWN WORDS, and a restaurant naming its hours section "Visit" or its
 * gallery "In the room" is not a coincidence: those are the obvious names, and
 * they are the same words the label uses. The live page rendered "VISIT / VISIT"
 * and "IN THE ROOM / IN THE ROOM".
 *
 * Found by looking at the page rather than by reading the code, which is the
 * only way this kind of duplication ever shows up.
 */
function Eyebrow({ label, heading }: { label: string; heading: unknown }) {
  const written = typeof heading === "string" ? heading.trim().toLowerCase() : "";
  if (written === label.trim().toLowerCase()) return null;
  return <p className="eyebrow">{label}</p>;
}

function Block({ block, context, primaryHeading = false }: { block: RestaurantBlock; context: SiteEventContext; primaryHeading?: boolean }) {
  switch (block.type) {
    case "hero": {
      const Heading = primaryHeading ? "h1" : "h2";
      return <section className="hero" style={isSafeHref(block.media_url) ? { backgroundImage: `linear-gradient(90deg,rgba(8,6,4,.82),rgba(8,6,4,.18)),url(${JSON.stringify(block.media_url).slice(1, -1)})` } : undefined}>{isSafeHref(block.video_url) && isSafeHref(block.media_url) ? <HeroVideo src={text(block.video_url)} poster={text(block.media_url)} /> : null}<div><Heading>{text(block.heading, "Welcome")}</Heading>{block.subheading ? <p>{text(block.subheading)}</p> : null}<div className="hero-actions">{items(block.ctas).slice(0, 2).map((cta, index) => <SafeLink key={index} href={cta.href} context={context} className={index ? "button ghost" : "button accent"}>{text(cta.label, "Learn more")}</SafeLink>)}</div></div></section>;
    }
    case "rich_text": return <section className="prose editorial-prose"><h2>{text(block.heading)}</h2>{items(block.paragraphs).map((paragraph, index) => <p key={index}>{text(paragraph.text)}</p>)}</section>;
    case "media_feature": return <section className="feature editorial-feature"><div className="editorial-media">{isSafeHref(block.media_url) ? <img src={text(block.media_url)} alt={text(block.alt)} width={960} height={720} /> : null}</div><div><Eyebrow label="Our story" heading={block.heading} /><h2>{text(block.heading)}</h2><p>{text(block.caption)}</p></div></section>;
    case "cta": return <section className="cta"><h2>{text(block.heading)}</h2><p>{text(block.body)}</p><SafeLink href={block.href} context={context} className="button accent">{text(block.label, "Continue")}</SafeLink></section>;
    case "offering_grid": return <section className="editorial-grid"><Eyebrow label="Book with Mingla" heading={text(block.heading, "Experiences")} /><h2>{text(block.heading, "Experiences")}</h2><div className="grid">{items(block.offerings).map((offering, index) => <article className="tile" key={text(offering.id, String(index))}><h3>{text(offering.label, "Experience")}</h3><p>{text(offering.summary)}</p><SafeLink href={offering.url} context={context} ctaKind="offering" offeringId={text(offering.id)}>View on Mingla</SafeLink></article>)}</div></section>;
    case "venue_reservation": return <section className="cta"><h2>{text(block.heading, "Make a reservation")}</h2><p>{text(block.body)}</p><SafeLink href={block.url} context={context} ctaKind="reservation" className="button accent">Continue with Mingla</SafeLink></section>;
    case "menu_link": return <section className="menu-link"><h2>{text(block.heading, "Explore the menu")}</h2><SafeLink href={block.href} context={context} ctaKind="menu" className="button accent">{text(block.label, "View menu")}</SafeLink></section>;
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
        return <section className="menu-board"><h2>{text(block.heading, "Menu")}</h2>{block.note ? <p className="menu-note">{text(block.note)}</p> : null}<MenuCart items={cartItems} /></section>;
      }
      return <section className="menu-board"><h2>{text(block.heading, "Menu")}</h2>{block.note ? <p className="menu-note">{text(block.note)}</p> : null}{sections.map((section, sectionIndex) => <div className="menu-section" key={`${text(section.name)}-${sectionIndex}`}><h3>{text(section.name)}</h3>{section.description ? <p className="menu-section-note">{text(section.description)}</p> : null}<ul className="menu-list">{items(section.items).map((item, itemIndex) => { const price = formatMenuPrice(item.price_minor, item.currency); return <li className="menu-row" key={`${text(item.name)}-${itemIndex}`}><div className="menu-row-head"><span className="menu-item-name">{text(item.name)}</span><span className="menu-leader" aria-hidden="true" />{price ? <span className="menu-price">{price}</span> : null}</div>{item.description ? <p className="menu-item-note">{text(item.description)}</p> : null}</li>; })}</ul></div>)}</section>;
    }
    case "gallery": return <section className="editorial-gallery"><Eyebrow label="In the room" heading={text(block.heading, "Gallery")} /><h2>{text(block.heading, "Gallery")}</h2><div className="gallery">{items(block.images).slice(0, 12).map((image, index) => isSafeHref(image.url) ? <img key={index} src={text(image.url)} alt={text(image.alt)} width={640} height={640} /> : null)}</div></section>;
    case "hours_location": return <section className="feature"><div><Eyebrow label="Visit" heading={text(block.heading, "Hours & location")} /><h2>{text(block.heading, "Hours & location")}</h2><p>{text(block.address)}</p><SafeLink href={block.map_url}>Open map</SafeLink></div><div className="hours">{items(block.hours).map((row, index) => <p key={index}><strong>{text(row.day)}</strong><span>{text(row.value)}</span></p>)}</div></section>;
    case "testimonials": return <section><h2>{text(block.heading, "What guests say")}</h2><div className="grid">{items(block.items).slice(0, 8).map((item, index) => <blockquote className="tile" key={index}>“{text(item.quote)}”<footer>{text(item.name)}</footer></blockquote>)}</div></section>;
    case "faq": return <section><h2>{text(block.heading, "Questions")}</h2>{items(block.items).slice(0, 12).map((item, index) => <details key={index}><summary>{text(item.question)}</summary><p>{text(item.answer)}</p></details>)}</section>;
    case "contact_handoff": return <section className="cta"><h2>{text(block.heading, "Get in touch")}</h2><p>{text(block.body)}</p><SafeLink href={block.href} context={context} ctaKind="contact" className="button accent">{text(block.label, "Contact")}</SafeLink></section>;
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
  const contactLink = contact?.type === "contact_handoff"
    ? { href: contact.href, label: text(contact.label, "Contact") }
    : artifact.footer.links?.[0];
  return <><SiteTheme artifact={artifact} /><SiteRuntimeClient context={context} /><RevealOnScroll /><a className="skip" href="#main">Skip to content</a><header className="site-header"><Link href="/" className="brand">{artifact.site_settings.display_name}</Link><nav aria-label="Main navigation">{navPages.map((navPage) => <Link key={navPage.role} href={hrefForPage(navPage)} aria-current={navPage.role === current.role ? "page" : undefined}>{navPage.nav_label}</Link>)}</nav>{primaryAction ? <SafeLink href={primaryAction.href} context={context} ctaKind={primaryAction.kind} className="header-action">{primaryAction.label}</SafeLink> : null}</header><main id="main">{primaryHeroIndex < 0 ? <h1 className="page-title">{current.title}</h1> : null}<div className="page-content">{current.blocks.map((block, index) => <Fragment key={`${block.type}-${index}`}><Block block={block} context={context} primaryHeading={index === primaryHeroIndex} />{isHome && index === primaryHeroIndex ? <aside className="fact-rail" aria-label="Restaurant facts"><dl><div><dt>Visit</dt><dd>{address || "See restaurant details"}</dd></div><div><dt>Hours</dt><dd>{hours ? `${text(hours.day)} ${text(hours.value)}` : "See current opening hours"}</dd></div><div><dt>Contact</dt><dd>{contactLink && isSafeHref(contactLink.href) ? <SafeLink href={contactLink.href} context={context} ctaKind="contact">{contactLink.label}</SafeLink> : "Contact the restaurant"}</dd></div></dl></aside> : null}</Fragment>)}</div></main><footer className="footer"><div><strong>{artifact.site_settings.display_name}</strong>{artifact.footer.address ? <p>{artifact.footer.address}</p> : null}<p>{artifact.footer.legal_text}</p></div><nav aria-label="Footer navigation">{navPages.map((navPage) => <Link key={navPage.role} href={hrefForPage(navPage)}>{navPage.nav_label}</Link>)}</nav><div>{artifact.footer.links?.map((link) => <SafeLink key={link.href} href={link.href}>{link.label}</SafeLink>)}</div><ConsentControl siteId={artifact.site_id} brandId={artifact.brand_id} publicationId={artifact.publication_id} /></footer></>;
}
