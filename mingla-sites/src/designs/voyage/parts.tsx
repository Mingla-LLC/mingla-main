import Link from "next/link";
import type { ReactNode } from "react";
import type { ArtifactV2, MediaRef } from "../../contracts/generated/artifactV2.ts";
import { isSafeHref } from "../../contracts/generated/safety.ts";
import type { SiteEventContext } from "../../lib/clientAnalytics";
import type { LiveOfferings } from "../../lib/offeringCards";
import type { FormsContext } from "../../lib/siteForms";
import type { ArtifactPage } from "../../lib/pageRouting";

/*
 * #2829 W7 — the pieces every voyage block shares: the band and shell, the
 * section head, the action link with its arrow disc, the empty-state card.
 * Class names are the design's own vocabulary (public/designs/voyage/1.css),
 * kept identical to the reference look so its computed styles map 1:1.
 */

export type VoyageBlock = Readonly<Record<string, unknown>> & { type: string; variant?: string };

/** Everything a block may need from the page around it. */
export type VoyageContext = {
  artifact: ArtifactV2;
  page: ArtifactPage;
  live?: LiveOfferings;
  forms?: FormsContext;
  analytics: SiteEventContext;
  saveData?: boolean;
};

export type VoyageBlockProps = { block: VoyageBlock; index: number; ctx: VoyageContext };

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

/** The section id the reference uses: `sec-<type>-<index>`. */
export function sectionId(block: VoyageBlock, index: number): string {
  return `sec-${block.type}-${index}`;
}

/** The artifact's own media record for a URL a block names (alt text and size), or null. */
export function mediaFor(artifact: ArtifactV2, url: unknown): MediaRef | null {
  if (!isSafeHref(url)) return null;
  return artifact.media.find((media) => media.url === url) ?? null;
}

/**
 * #2829 W7b — a `srcset` from a picture's extra renditions: the 400×300 and
 * 768×576 crops and the 1600-wide picture, in that order, one per width.
 * Undefined when the picture has none (media approved before W7b keeps its
 * single URL). The block's own URL stays the `src`.
 */
/*
 * #2829 W7c — `uncropped` leaves out the 4:3 crops, for a frame that is not
 * 4:3 (the brand film's 16:9 panel): a crop drawn into a wider frame loses
 * the sides of the picture that the frame has room for.
 */
export function srcSetFor(artifact: ArtifactV2, url: unknown, options: { uncropped?: boolean } = {}): string | undefined {
  const mediaId = /^\/media\/([0-9a-f-]{36})\//i.exec(typeof url === "string" ? url : "")?.[1];
  const media = mediaId ? artifact.media.find((item) => item.id === mediaId) : undefined;
  const variants = media?.variants ?? [];
  const seen = new Set<number>();
  const candidates: string[] = [];
  for (const name of options.uncropped ? (["w1600"] as const) : (["c400", "c768", "w1600"] as const)) {
    const variant = variants.find((row) => row.name === name);
    if (!variant || seen.has(variant.width)) continue;
    seen.add(variant.width);
    candidates.push(`${variant.url} ${variant.width}w`);
  }
  return candidates.length ? candidates.join(", ") : undefined;
}

/** #2829 W7b — how wide a grid's pictures are drawn, by how many share the row (the count-aware grid). */
export function gridSizes(count: number): string {
  if (count <= 1) return "(min-width: 1240px) 1160px, 92vw";
  if (count === 2) return "(min-width: 1240px) 570px, (min-width: 640px) 46vw, 92vw";
  return "(min-width: 1240px) 373px, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw";
}

export function Arrow({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** The decorative arrow disc a button carries beside its label. */
export function BtnIcon({ size = 14 }: { size?: number }) {
  return <span className="btn__ic" aria-hidden="true"><Arrow size={size} /></span>;
}

export function Section({ children, tinted, labelledBy, className, source }: { children: ReactNode; tinted?: boolean; labelledBy?: string; className?: string; source?: string }) {
  return (
    <section className={`band${tinted ? " is-tinted" : ""}${className ? ` ${className}` : ""}`} aria-labelledby={labelledBy} data-offering-source={source}>
      <div className="shell">{children}</div>
    </section>
  );
}

export function SectionHead({ id, heading, intro, standalone }: { id: string; heading?: string; intro?: string; standalone?: boolean }) {
  if (!heading) return null;
  return (
    <div className={`section-head${standalone ? " section-head--standalone" : ""}`}>
      <h2 id={id}>{heading}</h2>
      {intro ? <p>{intro}</p> : null}
    </div>
  );
}

/** A secondary pill link with the arrow disc; nothing at all without both halves. */
export function ActionLink({ label, href }: { label?: string; href?: unknown }) {
  if (!label || !isSafeHref(href)) return null;
  return <SiteLink href={href} className="btn btn--secondary">{label}<BtnIcon /></SiteLink>;
}

export function HeadRow({ id, heading, intro, link }: { id: string; heading?: string; intro?: string; link?: { label?: string; href?: unknown } }) {
  return (
    <div className="head-row">
      <SectionHead id={id} heading={heading} intro={intro} />
      <ActionLink label={link?.label} href={link?.href} />
    </div>
  );
}

/** Same-site paths go through the router; anything else opens as a plain link. */
export function SiteLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode } & Record<string, unknown>) {
  if (href.startsWith("/")) return <Link href={href} className={className} {...rest}>{children}</Link>;
  return <a href={href} className={className} {...rest}>{children}</a>;
}

export function CalendarGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** The one empty-state card: a disc, a heading, a sentence and the way on. */
export function GridEmpty({ heading, body, action }: { heading: string; body: string; action: { label: string; href: string } | null }) {
  return (
    <div className="card card--raised v-empty">
      <span className="empty-icon" aria-hidden="true"><CalendarGlyph size={28} /></span>
      <h3 className="card__title">{heading}</h3>
      <p className="lede v-empty__body">{body}</p>
      {action ? <SiteLink href={action.href} className="btn btn--primary v-empty__action">{action.label}<BtnIcon /></SiteLink> : null}
    </div>
  );
}

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * A range of two calendar days in the reference's words: "June 20–27, 2026",
 * "June 28 – July 2, 2026", "January 24, 2025 – June 20, 2026".
 */
export function formatDayRange(first: string | null, last: string | null, language = "en-US"): string {
  if (!first || !last) return first ?? last ?? "";
  const [from, to] = first <= last ? [first, last] : [last, first];
  const part = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language, { timeZone: "UTC", ...options }).format(date);
  const a = utcDay(from);
  const b = utcDay(to);
  const [fy, ty, fm, tm, fd, td] = [part(a, { year: "numeric" }), part(b, { year: "numeric" }), part(a, { month: "long" }), part(b, { month: "long" }), part(a, { day: "numeric" }), part(b, { day: "numeric" })];
  if (from === to) return `${fm} ${fd}, ${fy}`;
  if (fy !== ty) return `${fm} ${fd}, ${fy} – ${tm} ${td}, ${ty}`;
  if (fm !== tm) return `${fm} ${fd} – ${tm} ${td}, ${ty}`;
  return `${fm} ${fd}–${td}, ${ty}`;
}
