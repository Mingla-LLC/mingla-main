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
import {
  isCanonicalMinglaHref,
  isSafeHref,
  isStatsIcon,
} from "../contracts/artifact";
import { ConsentControl } from "./ConsentControl";
import { LocalNowLine, OpenNowPill } from "./LocalClock";
import { StatIcon } from "./StatIcon";
import { MenuCart, type CartItem } from "./MenuCart";
import { HeroVideo } from "./HeroVideo";
import { ReelVideo } from "./ReelVideo";
import { RevealOnScroll } from "./RevealOnScroll";
import { HeaderScrollState } from "./HeaderScrollState";
import { GalleryLightbox } from "./GalleryLightbox";
import { MapEmbed } from "./MapEmbed";
import { menuSectionSlug, menuSubNameOf } from "../lib/menuSections";
import { SocialGlyph, socialIconFor } from "./SocialIcon";
import { CartScope } from "./CartScope";
import { HeaderCart } from "./HeaderCart";
import { SiteNav } from "./SiteNav";
import { SiteTheme } from "./SiteTheme";
import { SiteRuntimeClient } from "./SiteRuntimeClient";
import { TrackedLink } from "./TrackedLink";
import type { SiteEventContext } from "../lib/clientAnalytics";

function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function items(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : []; }
/*
 * #3149 -- a coordinate is a NUMBER or it is nothing. `Number(null)` is 0, and
 * 0,0 is a real point in the Atlantic: coercing a missing latitude would draw
 * a map of open ocean instead of drawing none.
 */
function coordinate(value: unknown): number { return typeof value === "number" ? value : Number.NaN; }

function firstBlock(
  blocks: RestaurantBlock[],
  type: RestaurantBlock["type"],
): RestaurantBlock | undefined {
  return blocks.find((block) => block.type === type);
}

/*
 * #3149 wave 4 -- a button needs BOTH HALVES or it is not a button.
 *
 * A label with no destination is a word that does nothing, and a destination
 * with no label is a link with no accessible name. Every new call to action in
 * this wave -- under the team grid, under the reels, beside the menu preview,
 * at the foot of the story -- is optional on both sides, so a half-filled
 * Studio form renders NO control rather than a broken one.
 */
function ctaOf(
  label: unknown,
  href: unknown,
): { label: string; href: string } | null {
  const written = typeof label === "string" ? label.trim() : "";
  if (!written || !isSafeHref(href)) return null;
  return { label: written, href };
}

/*
 * #3149 wave 4 -- the zone a live clock may be drawn from, or null.
 *
 * BOTH facts are required and NEITHER is inferred. `hours` is a list of
 * display strings -- "Open 24 hours" is a sentence and not a schedule -- so a
 * venue that has not declared `always_open` gets no open/closed claim at all,
 * whatever its hours happen to read. That is the whole reason this was refused
 * twice before the fields existed.
 */
function liveClockZone(block: RestaurantBlock | undefined): string | null {
  if (!block || block.type !== "hours_location") return null;
  if (block.always_open !== true) return null;
  return typeof block.timezone === "string" ? block.timezone : null;
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

function Block({ block, context, primaryHeading = false, facts, pill }: { block: RestaurantBlock; context: SiteEventContext; primaryHeading?: boolean; facts?: React.ReactNode; pill?: React.ReactNode }) {
  switch (block.type) {
    case "hero": {
      const Heading = primaryHeading ? "h1" : "h2";
      const headline = splitHeadline(text(block.heading, "Welcome"));
      /*
       * The scrim lives in CSS only. It used to be set here AND in `.hero::after`
       * with the same 0.82 gradient, so it compounded to ~0.97 and buried the
       * brand's own photography.
       */
      return <section className="hero" style={isSafeHref(block.media_url) ? { backgroundImage: `url(${JSON.stringify(block.media_url).slice(1, -1)})` } : undefined}>{isSafeHref(block.video_url) && isSafeHref(block.media_url) ? <HeroVideo src={text(block.video_url)} poster={text(block.media_url)} /> : null}<div>{pill}<Heading>{headline.lead}{headline.accent ? <>{" "}<span className="accent-line">{headline.accent}</span></> : null}</Heading>{block.subheading ? <p>{text(block.subheading)}</p> : null}<div className="hero-actions">{items(block.ctas).slice(0, 2).map((cta, index) => <SafeLink key={index} href={cta.href} context={context} className={index ? "button ghost" : "button accent"}>{text(cta.label, "Learn more")}</SafeLink>)}</div></div>{facts}{primaryHeading ? <span className="hero-scroll" aria-hidden="true">Scroll</span> : null}</section>;
    }
    case "rich_text": return <section className="prose editorial-prose"><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading)}</h2>{items(block.paragraphs).map((paragraph, index) => <p key={index}>{text(paragraph.text)}</p>)}</section>;
    /*
     * #3149 wave 4 -- the STORY section, as one composite.
     *
     * The reference pairs the prose with a circular crop carrying a badge, the
     * quotation inline rather than banished to its own band, and a button
     * onward. Ours printed the writing and the quotation as two unrelated
     * sections with no picture at all, which is why the top of the home page
     * read as a document rather than as a page.
     *
     * Every added element is printed ONLY when the brand supplied it, and with
     * none of them supplied this emits byte-for-byte what it emitted before.
     */
    case "media_feature": {
      const badge = text(block.badge_figure).trim();
      const quote = text(block.quote).trim();
      const featureCta = ctaOf(block.cta_label, block.cta_href);
      const circular = text(block.media_shape) === "circle";
      return <section className="feature editorial-feature"><div className={circular ? "editorial-media editorial-media-circle" : "editorial-media"}>{isSafeHref(block.media_url) ? <img src={text(block.media_url)} alt={text(block.alt)} width={960} height={720} /> : null}{badge ? <span className="media-badge"><strong>{badge}</strong>{block.badge_label ? <span>{text(block.badge_label)}</span> : null}</span> : null}</div><div><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading)}</h2><p>{text(block.caption)}</p>{quote ? <figure className="pull-quote feature-quote"><blockquote><p>{quote}</p></blockquote>{block.quote_attribution ? <figcaption>{text(block.quote_attribution)}</figcaption> : null}</figure> : null}{featureCta ? <SafeLink href={featureCta.href} context={context} className="button ghost feature-cta">{featureCta.label}</SafeLink> : null}</div></section>;
    }
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
    /*
     * #3149 wave 4 -- A TASTE OF THE MENU, AND IT IS THE REAL MENU.
     *
     * The home page used to carry four photographs of food and no prices at
     * all, under a heading that promised "what people order". The reference
     * carries real sections with real prices beside the photographs, and a
     * button to the rest.
     *
     * This block is the ONLY thing that could honestly do that, because it
     * is the one that already receives Mingla's own menu at publish time.
     * Nothing is retyped: the sections are Mingla's rows, in Mingla's order,
     * with two of them shown and the rest a click away. The cart is
     * deliberately absent even where the site is orderable -- a preview that
     * could take an order would be a second, shorter checkout on a page that
     * is not the menu.
     */
    case "menu_preview": {
      const sections = items(block.sections);
      const sectionCap = typeof block.section_limit === "number"
        ? block.section_limit
        : sections.length;
      const itemCap = typeof block.item_limit === "number"
        ? block.item_limit
        : null;
      const photos = items(block.images)
        .filter((image) => isSafeHref(image.url))
        .slice(0, 4);
      const previewCta = ctaOf(block.cta_label, block.cta_href);
      return <section className="menu-board menu-preview"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Menu")} /><h2>{text(block.heading, "Menu")}</h2>{block.note ? <p className="menu-note">{text(block.note)}</p> : null}<div className="menu-preview-split"><div className="menu-preview-list">{sections.slice(0, sectionCap).map((section, sectionIndex) => <div className="menu-section" key={`${text(section.name)}-${sectionIndex}`}><h3>{text(section.name)}</h3>{section.description ? <p className="menu-section-note">{text(section.description)}</p> : null}<ul className="menu-list">{(itemCap === null ? items(section.items) : items(section.items).slice(0, itemCap)).map((item, itemIndex) => { const price = formatMenuPrice(item.price_minor, item.currency); return <li className="menu-row" key={`${text(item.name)}-${itemIndex}`}><div className="menu-row-head"><span className="menu-item-name">{text(item.name)}</span><span className="menu-leader" aria-hidden="true" />{price ? <span className="menu-price">{price}</span> : null}</div>{item.description ? <p className="menu-item-note">{text(item.description)}</p> : null}</li>; })}</ul></div>)}{previewCta ? <SafeLink href={previewCta.href} context={context} ctaKind="menu" className="button accent menu-preview-cta">{previewCta.label}</SafeLink> : null}</div>{photos.length ? <div className="menu-preview-photos">{photos.map((photo, index) => <img key={`${text(photo.url)}-${index}`} src={text(photo.url)} alt={text(photo.alt)} width={640} height={640} loading="lazy" />)}</div> : null}</div></section>;
    }
    /*
     * #3149 wave 4 -- ONE film runs FULL BLEED WITH ITS WORDS OVER IT.
     *
     * The reference's single film is the width of the page with the play
     * control, the eyebrow, the heading and the line under it printed on top
     * of the footage. Ours stacked a heading, then a caption, then a portrait
     * card underneath -- three separate things where theirs is one.
     *
     * The copy is emitted AFTER the film so it stacks above it in the same
     * grid cell, and it is `pointer-events: none` in the stylesheet, which
     * makes the whole frame the play control rather than only the round button
     * in the middle of it.
     */
    case "video_feature":
      return <section className="video-feature"><ReelVideo src={text(block.video_url)} poster={text(block.poster_url)} label={text(block.heading, "Video")} /><div className="video-feature-copy"><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading)}</h2>{block.caption ? <p className="video-caption">{text(block.caption)}</p> : null}</div></section>;
    /*
     * #3149 wave 4 -- the role ABOVE the name, and a way to show some of them.
     *
     * `role` has been in the contract since #2830 and nothing ever set it, so
     * ten people appeared as ten nicknames with no idea who did what. The
     * reference prints the role first, in gold, over the name -- and shows
     * five of ten with a button to the rest, because a wall of ten portraits
     * is the whole page.
     *
     * No `preview_count` means every member, which is what this always did.
     */
    case "team": {
      const members = items(block.members);
      const shown = typeof block.preview_count === "number"
        ? members.slice(0, block.preview_count)
        : members;
      const teamCta = ctaOf(block.cta_label, block.cta_href);
      return <section className="team"><Eyebrow label={block.eyebrow} heading={block.heading} /><h2>{text(block.heading, "The team")}</h2>{block.caption ? <p>{text(block.caption)}</p> : null}<ul className="team-grid">{shown.map((member, index) => <li key={`${text(member.name)}-${index}`}>{isSafeHref(member.media_url) ? <img src={text(member.media_url)} alt={text(member.alt)} width={480} height={480} loading="lazy" /> : <span className="team-initial" aria-hidden="true">{text(member.name).slice(0, 1)}</span>}{member.role ? <span className="team-role">{text(member.role)}</span> : null}<strong>{text(member.name)}</strong></li>)}</ul>{teamCta ? <SafeLink href={teamCta.href} context={context} className="button ghost team-cta">{teamCta.label}</SafeLink> : null}</section>;
    }
    /*
     * #3149 -- every photograph opens larger, as every one of theirs does.
     *
     * The grid moved into `GalleryLightbox` whole rather than gaining a
     * wrapper around it: the anchor has to BE the grid item, or `.gallery`'s
     * tall first cell lands on an element that is no longer laid out by the
     * grid and the mosaic collapses. The class names are unchanged, so the
     * strip/mosaic decision above still reaches the same CSS.
     */
    case "gallery": {
      const galleryImages = items(block.images).slice(0, 12)
        .filter((image) => isSafeHref(image.url))
        .map((image) => ({ url: text(image.url), alt: text(image.alt) }));
      return <section className="editorial-gallery"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Gallery")} /><h2>{text(block.heading, "Gallery")}</h2><GalleryLightbox images={galleryImages} className={galleryImages.length <= 4 ? "gallery gallery-strip" : "gallery"} /></section>;
    }
    /*
     * #3149 wave 4 -- "Now 22:05 in Lagos" under the opening hours, which is
     * exactly where the reference prints it and exactly what it says.
     *
     * Printed ONLY when the block declares `always_open` AND names a
     * timezone. Nothing is read out of the hours strings above it: they are a
     * brand's own words about their week and there is no clock in them.
     */
    case "hours_location": {
      const zone = liveClockZone(block);
      return <section className="feature"><div><Eyebrow label={block.eyebrow} heading={text(block.heading, "Hours & location")} /><h2>{text(block.heading, "Hours & location")}</h2><p>{text(block.address)}</p><SafeLink href={block.map_url}>Open map</SafeLink></div><div className="hours">{items(block.hours).map((row, index) => <p key={index}><strong>{text(row.day)}</strong><span>{text(row.value)}</span></p>)}{zone ? <p className="hours-live"><LocalNowLine timezone={zone} /></p> : null}</div></section>;
    }
    case "testimonials": return <section><Eyebrow label={block.eyebrow} heading={text(block.heading, "What guests say")} /><h2>{text(block.heading, "What guests say")}</h2><div className="grid">{items(block.items).slice(0, 8).map((item, index) => <blockquote className="tile" key={index}>“{text(item.quote)}”<footer>{text(item.name)}</footer></blockquote>)}</div></section>;
    case "faq": return <section><Eyebrow label={block.eyebrow} heading={text(block.heading, "Questions")} /><h2>{text(block.heading, "Questions")}</h2>{items(block.items).slice(0, 12).map((item, index) => <details key={index}><summary>{text(item.question)}</summary><p>{text(item.answer)}</p></details>)}</section>;
    case "contact_handoff": return <section className="cta"><Eyebrow label={block.eyebrow} heading={text(block.heading, "Get in touch")} /><h2>{text(block.heading, "Get in touch")}</h2><p>{text(block.body)}</p><SafeLink href={block.href} context={context} ctaKind="contact" className="button accent">{text(block.label, "Contact")}</SafeLink></section>;
    /*
     * #3149 -- the ticker under the hero.
     *
     * The phrases are printed TWICE and the track is translated by half its
     * width, which is what makes the loop seamless; a single run would snap
     * back to the start in front of the reader. The second run is
     * `aria-hidden`, so a screen reader hears each phrase once, and the
     * stylesheet drops it entirely under `prefers-reduced-motion`, where the
     * strip is a static line rather than an animation that never ends.
     */
    case "marquee": {
      const phrases = items(block.phrases).map((phrase) => text(phrase.text)).filter(Boolean);
      if (phrases.length < 2) return null;
      const run = (hidden: boolean) => <span className="marquee-run" aria-hidden={hidden ? "true" : undefined}>{phrases.map((phrase, index) => <span className="marquee-phrase" key={index}>{phrase}</span>)}</span>;
      return <div className="marquee"><div className="marquee-track">{run(false)}{run(true)}</div></div>;
    }
    /*
     * #3149 -- figures with a line under each. A description list, because
     * that is what a figure and its label are; the fact rail already uses the
     * same pairing for the same reason.
     */
    case "stats": {
      const rows = items(block.items);
      if (!rows.length) return null;
      const heading = text(block.heading).trim();
      /*
       * #3149 wave 4 -- a card now carries a DRAWING and a SENTENCE, and one
       * of them can be the one being pointed at.
       *
       * The icon is a name from a closed list drawn by this app (see
       * `StatIcon`), never markup and never a URL: the reference pulls its
       * four glyphs out of a third-party icon font, and a published site here
       * makes no third-party request at all.
       *
       * `highlight` adds a class and nothing else -- the gold ring is the
       * stylesheet's business, so a brand cannot style its own page.
       */
      return <section className="stats"><Eyebrow label={block.eyebrow} heading={heading} />{heading ? <h2>{heading}</h2> : null}{block.body ? <p className="stats-lead">{text(block.body)}</p> : null}<dl className="stats-row">{rows.map((row, index) => <div key={index} className={row.highlight === true ? "stat-highlight" : undefined}>{isStatsIcon(row.icon) ? <StatIcon name={row.icon} /> : null}<dt>{text(row.figure)}</dt>{row.label ? <dd>{text(row.label)}</dd> : null}{row.body ? <dd className="stat-body">{text(row.body)}</dd> : null}</div>)}</dl></section>;
    }
    /*
     * #3149 -- a line lifted out of the prose, against a gold bar. `figure`
     * with a `figcaption` rather than a `<cite>` inside the quotation: the
     * attribution names WHO SAID IT, and a cite element is for the title of a
     * work, which this never is.
     */
    case "pull_quote": {
      const quote = text(block.quote).trim();
      if (!quote) return null;
      return <figure className="pull-quote"><blockquote><p>{quote}</p></blockquote>{block.attribution ? <figcaption>{text(block.attribution)}</figcaption> : null}</figure>;
    }
    /*
     * #3149 -- the map. NOTHING is requested from OpenStreetMap until a
     * visitor presses the control inside `MapEmbed`; see the note there. The
     * heading and the words around it are the brand's, and the coordinates are
     * the contract's -- there is no address handed to anyone to resolve.
     */
    case "map_embed": {
      const heading = text(block.heading).trim();
      return <section className="map-embed"><Eyebrow label={block.eyebrow} heading={heading} />{heading ? <h2>{heading}</h2> : null}{block.body ? <p className="map-body">{text(block.body)}</p> : null}<MapEmbed latitude={coordinate(block.latitude)} longitude={coordinate(block.longitude)} label={text(block.place_label)} />{isSafeHref(block.directions_url) ? <SafeLink href={block.directions_url} className="button ghost map-directions">Directions</SafeLink> : null}</section>;
    }
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

/*
 * #3149 wave 4 -- and ONE button under the grid, read off the same first film
 * for the same reason: the button belongs to the run, not to any one reel, and
 * four films each carrying "Follow @gogilagos" would print it four times.
 *
 * No label or no destination means no button, and the grid is exactly what it
 * was.
 */
function reelGridCta(first: RestaurantBlock): React.ReactNode {
  const cta = ctaOf(first.group_cta_label, first.group_cta_href);
  if (!cta) return null;
  return <div className="reel-grid-cta"><SafeLink href={cta.href} className="button ghost">{cta.label}</SafeLink></div>;
}

/*
 * #3149 wave 4 -- THE FOOTER'S MENU COLUMN, DERIVED FROM MINGLA.
 *
 * The reference lists its courses in the footer: Rice Bowls, Flat Burgers,
 * Shawarmas, Cocktails. Those are not words to type here -- they are what the
 * restaurant currently sells, and Mingla owns that. So they are read off the
 * menu blocks the artifact already carries, which came from Mingla's own
 * projection at publish time.
 *
 * The displayed name is the SUB-NAME. Mingla's sections carry their course as
 * a prefix -- "FOOD - Rice Bowls" -- and a footer column reading
 * "FOOD - Rice Bowls" looks like a database row rather than something to eat.
 * Duplicates collapse: home's taster and the menu page's board project the
 * same sections, so a naive list would print every course twice.
 *
 * A site whose menu Mingla has nothing for gets NO column at all rather than
 * an empty heading.
 */
const FOOTER_MENU_LIMIT = 6;

function footerMenuLinks(
  artifact: RestaurantArtifact,
  menuHref: string | null,
): { label: string; href: string }[] {
  if (!menuHref) return [];
  const seen = new Map<string, string>();
  for (const page of artifact.pages) {
    if (page.enabled !== true) continue;
    for (const block of page.blocks ?? []) {
      if (block.type !== "menu_board" && block.type !== "menu_preview") continue;
      for (const section of items(block.sections)) {
        const name = menuSubNameOf(text(section.name)).trim();
        if (!name) continue;
        const slug = menuSectionSlug(name);
        if (!slug || seen.has(slug)) continue;
        seen.set(slug, name);
      }
    }
  }
  return [...seen.entries()]
    .slice(0, FOOTER_MENU_LIMIT)
    .map(([slug, label]) => ({ label, href: `${menuHref}#${slug}` }));
}

/*
 * #3149 wave 4 -- MINGLA'S OWN CREDIT, and the one line in this footer that is
 * not the brand's.
 *
 * It is written here rather than carried in the artifact on purpose: it
 * belongs to every published site, it is not a brand's to edit or remove, and
 * a field for it would be a field a brand could put anything into. The
 * reference's own footer credits its builder in this spot; that is THEIR
 * credit and is not copied.
 */
const MINGLA_CREDIT_HREF = "https://usemingla.com/host";

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
  /*
   * #3149 wave 4 -- still `menu_board` ONLY. A home page's menu taster is a
   * `menu_preview`, which is a different block type and deliberately carries
   * no venue: it cannot be mistaken for the page that sells, so the header's
   * bag and its "Order now" keep pointing at the real menu rather than at the
   * page you are already on.
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
  /*
   * #3149 wave 4 -- the live pill, over the hero and in the inner-page band,
   * exactly where the reference carries it.
   *
   * The zone is read from THIS page's hours block, falling back to the home
   * page's, because "this venue never closes and it is 22:03 there" is a fact
   * about the site rather than about the page you happen to be on. Falling
   * back to home is what puts it on the Gallery and About pages, as theirs
   * does. A site whose home page declares neither field gets no pill anywhere.
   */
  const siteHours = hoursLocation ??
    firstBlock(homePage(artifact)?.blocks ?? [], "hours_location");
  const liveZone = liveClockZone(siteHours);
  const openPill = liveZone ? <OpenNowPill timezone={liveZone} /> : null;
  /*
   * #3149 wave 4 -- the footer the reference has, in four columns.
   *
   * Every string in it is the brand's own content or Mingla's own data, and
   * the ONE exception says so in its own comment: the credit at the bottom is
   * Mingla's chrome and renders for every site.
   *
   *   1. The wordmark if one was uploaded, the brand's own short description,
   *      and a round button per contact link -- the drawing chosen by where
   *      the link GOES, so a brand that publishes no WhatsApp number gets no
   *      WhatsApp button rather than an invented one.
   *   2. The site's own navigation.
   *   3. The courses Mingla says this restaurant currently sells.
   *   4. The address, the phone and the hours, all from the footer contract.
   *
   * A column whose content the brand has not supplied is not printed. An empty
   * heading over nothing is worse than three columns.
   */
  const menuHref = orderablePage ? hrefForPage(orderablePage as ArtifactPage) : null;
  const menuLinks = footerMenuLinks(artifact, menuHref);
  const contactLinks = (artifact.footer.links ?? []).filter((link) =>
    isSafeHref(link.href)
  );
  const iconLinks = contactLinks
    .map((link) => ({ link, icon: socialIconFor(String(link.href)) }))
    .filter((row): row is { link: typeof row.link; icon: NonNullable<typeof row.icon> } =>
      row.icon !== null
    );
  const phoneLink = contactLinks.find((link) => String(link.href).startsWith("tel:"));
  const logo = artifact.site_settings.logo;
  /*
   * #3149 wave 5 — THE WORDMARK, WHICH WAS BUILT AND NEVER CALLED.
   *
   * Studio has had a `logo` field since #2830, the builder projects it, and the
   * public contract validates it against the media manifest — and the header
   * typeset `display_name` regardless, so a brand that uploaded its wordmark saw
   * its name set in Oswald instead. The footer was already reading it; only this
   * one call site was missing. That is the "built but never called" shape this
   * repo keeps hitting, so the test asserts the rendered OUTPUT.
   *
   * `isSafeHref` is the same gate the footer applies. NO LOGO MEANS NO CHANGE:
   * a site without one, or with one whose URL does not pass, renders exactly the
   * text it renders today rather than an empty box where a name used to be.
   */
  const brandWordmark = logo && isSafeHref(logo.url)
    ? <img
        src={logo.url}
        alt={artifact.site_settings.display_name}
        width={logo.width}
        height={logo.height}
        className="brand-wordmark"
      />
    : null;
  const footerColumns = <div className="footer-columns"><div className="footer-brand">{logo && isSafeHref(logo.url) ? <img src={logo.url} alt={artifact.site_settings.display_name} width={logo.width} height={logo.height} className="footer-wordmark" /> : <strong>{artifact.site_settings.display_name}</strong>}{artifact.site_settings.short_description ? <p>{artifact.site_settings.short_description}</p> : null}{iconLinks.length ? <ul className="footer-social">{iconLinks.map(({ link, icon }) => <li key={String(link.href)}><SafeLink href={link.href} className="social-button"><SocialGlyph name={icon} /><span className="sr-only">{link.label}</span></SafeLink></li>)}</ul> : null}</div><div><h2>Site</h2><nav aria-label="Footer navigation">{navPages.map((navPage) => <Link key={navPage.role} href={hrefForPage(navPage)}>{navPage.nav_label}</Link>)}</nav></div>{menuLinks.length ? <div><h2>Menu</h2><nav aria-label="Menu sections">{menuLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav></div> : null}<div className="footer-find"><h2>Find us</h2>{artifact.footer.address ? <p>{artifact.footer.address}</p> : null}{phoneLink ? <p><SafeLink href={phoneLink.href}>{phoneLink.label}</SafeLink></p> : null}{artifact.footer.hours_summary ? <p className="footer-hours">{artifact.footer.hours_summary}</p> : null}</div></div>;
  const factRail = <aside className="fact-rail" aria-label="Restaurant facts"><dl><div><dt>Visit</dt><dd>{address || "See restaurant details"}</dd></div><div><dt>Hours</dt><dd>{hours ? `${text(hours.day)} ${text(hours.value)}` : "See current opening hours"}</dd></div><div><dt>Contact</dt><dd>{contactLink && isSafeHref(contactLink.href) ? <SafeLink href={contactLink.href} context={context} ctaKind="contact">{contactLink.label}</SafeLink> : "Contact the restaurant"}</dd></div></dl></aside>;
  return <CartScope siteId={artifact.site_id}><SiteTheme artifact={artifact} /><SiteRuntimeClient context={context} /><RevealOnScroll /><HeaderScrollState /><a className="skip" href="#main">Skip to content</a><header className="site-header"><Link href="/" className="brand" aria-label={brandWordmark ? `${artifact.site_settings.display_name} home` : undefined}>{brandWordmark ?? artifact.site_settings.display_name}</Link><SiteNav links={navPages.map((navPage) => ({ role: navPage.role, label: String(navPage.nav_label ?? ""), href: hrefForPage(navPage), current: navPage.role === current.role }))} />{orderablePage ? <HeaderCart menuHref={hrefForPage(orderablePage as ArtifactPage)} onMenuPage={orderablePage.role === current.role} /> : null}{headerAction ? <SafeLink href={headerAction.href} context={context} ctaKind={headerAction.kind} className="header-action accent">{headerAction.label}</SafeLink> : null}</header><main id="main" className={contentStartsUnderHeader ? "header-offset" : undefined}>{primaryHeroIndex < 0 ? <header className="page-header" style={isSafeHref(pageBackdrop) ? { backgroundImage: `url(${JSON.stringify(pageBackdrop).slice(1, -1)})` } : undefined}><div>{openPill}<h1>{current.title}</h1><nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">{current.title}</span></nav></div></header> : null}<div className="page-content">{groupReels(current.blocks).map((group, groupIndex) => group.kind === "reels" ? <section className="reel-grid" key={`reels-${groupIndex}`}>{reelGridHeading(group.reels[0]!.block)}<div className="reel-grid-films">{group.reels.map(({ block, index }) => <figure className="reel-card" key={`${block.type}-${index}`}><ReelVideo src={text(block.video_url)} poster={text(block.poster_url)} label={text(block.heading, "Film")} /><figcaption>{text(block.heading)}</figcaption></figure>)}</div>{reelGridCta(group.reels[0]!.block)}</section> : <Fragment key={`${group.block.type}-${group.index}`}><Block block={group.block} context={context} primaryHeading={group.index === primaryHeroIndex} facts={isHome && group.index === primaryHeroIndex ? factRail : undefined} pill={group.index === primaryHeroIndex ? openPill : undefined} /></Fragment>)}</div></main><footer className="footer">{footerColumns}<div className="footer-bar"><p>{artifact.footer.legal_text}</p><a href={MINGLA_CREDIT_HREF} target="_blank" rel="noopener noreferrer" className="footer-credit">Powered by Mingla<span className="sr-only"> (opens in a new tab)</span></a></div><ConsentControl siteId={artifact.site_id} brandId={artifact.brand_id} publicationId={artifact.publication_id} /></footer></CartScope>;
}
