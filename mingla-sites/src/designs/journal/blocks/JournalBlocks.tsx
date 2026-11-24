import { formatCalendarDay } from "../../../contracts/generated/collections.ts";
import { EMAIL_MAX } from "../../../contracts/generated/forms.ts";
import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { hiddenFields, noticeFor, previewNoteFor } from "../../../components/v2/neutral/FormBlocks";
import { SiteForm } from "../../../components/v2/neutral/SiteForm";
import { formAnchor } from "../../../lib/siteForms";
import { galleryImages, quotes, type Quote } from "../../shared/data";
import { ActionButton, Blk, HeadlineLines, Label, MinglaNote, Photo, SecHead, sectionId, text, type SharedBlockProps } from "../../shared/parts";
import { HeroButtons, TripSearch, heroParts } from "../../shared/blocks/Hero";
import { Book, Cover, GridShell, Price, State, CardTitle } from "../../shared/blocks/Offerings";
import { Lines } from "../../shared/Lines";

/*
 * #4453 6b — Journal's five signature layouts (spec §3.2), drawn from the
 * shared role variables and Journal's stylesheet only. Each draws every field
 * its block defines (the field-parity test covers them) and keeps every
 * booking a Mingla action. Class names are prefixed `jr-` so they never
 * collide with another design. Plate numbers, letter numbers and "Fig. 1"
 * are typographic furniture counted from the content, never invented facts.
 */

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;
const two = (value: number) => String(value).padStart(2, "0");

function who(quote: Quote, language: string): string {
  return [quote.reviewer, quote.context, quote.date ? formatCalendarDay(quote.date, language) : ""].filter(Boolean).join(" · ");
}

/**
 * hero:journal-front — the front page: the label over a ruled kicker row, the
 * headline full width, then a ruled two-column body: the picture as Fig. 1
 * with its alt as the caption, and the line under the headline set as the
 * lede with a drop cap, the buttons and the trip search.
 */
export function HeroJournalFront({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  const alt = p.picture ? ctx.artifact.media.find((media) => media.url === p.picture)?.alt ?? "" : "";
  return (
    <section className="mg-hero jr-front" aria-labelledby={id} data-mg-hero="">
      <div className="mg-wrap">
        {p.eyebrow ? <div className="jr-kick" data-mg-in=""><p className="mg-label">{p.eyebrow}</p></div> : null}
        <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
        <div className="jr-grid">
          {p.picture ? (
            <figure className="jr-fig">
              <div className="mg-ph" data-mg-hero-bg="">
                <Photo artifact={ctx.artifact} url={p.picture} hero sizes="(min-width: 1320px) 760px, (min-width: 900px) 60vw, 100vw" />
                {p.film ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
              </div>
              {alt ? <figcaption><b>Fig. 1</b><span>{alt}</span></figcaption> : null}
            </figure>
          ) : null}
          <div className="jr-copy">
            {p.subheading ? <p className="jr-lede" data-mg-in="">{p.subheading}</p> : null}
            <HeroButtons ctas={p.ctas} />
            {p.search ? <div className="jr-bk"><TripSearch action={p.search} id={id} /></div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** offering_grid:journal-columns — newspaper columns: a lead story, then ruled columns, each with its dateline, plate and headline. */
export function OfferingGridJournalColumns(props: SharedBlockProps) {
  return (
    <GridShell {...props} className="jr-offers">
      {(items) => (
        <div className="jr-cols" style={{ ["--jr-n" as string]: String(Math.max(1, Math.min(items.length - 1, 3))) }}>
          {items.map((item) => (
            <article key={item.card.id} className="jr-art" data-offering-kind={item.card.kind} data-mg-rise="">
              {item.card.destination || item.card.dates ? <p className="jr-dl">{[item.card.destination, item.card.dates].filter(Boolean).join(" · ")}</p> : null}
              <div className="mg-ph"><Cover item={item} sizes="(min-width: 1000px) 33vw, 100vw" /></div>
              <h3><CardTitle card={item.card} /></h3>
              {item.card.summary ? <p className="jr-blurb"><Lines text={item.card.summary} /></p> : null}
              <p className="jr-meta"><State item={item} /></p>
              <div className="jr-buy">
                <Price item={item} className="mg-price" />
                <Book item={item} ctx={props.ctx} className="mg-btn" />
              </div>
            </article>
          ))}
        </div>
      )}
    </GridShell>
  );
}

/** gallery:journal-essay — a photo essay: up to five numbered plates in a newspaper grid, each captioned with its alt text. */
export function GalleryJournalEssay({ block, index, ctx }: SharedBlockProps) {
  const images = galleryImages(block).slice(0, 5);
  if (!images.length) return null;
  const id = sectionId(block, index);
  return (
    <Blk className="jr-essay" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} />
      <div className={`jr-plates jr-plates--n${images.length}`}>
        {images.map((image, imageIndex) => (
          <figure key={imageIndex} className={`jr-plate jr-plate--${imageIndex}`} data-mg-rise="">
            <div className="mg-ph"><Photo artifact={ctx.artifact} url={image.url} alt={image.alt} sizes={imageIndex === 0 ? "(min-width: 900px) 60vw, 100vw" : "(min-width: 900px) 40vw, 100vw"} /></div>
            <figcaption><b>Plate {ROMAN[imageIndex]}</b>{/* #4453 M5 §5.2 — the owner's caption when written, else the picture description */}{image.caption ? <span>{image.caption}{image.sub ? <small className="mg-gal-cap__sub">{image.sub}</small> : null}</span> : image.alt ? <span>{image.alt}</span> : null}</figcaption>
          </figure>
        ))}
      </div>
    </Blk>
  );
}

/** testimonials:journal-letters — letters to the editor: the first review as a pull quote, the rest in ruled, numbered letter columns. */
export function TestimonialsJournalLetters({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const shown = quotes(block, ctx);
  if (!shown.length) return null;
  const [first, ...rest] = shown;
  const language = ctx.artifact.language;
  return (
    <Blk className="jr-letters" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} intro={text(block.intro)}
        extra={<ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" />} />
      <div className="jr-lt">
        <figure className="jr-pull" data-mg-rise="">
          <blockquote>{first!.quote}</blockquote>
          <figcaption className="jr-cite">{who(first!, language)}</figcaption>
        </figure>
        {rest.length ? (
          <ul className={`jr-lcols jr-lcols--${Math.min(rest.length, 3)}`}>
            {rest.map((quote, quoteIndex) => (
              <li key={quote.key} data-mg-rise="">
                <p className="jr-ln">Letter No. {two(quoteIndex + 2)}</p>
                <blockquote className="jr-lq">{quote.quote}</blockquote>
                <p className="jr-cite">{who(quote, language)}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Blk>
  );
}

/** newsletter_signup:journal-coupon — a dashed subscription coupon: the label, heading, line, the form and the small print. */
export function NewsletterJournalCoupon({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const forms = ctx.forms;
  if (!forms) return null;
  return (
    <section className="mg-blk jr-subs" aria-labelledby={id}>
      <div className="mg-wrap">
        <div className="jr-coupon" data-mg-rise="">
          <div className="jr-cbody">
            <Label>{text(block.eyebrow)}</Label>
            <h2 id={id}>{text(block.heading)}</h2>
            {text(block.body) ? <p className="jr-csub">{text(block.body)}</p> : null}
            <SiteForm
              skin="voyage"
              kind="newsletter"
              anchor={formAnchor(index)}
              action="/api/forms/newsletter"
              hidden={hiddenFields(forms, ctx.page.path, index)}
              fields={[{ name: "email", label: "Email", type: "email", required: true, autoComplete: "email", placeholder: text(block.placeholder) || "Email", maxLength: EMAIL_MAX }]}
              submitLabel={text(block.button_label) || "Join the list"}
              initialNotice={noticeFor(forms, index, "newsletter", ctx.artifact, block)}
              disabledReason={previewNoteFor(forms)}
            />
            {text(block.small_print) ? <p className="jr-csmall">{text(block.small_print)}</p> : null}
            <MinglaNote>Your place on the list is kept by Mingla.</MinglaNote>
          </div>
        </div>
      </div>
    </section>
  );
}

export const JOURNAL_SIGNATURE_BLOCKS = {
  hero: { "journal-front": HeroJournalFront },
  offering_grid: { "journal-columns": OfferingGridJournalColumns },
  gallery: { "journal-essay": GalleryJournalEssay },
  testimonials: { "journal-letters": TestimonialsJournalLetters },
  newsletter_signup: { "journal-coupon": NewsletterJournalCoupon },
} as const;
