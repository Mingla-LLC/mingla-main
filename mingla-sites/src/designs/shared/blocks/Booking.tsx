/* eslint-disable @next/next/no-img-element -- site media is first-party and immutable (/media). */
import {
  availabilityRequestFor,
  availabilityKey,
  heroTargetRequestFor,
  liveTicketTiers,
  targetKey,
  visibleDays,
  type AvailabilitySlot,
  type BookingTarget,
} from "../../../contracts/generated/availability.ts";
import { formatOfferingPrice } from "../../../contracts/generated/offerings.ts";
import { ratingLine } from "../../../contracts/generated/ratings.ts";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { HandoffLink, HeroBookingForm, MinglaHandoff, StickyBookingBar } from "../chrome/Handoff";
import { Blk, Photo, rows, SecHead, sectionId, text, type SharedBlock, type SharedBlockProps, type SharedContext } from "../parts";

/*
 * #4453 milestone 5 (spec v2 §5) — the shared library's live booking
 * layouts: `availability:strip`, `ticket_tiers:split`, `process_steps:band`,
 * plus the hero booking bar, the Mingla rating and the page's hand-off and
 * sticky phone bar. Every design draws these from its own tokens (the shared
 * `--mg-*` roles). Every fact comes from Core's live reads (ctx.live.booking);
 * a block with nothing live renders NOTHING (no public empty state). Every
 * action is this brand's own Mingla page, opened through the hand-off sheet.
 */

function money(minor: number | null, currency: string | null, language: string): string | undefined {
  if (minor === null || minor <= 0 || !currency) return undefined;
  return formatOfferingPrice({ min_price_minor: minor, currency, has_free_tier: false }, language);
}

/** "Fri 20 Nov" for a local date (formatted as a calendar date, never shifted by a zone). */
export function dayName(localDate: string, language: string): { day: string; date: string } {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" }).format(at);
  return { day: fmt({ weekday: "short" }), date: fmt({ day: "numeric", month: "short" }) };
}

function SlotChip({ slot, item, when, language }: { slot: AvailabilitySlot; item: string; when: string; language: string }) {
  const from = money(slot.price_minor, slot.currency, language);
  const note = slot.state === "few" && slot.left !== null ? `${slot.left} left` : slot.state === "full" ? "Full" : "";
  const body = (
    <>
      <span className="mg-slot__t">{slot.label}</span>
      {note ? <span className="mg-slot__n">{note}</span> : null}
      {from ? <span className="mg-slot__p">{from}</span> : null}
    </>
  );
  // SC-B1: a full slot is text, never a link.
  if (slot.state === "full" || !slot.href) return <li><span className="mg-slot mg-slot--full" aria-label={`${slot.label}, full`}>{body}</span></li>;
  return (
    <li>
      <HandoffLink
        className={`mg-slot mg-slot--${slot.state}`}
        label={`Book ${slot.label} on ${when}${note ? `, ${note}` : ""} on Mingla`}
        detail={{ href: slot.href, item, when: `${when} · ${slot.label}`, from, ctaKind: "reservation" }}
      >
        {body}
      </HandoffLink>
    </li>
  );
}

/** `availability:strip` — a day rail (scroll-snap on phones) of live slots, nights or dates. */
export function AvailabilityStrip({ block, index, ctx }: SharedBlockProps) {
  const ask = availabilityRequestFor(block);
  const feed = ask ? ctx.live?.booking?.availability.get(availabilityKey(ask)) : undefined;
  const days = visibleDays(feed);
  if (!feed || !days.length) return null;
  const id = sectionId(block, index);
  const language = ctx.artifact.language;
  const item = feed.title ?? text(block.heading) ?? "Booking";
  return (
    <Blk id={id} className="mg-slots" labelledBy={`${id}-h`}>
      <SecHead id={`${id}-h`} eyebrow={text(block.eyebrow)} heading={text(block.heading) || "Book a time"} intro={text(block.intro)} />
      <p className="mg-slots__tz">Times in {feed.timezone.replace(/_/g, " ")}</p>
      <ol className="mg-slots__days" aria-label="Days">
        {days.map((day) => {
          const name = dayName(day.local_date, language);
          const when = `${name.day} ${name.date}`;
          return (
            <li key={day.local_date} className="mg-slots__day">
              <p className="mg-slots__dn"><span>{name.day}</span> {name.date}</p>
              <ul className="mg-slots__slots" aria-label={when}>
                {day.slots.map((slot) => <SlotChip key={slot.start_local} slot={slot} item={item} when={when} language={language} />)}
              </ul>
            </li>
          );
        })}
      </ol>
      <p className="mg-slots__foot">Booked through Mingla</p>
    </Blk>
  );
}

/** `ticket_tiers:split` — one event's public tiers beside its picture; nothing after the event (SC-B2). */
export function TicketTiersSplit({ block, index, ctx }: SharedBlockProps) {
  const eventId = typeof block.offering_id === "string" ? block.offering_id.toLowerCase() : "";
  const feed = ctx.live?.booking?.ticketTiers.get(eventId);
  const tiers = liveTicketTiers(feed, ctx.live?.now ?? new Date());
  if (!feed || !tiers.length) return null;
  const id = sectionId(block, index);
  const language = ctx.artifact.language;
  const picture = isSafeHref(block.media_url) ? block.media_url : null;
  return (
    <Blk id={id} className="mg-tiers" labelledBy={`${id}-h`}>
      <div className={`mg-tiers__grid${picture ? "" : " mg-tiers__grid--solo"}`}>
        {picture ? <div className="mg-tiers__media"><Photo artifact={ctx.artifact} url={picture} sizes="(min-width: 900px) 45vw, 100vw" /></div> : null}
        <div className="mg-tiers__body">
          <SecHead id={`${id}-h`} eyebrow={text(block.eyebrow)} heading={text(block.heading) || feed.event.title} intro={text(block.intro)} />
          <ul className="mg-tiers__list">
            {tiers.map((tier) => {
              const price = tier.is_free ? "Free" : money(tier.price_minor, tier.currency, language)?.replace(/^From /, "") ?? "";
              const status = tier.state === "sold_out" ? "Sold out" : tier.state === "not_yet" ? "On sale soon" : "";
              return (
                <li key={tier.id} className={`mg-tier mg-tier--${tier.state}`}>
                  <span className="mg-tier__name">{tier.name}</span>
                  <span className="mg-tier__price">{price}</span>
                  {tier.state === "on_sale" && tier.href ? (
                    <HandoffLink className="mg-btn mg-btn--accent mg-tier__go" label={`Buy ${tier.name} for ${feed.event.title} on Mingla`}
                      detail={{ href: tier.href, item: `${feed.event.title} · ${tier.name}`, from: price || undefined, ctaKind: "checkout" }}>
                      <span>Buy</span>
                    </HandoffLink>
                  ) : <span className="mg-tier__state">{status}</span>}
                </li>
              );
            })}
          </ul>
          <p className="mg-slots__foot">Booked through Mingla</p>
        </div>
      </div>
    </Blk>
  );
}

/** `process_steps:band` — the owner's own 3-5 steps (Q7), verbatim. */
export function ProcessStepsBand({ block, index }: SharedBlockProps) {
  const steps = rows(block.items).map((row) => ({ title: text(row.title), text: text(row.text), time: text(row.time) })).filter((row) => row.title);
  if (steps.length < 3) return null;
  const id = sectionId(block, index);
  return (
    <Blk id={id} className="mg-steps" labelledBy={`${id}-h`} tone="band">
      <SecHead id={`${id}-h`} eyebrow={text(block.eyebrow)} heading={text(block.heading) || "How it works"} intro={text(block.intro)} />
      <ol className="mg-steps__list">
        {steps.slice(0, 5).map((step, stepIndex) => (
          <li key={stepIndex} className="mg-step" data-mg-rise="">
            <span className="mg-step__n" aria-hidden="true">{String(stepIndex + 1).padStart(2, "0")}</span>
            <h3 className="mg-step__t">{step.title}</h3>
            {step.text ? <p className="mg-step__d">{step.text}</p> : null}
            {step.time ? <p className="mg-step__time">{step.time}</p> : null}
          </li>
        ))}
      </ol>
    </Blk>
  );
}

/** The hero bar's target from the live data (null when it is not this brand's or not bookable). */
export function heroTarget(block: SharedBlock, ctx: SharedContext): BookingTarget | null {
  const ask = heroTargetRequestFor(block);
  return ask ? ctx.live?.booking?.targets.get(targetKey(ask)) ?? null : null;
}

/** The hero booking bar (§5.5): blank fields with real input types; submit hands off to Mingla. */
export function HeroBookingBar({ target, id, language }: { target: BookingTarget; id: string; language: string }) {
  const from = money(target.min_price_minor, target.currency, language);
  const field = (name: string, label: string, type: "date" | "time" | "number") => (
    <label htmlFor={`${id}-${name}`}>
      <span className="mg-bk__k">{label}</span>
      <input id={`${id}-${name}`} name={name} type={type} {...(type === "number" ? { min: 1, max: 20, inputMode: "numeric" as const } : {})} />
    </label>
  );
  return (
    <HeroBookingForm target={target} from={from} submitLabel={target.kind === "venue_table" ? "Find a table" : target.kind === "stay" ? "Check dates" : "Book"}>
      {target.kind === "venue_table" ? <>{field("date", "Date", "date")}{field("time", "Time", "time")}{field("party", "Guests", "number")}</> : null}
      {target.kind === "stay" ? <>{field("checkin", "Check in", "date")}{field("checkout", "Check out", "date")}{field("guests", "Guests", "number")}</> : null}
      {target.kind === "experience" ? <>{field("date", "Date", "date")}{field("guests", "Guests", "number")}</> : null}
    </HeroBookingForm>
  );
}

/** The hero rating badge (§5.6): approved Mingla reviews only, at least 20; nothing otherwise. */
export function HeroRating({ block, ctx }: { block: SharedBlock; ctx: SharedContext }) {
  const rating = block.show_rating === true ? ctx.live?.booking?.rating : null;
  if (!rating) return null;
  return <p className="mg-rating" data-mg-in=""><span className="mg-rating__star" aria-hidden="true">★</span> {ratingLine(rating)}</p>;
}

/** The testimonials rating line (§5.6). */
export function TestimonialsRating({ block, ctx, wrap }: { block: SharedBlock; ctx: SharedContext; wrap?: boolean }) {
  const rating = block.show_rating === true ? ctx.live?.booking?.rating : null;
  if (!rating) return null;
  const line = <p className="mg-rating mg-rating--line">{ratingLine(rating)}</p>;
  return wrap ? <div className="mg-wrap">{line}</div> : line;
}

/**
 * The page's sticky phone bar action (§5.7): the first hero booking target
 * on the page, else the header button when it is a Mingla page. One action.
 */
export function stickyAction(ctx: SharedContext): { href: string; item: string; from?: string } | null {
  if (ctx.artifact.navigation.sticky_booking !== true) return null;
  for (const raw of ctx.page.blocks) {
    const target = heroTarget(raw as unknown as SharedBlock, ctx);
    if (target) return { href: target.base_url + (target.kind === "venue_table" ? "?tab=book" : target.kind === "stay" ? "?tab=stay" : ""), item: target.title, from: money(target.min_price_minor, target.currency, ctx.artifact.language) };
  }
  const cta = ctx.artifact.navigation.header_cta;
  if (cta && typeof cta.href === "string" && /^https:\/\/host\.usemingla\.com\//.test(cta.href)) return { href: cta.href, item: String(cta.label ?? "Book") };
  return null;
}

/** The hand-off sheet and the sticky phone bar, once per page (only when the page has a Mingla action). */
export function PageBookingChrome({ ctx }: { ctx: SharedContext }) {
  const sticky = stickyAction(ctx);
  const title = text(ctx.artifact.navigation.sticky_title) || sticky?.item || "";
  const note = text(ctx.artifact.navigation.sticky_note) || sticky?.from || "";
  return (
    <>
      <MinglaHandoff context={ctx.analytics} preview={ctx.preview === true} />
      {sticky ? (
        <StickyBookingBar>
          <div className="mg-sticky__txt"><p className="mg-sticky__t">{title}</p>{note ? <p className="mg-sticky__n">{note}</p> : null}</div>
          <HandoffLink className="mg-btn mg-btn--accent mg-sticky__go" detail={{ href: sticky.href, item: sticky.item, from: sticky.from, ctaKind: "reservation" }}>
            <span>Book</span>
          </HandoffLink>
        </StickyBookingBar>
      ) : null}
    </>
  );
}
