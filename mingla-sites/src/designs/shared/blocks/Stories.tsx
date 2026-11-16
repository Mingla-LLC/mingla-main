import { formatCalendarDay } from "../../../contracts/generated/collections.ts";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { EMAIL_MAX } from "../../../contracts/generated/forms.ts";
import { SiteAnchor } from "../../../components/PreviewLinks";
import { hiddenFields, noticeFor, previewNoteFor } from "../../../components/v2/neutral/FormBlocks";
import { SiteForm } from "../../../components/v2/neutral/SiteForm";
import { formAnchor } from "../../../lib/siteForms";
import { history, quotes } from "../data";
import { RailControls, ReviewSwitcher } from "../interactive";
import { ActionButton, Blk, Label, MinglaNote, rows, SecHead, sectionId, text, type SharedBlockProps } from "../parts";

/*
 * #4453 §3.3 — shared layouts for the record, the reviews, the visit, the
 * questions and the list. Counts are COUNTED from Mingla's ended offerings,
 * never typed; reviews are the site's confirmed Testimonials or the quotes
 * typed into the block, printed exactly; no rating is shown (Mingla review
 * ratings arrive with their own field in a later PR).
 */

function LedgerRows({ block, ctx }: Pick<SharedBlockProps, "block" | "ctx">) {
  const { entries } = history(block, ctx);
  const linked = new Set(rows(block.linked_offering_ids).map((row) => text(row.id)));
  const language = ctx.artifact.language;
  return (
    <ul className="mg-ledger" data-mg-stagger="">
      {entries.map((entry) => {
        if (entry.kind === "series") {
          return (
            <li key={entry.key}>
              <span className="mg-ledger__when">{entry.first ? formatCalendarDay(entry.first, language) : ""}</span>
              <strong>{entry.name}</strong>
              <span>{entry.place ? `${entry.place} · ` : ""}{entry.departures.length} departures</span>
            </li>
          );
        }
        const departure = entry.departure;
        return (
          <li key={entry.key}>
            <span className="mg-ledger__when">{departure.date ? <time dateTime={departure.date}>{formatCalendarDay(departure.date, language)}</time> : null}</span>
            <strong>{departure.title}</strong>
            <span>
              {departure.place ?? ""}
              {linked.has(departure.id) ? <> <SiteAnchor href={departure.href} className="mg-link">See the trip</SiteAnchor></> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The record on a dark band: the counted total set huge, the heading, then every past offering in a ledger. */
export function OfferingHistoryLedgerCount({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const { entries, total } = history(block, ctx);
  if (!entries.length) return null;
  return (
    <Blk className="mg-hist-ledger" tone="band" labelledBy={id} source={ctx.live?.source ?? "none"}>
      <div className="mg-hl-grid">
        <div data-mg-rise="">
          <p className="mg-big-num"><span data-mg-count={total}>{total}</span></p>
          <Label>{text(block.eyebrow)}</Label>
          <h2 id={id}>{text(block.heading)}</h2>
          {text(block.intro) ? <p className="mg-muted">{text(block.intro)}</p> : null}
          <ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--accent" />
        </div>
        <LedgerRows block={block} ctx={ctx} />
      </div>
    </Blk>
  );
}

/** The record beside a picture of the brand's own (its hero picture, when the page has one). */
export function OfferingHistorySplit({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const { entries, total } = history(block, ctx);
  if (!entries.length) return null;
  return (
    <Blk className="mg-hist-split" labelledBy={id} source={ctx.live?.source ?? "none"}>
      <div className="mg-hs-grid">
        <div data-mg-rise="">
          <Label>{text(block.eyebrow)}</Label>
          <h2 id={id}><span data-mg-count={total}>{total}</span> {text(block.heading)}</h2>
          {text(block.intro) ? <p className="mg-muted">{text(block.intro)}</p> : null}
          <ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" />
        </div>
        <LedgerRows block={block} ctx={ctx} />
      </div>
    </Blk>
  );
}

/* ---------------- testimonials: rail, wall, switcher ---------------- */

function who(quote: { reviewer: string; context: string; date: string | null }, language: string): string {
  return [quote.reviewer, quote.context, quote.date ? formatCalendarDay(quote.date, language) : ""].filter(Boolean).join(" · ");
}

export function TestimonialsRail({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const shown = quotes(block, ctx);
  if (!shown.length) return null;
  const railId = `${id}-rail`;
  return (
    <section className="mg-blk mg-rv-rail" aria-labelledby={text(block.heading) ? id : undefined}>
      <div className="mg-wrap">
        <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} intro={text(block.intro)}
          extra={<div className="mg-rv-side"><RailControls railId={railId} /><ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" /></div>} />
      </div>
      <ul className="mg-rail" id={railId}>
        {shown.map((quote) => (
          <li key={quote.key} className="mg-rcard">
            <span className="mg-rcard__q" aria-hidden="true">{"“"}</span>
            <blockquote>{quote.quote}</blockquote>
            <p className="mg-rcard__who"><span className="mg-av" aria-hidden="true">{quote.reviewer.slice(0, 1)}</span><span><b>{quote.reviewer}</b>{quote.context || quote.date ? <small>{who({ ...quote, reviewer: "" }, ctx.artifact.language)}</small> : null}</span></p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TestimonialsWall({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const shown = quotes(block, ctx);
  if (!shown.length) return null;
  const [first, ...rest] = shown;
  return (
    <Blk className="mg-rv-wall" labelledBy={text(block.heading) ? id : undefined}>
      <Label className="mg-center">{text(block.eyebrow)}</Label>
      {text(block.heading) ? <h2 id={id} className="mg-sr">{text(block.heading)}</h2> : null}
      {text(block.intro) ? <p className="mg-sec-intro mg-center">{text(block.intro)}</p> : null}
      <figure className="mg-bigq-fig" data-mg-rise="">
        <blockquote className="mg-bigq">{"“"}{first!.quote}{"”"}</blockquote>
        <figcaption className="mg-cite">{who(first!, ctx.artifact.language)}</figcaption>
      </figure>
      {rest.length ? (
        <ul className="mg-qrow" data-mg-stagger="">
          {rest.map((quote) => <li key={quote.key}><p>{"“"}{quote.quote}{"”"}</p><span>{who(quote, ctx.artifact.language)}</span></li>)}
        </ul>
      ) : null}
      <div className="mg-center"><ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" /></div>
    </Blk>
  );
}

export function TestimonialsSwitcher({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const shown = quotes(block, ctx).slice(0, 4);
  if (!shown.length) return null;
  return (
    <Blk className="mg-rv-switch" labelledBy={text(block.heading) ? id : undefined}>
      <Label>{text(block.eyebrow)}</Label>
      {text(block.heading) ? <h2 id={id}>{text(block.heading)}</h2> : null}
      {text(block.intro) ? <p className="mg-sec-intro">{text(block.intro)}</p> : null}
      <ReviewSwitcher count={shown.length} labels={shown.map((quote, quoteIndex) => `Review ${quoteIndex + 1}, ${quote.reviewer}`)}>
        {shown.map((quote, quoteIndex) => (
          <figure key={quote.key} className="mg-voice" data-voice={quoteIndex}>
            <blockquote>{"“"}{quote.quote}{"”"}</blockquote>
            <figcaption className="mg-voice__who">{who(quote, ctx.artifact.language)}</figcaption>
          </figure>
        ))}
      </ReviewSwitcher>
      <ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" />
    </Blk>
  );
}

/* ---------------- hours_location: split ---------------- */

export function HoursLocationSplit({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const hours = rows(block.hours).map((row) => ({ day: text(row.day), value: text(row.value) })).filter((row) => row.day);
  return (
    <Blk className="mg-hours" labelledBy={id}>
      <div className="mg-hgrid">
        <div data-mg-rise="">
          <Label>{text(block.eyebrow)}</Label>
          <h2 id={id}>{text(block.heading) || "Hours and location"}</h2>
          <p className="mg-addr">{text(block.address)}</p>
          {isSafeHref(block.map_url) ? <p><a className="mg-link" href={String(block.map_url)}>Open the map</a></p> : null}
        </div>
        <div className="mg-htable" data-mg-rise="">
          {block.always_open === true ? <p className="mg-hx">Open every day, all day.</p> : (
            <table>
              <caption className="mg-sr">Opening hours{text(block.timezone) ? ` (${text(block.timezone)})` : ""}</caption>
              <tbody>{hours.map((row, rowIndex) => <tr key={rowIndex}><th scope="row">{row.day}</th><td>{row.value}</td></tr>)}</tbody>
            </table>
          )}
          {text(block.timezone) ? <p className="mg-hx">Times are local ({text(block.timezone)}).</p> : null}
        </div>
      </div>
    </Blk>
  );
}

/* ---------------- faq: split ---------------- */

export function FaqSplit({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const items = rows(block.items).map((row) => ({ q: text(row.question), a: text(row.answer) })).filter((row) => row.q && row.a);
  if (!items.length) return null;
  return (
    <Blk className="mg-faq" labelledBy={id}>
      <div className="mg-fgrid">
        <div>
          <Label>{text(block.eyebrow)}</Label>
          <h2 id={id}>{text(block.heading) || "Questions"}</h2>
        </div>
        <div>
          {items.map((item, itemIndex) => (
            <details key={itemIndex} open={itemIndex === 0}>
              <summary>{item.q}<span className="mg-pm" aria-hidden="true">+</span></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Blk>
  );
}

/* ---------------- newsletter_signup: photo ---------------- */

/**
 * Join the list over a full-width band. The words shown are the consent text
 * recorded with each signup; Mingla emails to confirm first (A4). The band is
 * the design's dark band (no photograph is typed into this block).
 */
export function NewsletterPhoto({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const forms = ctx.forms;
  if (!forms) return null;
  return (
    <section className="mg-nl-photo" aria-labelledby={id}>
      <div className="mg-wrap mg-nl-photo__inner">
        <Label>{text(block.eyebrow)}</Label>
        <h2 id={id}>{text(block.heading)}</h2>
        {text(block.body) ? <p className="mg-nl-sub">{text(block.body)}</p> : null}
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
        {text(block.small_print) ? <p className="mg-nl-small">{text(block.small_print)}</p> : null}
        <MinglaNote>Your place on the list is kept by Mingla.</MinglaNote>
      </div>
    </section>
  );
}
