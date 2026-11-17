import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import { isCanonicalMinglaHref, isMinglaActionHref } from "../../../contracts/generated/safety.ts";
import type { SiteEventContext } from "../../../lib/clientAnalytics";
import type { OfferingCard } from "../../../lib/offeringCards";
import type { OfferingDetailView } from "../../../lib/offeringDetail";
import { isPreviewPublication } from "../../../lib/previewPublication";
import { HandoffLink, MinglaHandoff, StickyBookingBar } from "../chrome/Handoff";
import { Arrow, Go, MinglaNote } from "../parts";

/*
 * #4453 milestone 9 (spec v2.1 §1.2) — the offering detail template every
 * design draws: crumbs, the cover and the offering's own photos, the summary,
 * a trip's day-by-day and what is included, a room's facts, then the booking
 * card (a sticky aside on desktop, inline on phones) with ONE Mingla action,
 * "Other {noun}s" and the reviews about this offering when there are any.
 *
 * Every word comes from Mingla's records (the feed row and Core's detail
 * read); owners and Ari type nothing here. The booking action is the feed
 * row's `public_url`, through the hand-off sheet, and only when it passes the
 * booking lock (I-SITES-DETAIL-BOOKS-ON-MINGLA). A design styles the template
 * through the shared role variables (public/designs/_shared/detail-1.css);
 * each design's tokens give it its own face.
 */

const PLURAL: Readonly<Record<string, string>> = { trip: "trips", event: "events", session: "sessions", room: "rooms" };

function priceParts(card: OfferingCard): { from: boolean; amount: string } | null {
  if (!card.state.bookable || !card.price) return null;
  return card.price.startsWith("From ") ? { from: true, amount: card.price.slice(5) } : { from: false, amount: card.price };
}

/** The live status line: places left when few, else the card's badge. */
function statusLine(detail: OfferingDetailView): string | null {
  const { card, offering } = detail;
  if (card.state.badge) return card.state.badge;
  if (card.state.bookable && typeof offering.spots_left === "number" && offering.spots_left > 0 && offering.spots_left <= 10) {
    return `${offering.spots_left} ${offering.spots_left === 1 ? "place" : "places"} left`;
  }
  return null;
}

function facts(detail: OfferingDetailView): Array<[string, string]> {
  const { card, offering, extras } = detail;
  const out: Array<[string, string]> = [];
  if (card.dates) out.push(["When", card.dates]);
  if (offering.destination_text) out.push([offering.kind === "stay" ? "Where" : offering.kind === "trip" ? "Where" : "Venue", offering.destination_text]);
  if (extras?.days.length) out.push(["Length", `${extras.days.length} ${extras.days.length === 1 ? "day" : "days"}`]);
  if (offering.group_minimum && offering.group_minimum > 1) out.push(["Group", `From ${offering.group_minimum} people`]);
  if (extras?.stay) out.push(["Sleeps", `Up to ${extras.stay.max_guests}`]);
  if (offering.installments_available && card.state.bookable) out.push(["Payment", "Pay in instalments on Mingla"]);
  return out;
}

/** The one Mingla action: Book, or Join the waitlist; otherwise null (the status stands in its place). */
export function detailAction(detail: OfferingDetailView): { href: string; label: string } | null {
  const { card, offering } = detail;
  const href = offering.public_url;
  if (!isCanonicalMinglaHref(href) || !isMinglaActionHref(href, null, "booking")) return null;
  if (card.state.bookable) return { href, label: offering.kind === "stay" ? "Book this room" : `Book this ${detail.noun}` };
  if (card.cta === "Join the waitlist") return { href, label: "Join the waitlist" };
  return null;
}

function OtherCard({ card }: { card: OfferingCard }) {
  const price = card.state.bookable ? card.price : null;
  const target = card.detailHref ?? card.href;
  return (
    <article className="mg-dtl-other" data-offering-kind={card.kind}>
      <a className="mg-dtl-other__ph" href={target} tabIndex={-1} aria-hidden="true">
        {card.coverUrl ? <img src={card.coverUrl} srcSet={card.coverSrcSet ?? undefined} sizes={card.coverSrcSet ? "(min-width: 900px) 33vw, 100vw" : undefined} alt="" loading="lazy" decoding="async" /> : null}
      </a>
      <div className="mg-dtl-other__b">
        {card.dates ? <p className="mg-dtl-other__when">{card.dates}</p> : null}
        <h3><a className="mg-to-detail" href={target}>{card.title}</a></h3>
        <div className="mg-dtl-other__row">
          {price ? <p className="mg-price">{price}</p> : <span />}
          <HandoffLink className="mg-btn mg-btn--small" detail={{ href: card.href, item: card.title, ...(price ? { from: price } : {}), ctaKind: "offering" }}>
            <span>{card.cta}</span><Arrow /><span className="mg-sr">{`: ${card.title} on Mingla`}</span>
          </HandoffLink>
        </div>
      </div>
    </article>
  );
}

function Others({ detail, heading }: { detail: OfferingDetailView; heading: string }) {
  if (!detail.others.length) return null;
  return (
    <section className="mg-blk mg-dtl-more" aria-labelledby="mg-dtl-more">
      <div className="mg-wrap">
        <h2 id="mg-dtl-more" className="mg-dtl-h">{heading}</h2>
        <div className={`mg-dtl-others mg-dtl-others--c${detail.others.length}`}>
          {detail.others.map((card) => <OtherCard key={card.id} card={card} />)}
        </div>
      </div>
    </section>
  );
}

function Reviews({ artifact, detail }: { artifact: ArtifactV2; detail: OfferingDetailView }) {
  const id = detail.offering.id.toLowerCase();
  const reviews = artifact.collections.testimonials.filter((row) => row.related_offering_id?.toLowerCase() === id).slice(0, 3);
  if (!reviews.length) return null;
  return (
    <section className="mg-blk mg-dtl-reviews" aria-labelledby="mg-dtl-reviews">
      <div className="mg-wrap">
        <h2 id="mg-dtl-reviews" className="mg-dtl-h">What people said</h2>
        <ul className="mg-dtl-quotes">
          {reviews.map((review) => (
            <li key={review.id}>
              <blockquote>{"“"}{review.quote}{"”"}</blockquote>
              <p className="mg-dtl-quotes__who">{review.reviewer}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Crumbs({ detail }: { detail: OfferingDetailView }) {
  return (
    <nav className="mg-dtl-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><Go href="/">Home</Go></li>
        {detail.parent.href !== "/" ? <li><Go href={detail.parent.href}>{detail.parent.label}</Go></li> : null}
        <li><span aria-current="page">{detail.offering.title}</span></li>
      </ol>
    </nav>
  );
}

/** The whole detail page between the header and the footer, for any design. */
export function OfferingDetailTemplate({ artifact, detail, analytics, designKey }: { artifact: ArtifactV2; detail: OfferingDetailView; analytics: SiteEventContext; designKey: string }) {
  const { card, offering, extras } = detail;
  const plural = PLURAL[detail.noun] ?? `${detail.noun}s`;
  const preview = isPreviewPublication(analytics.publicationId);
  if (detail.ended) {
    return (
      <>
        <section className="mg-dtl mg-dtl--ended" data-mg-detail={designKey} aria-labelledby="mg-dtl-title">
          <div className="mg-wrap">
            <Crumbs detail={detail} />
            <p className="mg-label">{detail.noun}</p>
            <h1 id="mg-dtl-title" className="mg-dtl-title">{offering.title}</h1>
            <p className="mg-dtl-lede">{`This ${detail.noun} has ended.`}</p>
            <Go className="mg-dtl-back" href={detail.parent.href}><Arrow /><span>{`Back to ${detail.parent.label}`}</span></Go>
          </div>
        </section>
        <Others detail={detail} heading={`Upcoming ${plural}`} />
        <MinglaHandoff context={analytics} preview={preview} />
      </>
    );
  }
  const price = priceParts(card);
  const status = statusLine(detail);
  const action = detailAction(detail);
  const rows = facts(detail);
  const thumbs = detail.photos.slice(0, 3);
  const more = detail.photos.slice(3);
  const label = [detail.noun, offering.destination_text, card.dates].filter(Boolean).join(" · ");
  return (
    <>
      <section className="mg-dtl" data-mg-detail={designKey} data-offering-kind={offering.kind} aria-labelledby="mg-dtl-title">
        <div className="mg-wrap">
          <Crumbs detail={detail} />
          {card.coverUrl || thumbs.length ? (
            <div className={`mg-dtl-hero${thumbs.length ? " mg-dtl-hero--thumbs" : ""}`}>
              <div className="mg-dtl-media">
                {card.coverUrl
                  ? <img src={card.coverUrl} srcSet={card.coverSrcSet ?? undefined} sizes={card.coverSrcSet ? "(min-width: 1320px) 900px, 100vw" : undefined} alt="" fetchPriority="high" decoding="async" />
                  : <img src={thumbs[0]!.src} alt={thumbs[0]!.alt} decoding="async" />}
              </div>
              {thumbs.length ? (
                <div className="mg-dtl-thumbs">
                  {thumbs.map((photo) => <div key={photo.src} className="mg-dtl-thumb"><img src={photo.src} alt={photo.alt} loading="lazy" decoding="async" /></div>)}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mg-dtl-grid">
            <div className="mg-dtl-main">
              <p className="mg-label">{label}</p>
              <h1 id="mg-dtl-title" className="mg-dtl-title">{offering.title}</h1>
              {offering.summary ? <p className="mg-dtl-lede">{offering.summary}</p> : null}
              {extras?.days.length ? (
                <>
                  <h2 className="mg-dtl-h">Day by day</h2>
                  <ol className="mg-dtl-plan">
                    {extras.days.map((day) => (
                      <li key={day.day}>
                        <span className="mg-dtl-plan__t">{`Day ${day.day}`}</span>
                        <div><p className="mg-dtl-plan__h">{day.title}</p>{day.summary ? <p>{day.summary}</p> : null}</div>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              {extras?.included.length ? (
                <>
                  <h2 className="mg-dtl-h">{"What’s included"}</h2>
                  <ul className="mg-dtl-incl">{extras.included.map((item) => <li key={item}>{item}</li>)}</ul>
                </>
              ) : null}
              {extras?.stay ? (
                <>
                  <h2 className="mg-dtl-h">{extras.stay.kind === "room" ? "The room" : "The place"}</h2>
                  <ul className="mg-dtl-incl">
                    <li>{`Sleeps up to ${extras.stay.max_guests}`}{extras.stay.max_adults !== null ? ` (${extras.stay.max_adults} ${extras.stay.max_adults === 1 ? "adult" : "adults"}${extras.stay.max_children ? `, ${extras.stay.max_children} ${extras.stay.max_children === 1 ? "child" : "children"}` : ""})` : ""}</li>
                    {extras.stay.amenities.map((item) => <li key={`a-${item}`}>{item}</li>)}
                  </ul>
                  {extras.stay.accessibility.length ? (
                    <>
                      <h2 className="mg-dtl-h">Access</h2>
                      <ul className="mg-dtl-incl">{extras.stay.accessibility.map((item) => <li key={`x-${item}`}>{item}</li>)}</ul>
                    </>
                  ) : null}
                </>
              ) : null}
              {more.length ? (
                <div className="mg-dtl-gallery">
                  {more.map((photo) => <div key={photo.src} className="mg-dtl-thumb"><img src={photo.src} alt={photo.alt} loading="lazy" decoding="async" /></div>)}
                </div>
              ) : null}
            </div>
            <aside className="mg-dtl-book" aria-label={`Book ${offering.title}`}>
              <div className="mg-dtl-card">
                {price ? (
                  <p className="mg-dtl-price">{price.from ? <small>From</small> : null}<span>{price.amount}</span></p>
                ) : null}
                {status ? <p className={`mg-dtl-status${card.state.bookable ? "" : " mg-dtl-status--out"}`}>{status}</p> : null}
                {rows.length ? (
                  <dl className="mg-dtl-facts">
                    {rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
                  </dl>
                ) : null}
                {action ? (
                  <HandoffLink className="mg-btn mg-btn--accent mg-dtl-cta" detail={{ href: action.href, item: offering.title, ...(card.dates ? { when: card.dates } : {}), ...(price ? { from: card.price ?? undefined } : {}), ctaKind: "offering" }}>
                    <span>{action.label}</span><Arrow />
                  </HandoffLink>
                ) : null}
                <MinglaNote>Booked and paid through Mingla</MinglaNote>
              </div>
              <Go className="mg-dtl-back" href={detail.parent.href}><Arrow /><span>{`Back to ${detail.parent.label}`}</span></Go>
            </aside>
          </div>
        </div>
      </section>
      <Others detail={detail} heading={`Other ${plural}`} />
      <Reviews artifact={artifact} detail={detail} />
      <MinglaHandoff context={analytics} preview={preview} />
      {action ? (
        <StickyBookingBar>
          <div className="mg-sticky__txt"><p className="mg-sticky__t">{offering.title}</p>{price ? <p className="mg-sticky__n">{card.price}</p> : null}</div>
          <HandoffLink className="mg-btn mg-btn--accent mg-sticky__go" detail={{ href: action.href, item: offering.title, ...(price ? { from: card.price ?? undefined } : {}), ctaKind: "offering" }}>
            <span>{offering.kind === "stay" ? "Book" : action.label.startsWith("Join") ? "Join" : "Book"}</span>
          </HandoffLink>
        </StickyBookingBar>
      ) : null}
    </>
  );
}
