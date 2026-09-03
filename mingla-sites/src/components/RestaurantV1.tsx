/* eslint-disable @next/next/no-img-element -- media is already sanitized, responsive, immutable, and integrity-checked by the controlled route. */
import Link from "next/link";
import { Fragment } from "react";
import type { RestaurantArtifact, RestaurantBlock } from "../contracts/artifact";
import { isCanonicalMinglaHref, isSafeHref } from "../contracts/artifact";
import { ConsentControl } from "./ConsentControl";
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

function Block({ block, context, primaryHeading = false }: { block: RestaurantBlock; context: SiteEventContext; primaryHeading?: boolean }) {
  switch (block.type) {
    case "hero": {
      const Heading = primaryHeading ? "h1" : "h2";
      return <section className="hero" style={isSafeHref(block.media_url) ? { backgroundImage: `linear-gradient(90deg,rgba(8,6,4,.82),rgba(8,6,4,.18)),url(${JSON.stringify(block.media_url).slice(1, -1)})` } : undefined}><div><Heading>{text(block.heading, "Welcome")}</Heading>{block.subheading ? <p>{text(block.subheading)}</p> : null}<div className="hero-actions">{items(block.ctas).slice(0, 2).map((cta, index) => <SafeLink key={index} href={cta.href} context={context} className={index ? "button ghost" : "button accent"}>{text(cta.label, "Learn more")}</SafeLink>)}</div></div></section>;
    }
    case "rich_text": return <section className="prose editorial-prose"><h2>{text(block.heading)}</h2>{items(block.paragraphs).map((paragraph, index) => <p key={index}>{text(paragraph.text)}</p>)}</section>;
    case "media_feature": return <section className="feature editorial-feature"><div className="editorial-media">{isSafeHref(block.media_url) ? <img src={text(block.media_url)} alt={text(block.alt)} width={960} height={720} /> : null}</div><div><p className="eyebrow">Our story</p><h2>{text(block.heading)}</h2><p>{text(block.caption)}</p></div></section>;
    case "cta": return <section className="cta"><h2>{text(block.heading)}</h2><p>{text(block.body)}</p><SafeLink href={block.href} context={context} className="button accent">{text(block.label, "Continue")}</SafeLink></section>;
    case "offering_grid": return <section className="editorial-grid"><p className="eyebrow">Book with Mingla</p><h2>{text(block.heading, "Experiences")}</h2><div className="grid">{items(block.offerings).map((offering, index) => <article className="tile" key={text(offering.id, String(index))}><h3>{text(offering.label, "Experience")}</h3><p>{text(offering.summary)}</p><SafeLink href={offering.url} context={context} ctaKind="offering" offeringId={text(offering.id)}>View on Mingla</SafeLink></article>)}</div></section>;
    case "venue_reservation": return <section className="cta"><h2>{text(block.heading, "Make a reservation")}</h2><p>{text(block.body)}</p><SafeLink href={block.url} context={context} ctaKind="reservation" className="button accent">Continue with Mingla</SafeLink></section>;
    case "menu_link": return <section className="menu-link"><h2>{text(block.heading, "Explore the menu")}</h2><SafeLink href={block.href} context={context} ctaKind="menu" className="button accent">{text(block.label, "View menu")}</SafeLink></section>;
    case "gallery": return <section className="editorial-gallery"><p className="eyebrow">In the room</p><h2>{text(block.heading, "Gallery")}</h2><div className="gallery">{items(block.images).slice(0, 12).map((image, index) => isSafeHref(image.url) ? <img key={index} src={text(image.url)} alt={text(image.alt)} width={640} height={640} /> : null)}</div></section>;
    case "hours_location": return <section className="feature"><div><p className="eyebrow">Visit</p><h2>{text(block.heading, "Hours & location")}</h2><p>{text(block.address)}</p><SafeLink href={block.map_url}>Open map</SafeLink></div><div className="hours">{items(block.hours).map((row, index) => <p key={index}><strong>{text(row.day)}</strong><span>{text(row.value)}</span></p>)}</div></section>;
    case "testimonials": return <section><h2>{text(block.heading, "What guests say")}</h2><div className="grid">{items(block.items).slice(0, 8).map((item, index) => <blockquote className="tile" key={index}>“{text(item.quote)}”<footer>{text(item.name)}</footer></blockquote>)}</div></section>;
    case "faq": return <section><h2>{text(block.heading, "Questions")}</h2>{items(block.items).slice(0, 12).map((item, index) => <details key={index}><summary>{text(item.question)}</summary><p>{text(item.answer)}</p></details>)}</section>;
    case "contact_handoff": return <section className="cta"><h2>{text(block.heading, "Get in touch")}</h2><p>{text(block.body)}</p><SafeLink href={block.href} context={context} ctaKind="contact" className="button accent">{text(block.label, "Contact")}</SafeLink></section>;
    case "divider": return <hr />;
    case "spacer": return <div className={`spacer ${["small", "medium", "large"].includes(text(block.size)) ? text(block.size) : "medium"}`} aria-hidden="true" />;
  }
}

export function RestaurantV1({ artifact }: { artifact: RestaurantArtifact }) {
  const home = artifact.pages.find((page) => page.role === "home");
  if (!home) return null;
  const context = { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id };
  const enabledPages = artifact.pages.filter((page) => page.enabled).sort((a, b) => a.nav_order - b.nav_order);
  const primaryHeroIndex = home.blocks.findIndex((block) => block.type === "hero");
  const hoursLocation = firstBlock(home.blocks, "hours_location");
  const reservation = firstBlock(home.blocks, "venue_reservation");
  const menu = firstBlock(home.blocks, "menu_link");
  const contact = firstBlock(home.blocks, "contact_handoff");
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
  return <><SiteRuntimeClient context={context} /><a className="skip" href="#main">Skip to content</a><header className="site-header"><Link href="/" className="brand">{artifact.site_settings.display_name}</Link><nav aria-label="Main navigation">{enabledPages.map((page) => <a key={page.role} href={page.role === "home" ? "/" : `/#${page.role}`}>{page.nav_label}</a>)}</nav>{primaryAction ? <SafeLink href={primaryAction.href} context={context} ctaKind={primaryAction.kind} className="header-action">{primaryAction.label}</SafeLink> : null}</header><main id="main">{primaryHeroIndex < 0 ? <h1 className="sr-only">{artifact.site_settings.display_name}</h1> : null}{enabledPages.map((page) => <div className="page-content" id={page.role === "home" ? undefined : page.role} key={page.role} aria-labelledby={page.role === "home" ? undefined : `page-${page.role}-title`}>{page.role !== "home" ? <h2 className="sr-only" id={`page-${page.role}-title`}>{page.title}</h2> : null}{page.blocks.map((block, index) => <Fragment key={`${block.type}-${index}`}><Block block={block} context={context} primaryHeading={page.role === "home" && index === primaryHeroIndex} />{page.role === "home" && index === primaryHeroIndex ? <aside className="fact-rail" aria-label="Restaurant facts"><dl><div><dt>Visit</dt><dd>{address || "See restaurant details"}</dd></div><div><dt>Hours</dt><dd>{hours ? `${text(hours.day)} ${text(hours.value)}` : "See current opening hours"}</dd></div><div><dt>Contact</dt><dd>{contactLink && isSafeHref(contactLink.href) ? <SafeLink href={contactLink.href} context={context} ctaKind="contact">{contactLink.label}</SafeLink> : "Contact the restaurant"}</dd></div></dl></aside> : null}</Fragment>)}</div>)}</main><footer className="footer"><div><strong>{artifact.site_settings.display_name}</strong>{artifact.footer.address ? <p>{artifact.footer.address}</p> : null}<p>{artifact.footer.legal_text}</p></div><nav aria-label="Footer navigation">{enabledPages.map((page) => <a key={page.role} href={page.role === "home" ? "/" : `/#${page.role}`}>{page.nav_label}</a>)}</nav><div>{artifact.footer.links?.map((link) => <SafeLink key={link.href} href={link.href}>{link.label}</SafeLink>)}</div><ConsentControl siteId={artifact.site_id} brandId={artifact.brand_id} publicationId={artifact.publication_id} /></footer></>;
}
