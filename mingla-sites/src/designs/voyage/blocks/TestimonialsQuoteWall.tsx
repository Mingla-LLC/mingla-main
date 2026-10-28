import { formatCalendarDay, testimonialsNewestFirst, type SiteTestimonial } from "../../../contracts/generated/collections.ts";
import { isManuallyOrdered } from "../../../contracts/generated/artifactV2.ts";
import { Reveal } from "../Reveal";
import { HeadRow, rows, Section, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — testimonials `quote-wall`: confirmed reviews, newest first, as
 * cards that stretch to their row with the attribution pinned to the foot
 * (name, then the trip and the date). Printed exactly as stored: no
 * truncation, no stars, no portraits. Quotes typed into an older block are
 * drawn the same way, with the name only.
 *
 * #2829 W7c (A13.4): a review is attached to its Mingla trip in the data
 * (one source of truth), but the wall prints the trip's name as plain text,
 * never a link: the review's own trip name, else the attached trip's title.
 */
export function TestimonialsQuoteWall({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const { artifact, live } = ctx;
  const language = artifact.language;
  type Quote = { key: string; quote: string; reviewer: string; trip: string; date: string | null };
  let quotes: Quote[];
  if (block.from_collection === true) {
    const picked = rows(block.testimonial_ids).map((row) => text(row.id));
    const all = artifact.collections.testimonials;
    const limit = typeof block.limit === "number" ? block.limit : undefined;
    const shown: SiteTestimonial[] = (picked.length
      ? picked.map((reviewId) => all.find((row) => row.id === reviewId)).filter((row): row is SiteTestimonial => Boolean(row))
      : testimonialsNewestFirst(all, isManuallyOrdered(artifact, "testimonials"))).slice(0, limit);
    quotes = shown.map((review) => {
      const offering = review.related_offering_id ? live?.offerings.find((row) => row.id === review.related_offering_id) : undefined;
      return {
        key: review.id,
        quote: review.quote,
        reviewer: review.reviewer,
        trip: review.trip_name || offering?.title || "",
        date: review.review_date,
      };
    });
  } else {
    quotes = rows(block.items).slice(0, 8).map((item, itemIndex) => ({ key: String(itemIndex), quote: text(item.quote), reviewer: text(item.name), trip: "", date: null }));
  }
  if (!quotes.length) return null;
  return (
    <Section labelledBy={id}>
      <HeadRow id={id} heading={text(block.heading) || undefined} intro={text(block.intro)} link={{ label: text(block.cta_label), href: block.cta_href }} />
      <div className="quote-wall">
        {quotes.map((review, quoteIndex) => (
          <Reveal key={review.key} delay={quoteIndex}>
            <figure className="card card--raised quote">
              <span className="quote__mark" aria-hidden="true">&ldquo;</span>
              <blockquote className="quote__text"><p>{review.quote}</p></blockquote>
              <figcaption className="quote__who">
                <span className="quote__name">{review.reviewer}</span>
                <span className="quote__meta">
                  {review.trip ? <span>{review.trip}</span> : null}{" "}
                  {review.date ? <time dateTime={review.date} className="tnum">{formatCalendarDay(review.date, language)}</time> : null}
                </span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
