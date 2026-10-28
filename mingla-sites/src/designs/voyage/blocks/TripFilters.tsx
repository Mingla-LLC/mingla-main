import type { OfferingFilters } from "../../../contracts/generated/offerings.ts";
import { SiteLink } from "../parts";

/*
 * #2829 W7 — the date-and-place search: a plain GET form to the trips page,
 * no JavaScript, native date inputs. The search lives in the URL, so results
 * are shareable and the list on screen is the list the URL asks for. Both
 * variants are light panels (`on-light`), so text inside a dark cover stays
 * legible.
 */
export function TripFilters({ variant, action, filters }: { variant: "hero" | "panel"; action: string; filters?: OfferingFilters }) {
  const hero = variant === "hero";
  const hasQuery = Boolean(filters?.where || filters?.from || filters?.to);
  const cell = hero ? "search-cell v-search-cell v-search-cell--hero" : "search-cell v-search-cell v-search-cell--panel";
  const prefix = hero ? "hero-" : "panel-";
  return (
    <>
      <form
        action={action}
        method="get"
        role="search"
        aria-label="Find a trip"
        className={hero ? "search-bar on-light hero-enter v-search v-search--hero" : "card card--raised on-light v-search v-search--panel"}
        style={hero ? { ["--enter-delay" as string]: "420ms" } : undefined}
      >
        <div className={cell}>
          <label htmlFor={`${prefix}where`} className="micro-label v-block">Where to?</label>
          <input id={`${prefix}where`} name="where" type="search" maxLength={80} defaultValue={filters?.where ?? undefined} placeholder="Search a place or activity destination" className="search-input" />
        </div>
        {hero ? <div className="search-divider v-search-divider" /> : null}
        <div className={cell}>
          <label htmlFor={`${prefix}from`} className="micro-label v-block">From</label>
          <input id={`${prefix}from`} name="from" type="date" defaultValue={filters?.from ?? undefined} className="search-input" />
        </div>
        {hero ? <div className="search-divider v-search-divider" /> : null}
        <div className={cell}>
          <label htmlFor={`${prefix}to`} className="micro-label v-block">To</label>
          <input id={`${prefix}to`} name="to" type="date" defaultValue={filters?.to ?? undefined} className="search-input" />
        </div>
        <button type="submit" className={hero ? "btn btn--primary btn--on-photo v-search-submit v-search-submit--hero" : "btn btn--primary v-search-submit"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className={hero ? "v-search-submit__label" : undefined}>Search</span>
        </button>
      </form>
      {hasQuery ? (
        <p className="v-clear-search"><SiteLink href={action} className="link v-semibold">Clear search</SiteLink></p>
      ) : null}
    </>
  );
}
