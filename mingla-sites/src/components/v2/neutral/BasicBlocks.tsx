/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { FEATURE_ICON_VIEWBOX, FEATURE_ICONS, isFeatureIconName } from "../../../contracts/generated/icons.ts";

/*
 * #2829 W7 (AD-4) — the design-neutral layouts of the travel designs' page
 * header, cards and contact tiles, for designs that do not draw them in a
 * way of their own (atelier). Plain structure, styled by the design's own
 * stylesheet from its tokens.
 */
type Block = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export function PageHeaderNeutral({ block }: { block: Block }) {
  return (
    <section className="site-page-header">
      {isSafeHref(block.media_url) ? <img className="site-page-header-image" src={String(block.media_url)} alt="" /> : null}
      <h1>{text(block.heading)}</h1>
      {text(block.subheading) ? <p className="site-intro">{text(block.subheading)}</p> : null}
    </section>
  );
}

export function FeatureCardsNeutral({ block }: { block: Block }) {
  return (
    <section className="site-collection site-feature-cards">
      {text(block.heading) ? <h2>{text(block.heading)}</h2> : null}
      {text(block.intro) ? <p className="site-intro">{text(block.intro)}</p> : null}
      <div className="grid">
        {rows(block.cards).map((card, index) => (
          <article className="tile" key={index}>
            {isFeatureIconName(card.icon) ? (
              <svg width="26" height="26" viewBox={FEATURE_ICON_VIEWBOX} fill="currentColor" aria-hidden="true"><path d={FEATURE_ICONS[card.icon]} /></svg>
            ) : null}
            <h3>{text(card.title)}</h3>
            <p>{text(card.body)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ContactDetailsNeutral({ block }: { block: Block }) {
  const email = text(block.email);
  const location = text(block.location);
  return (
    <section className="site-collection site-contact-details">
      {text(block.heading) ? <h2>{text(block.heading)}</h2> : null}
      {text(block.body) ? <p className="site-intro">{text(block.body)}</p> : null}
      <dl className="site-facts">
        {email ? <div><dt>Email</dt><dd><a href={`mailto:${email}`}>{email}</a></dd></div> : null}
        {location ? <div><dt>Location</dt><dd>{location}</dd></div> : null}
      </dl>
    </section>
  );
}
