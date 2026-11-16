/* eslint-disable @next/next/no-img-element -- site media is first-party and immutable (/media, /om). */
import type { ReactNode } from "react";
import type { ArtifactV2, MediaRef } from "../../contracts/generated/artifactV2.ts";
import { isSafeHref } from "../../contracts/generated/safety.ts";
import { SiteRouteLink } from "../../components/PreviewLinks";
import type { SiteEventContext } from "../../lib/clientAnalytics";
import type { LiveOfferings } from "../../lib/offeringCards";
import type { FormsContext } from "../../lib/siteForms";
import type { ArtifactPage } from "../../lib/pageRouting";

/*
 * #4453 §3.3 — the pieces every SHARED layout uses. A shared layout reads
 * only the block's validated fields and the shared role variables
 * (`--mg-*`), which each design's own stylesheet maps onto its tokens. It
 * never names a colour, never names a design, and never draws content the
 * block does not carry (no demo values, no typed prices).
 */

export type SharedBlock = Readonly<Record<string, unknown>> & { type: string; variant?: string };

/** Everything a shared layout may need from the page around it (same shape as each design's context). */
export type SharedContext = {
  artifact: ArtifactV2;
  page: ArtifactPage;
  live?: LiveOfferings;
  forms?: FormsContext;
  analytics: SiteEventContext;
  saveData?: boolean;
};

export type SharedBlockProps = { block: SharedBlock; index: number; ctx: SharedContext };

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

/** The section id: `mg-<type>-<index>` (headings are labelled by it). */
export function sectionId(block: SharedBlock, index: number): string {
  return `mg-${block.type}-${index}`;
}

/** The artifact's own media record for a URL a block names, or null. */
export function mediaFor(artifact: ArtifactV2, url: unknown): MediaRef | null {
  if (!isSafeHref(url)) return null;
  return artifact.media.find((media) => media.url === url) ?? null;
}

/** A `srcset` from a picture's publish-time renditions (never Image Transformations, #1643). */
export function srcSetFor(artifact: ArtifactV2, url: unknown): string | undefined {
  const mediaId = /^\/media\/([0-9a-f-]{36})\//i.exec(typeof url === "string" ? url : "")?.[1];
  const media = mediaId ? artifact.media.find((item) => item.id === mediaId) : undefined;
  const seen = new Set<number>();
  const out: string[] = [];
  for (const name of ["c400", "c768", "w1600"] as const) {
    const variant = media?.variants?.find((row) => row.name === name);
    if (!variant || seen.has(variant.width)) continue;
    seen.add(variant.width);
    out.push(`${variant.url} ${variant.width}w`);
  }
  return out.length ? out.join(", ") : undefined;
}

/**
 * One picture. The hero's is eager with `fetchpriority="high"`; every other
 * picture is lazy and decodes off the main thread (§3.7).
 */
export function Photo({ artifact, url, alt, sizes, hero, className }: { artifact: ArtifactV2; url: unknown; alt?: string; sizes?: string; hero?: boolean; className?: string }) {
  if (!isSafeHref(url)) return null;
  const media = mediaFor(artifact, url);
  return (
    <img
      src={String(url)}
      srcSet={srcSetFor(artifact, url)}
      sizes={sizes ?? "100vw"}
      alt={alt ?? media?.alt ?? ""}
      width={media?.width}
      height={media?.height}
      className={className}
      {...(hero ? { fetchPriority: "high" as const, decoding: "sync" as const } : { loading: "lazy" as const, decoding: "async" as const })}
    />
  );
}

/** Same-site paths go through the router; anything else is a plain link (Mingla pages open in the same tab). */
export function Go({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode } & Record<string, unknown>) {
  if (href.startsWith("/")) return <SiteRouteLink href={href} className={className} {...rest}>{children}</SiteRouteLink>;
  return <a href={href} className={className} {...rest}>{children}</a>;
}

export function Arrow() {
  return (
    <svg className="mg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** A button-shaped link; nothing without both a label and a safe link. */
export function ActionButton({ label, href, className = "mg-btn" }: { label: string; href: unknown; className?: string }) {
  if (!label || !isSafeHref(href)) return null;
  return <Go href={String(href)} className={className}><span>{label}</span><Arrow /></Go>;
}

/** The small line above a heading, set in the label face. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  if (children === "" || children == null) return null;
  return <p className={`mg-label${className ? ` ${className}` : ""}`}>{children}</p>;
}

/** The section head: label, heading, the line beside it, and anything else (controls, a rating line). */
export function SecHead({ id, eyebrow, heading, intro, extra }: { id: string; eyebrow?: string; heading?: string; intro?: string; extra?: ReactNode }) {
  if (!heading && !eyebrow && !intro && !extra) return null;
  return (
    <div className="mg-sec-head" data-mg-rise="">
      <div className="mg-sec-head__main">
        <Label>{eyebrow}</Label>
        {heading ? <h2 id={id}>{heading}</h2> : null}
      </div>
      {intro ? <p className="mg-sec-intro">{intro}</p> : null}
      {extra}
    </div>
  );
}

/** "Booked through Mingla": the line under every booking action. */
export function MinglaNote({ children = "Booked through Mingla" }: { children?: ReactNode }) {
  return (
    <p className="mg-note">
      <svg className="mg-mmark" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.6 13.4V6.8l4.4 4.6 4.4-4.6v6.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/** A section shell: `blk` padding, an optional tone, the wrap. */
export function Blk({ id, className, labelledBy, tone, children, source, wrap = true }: { id?: string; className: string; labelledBy?: string; tone?: "alt" | "band"; children: ReactNode; source?: string; wrap?: boolean }) {
  return (
    <section id={id} className={`mg-blk ${className}${tone ? ` mg-${tone}` : ""}`} aria-labelledby={labelledBy} data-offering-source={source}>
      {wrap ? <div className="mg-wrap">{children}</div> : children}
    </section>
  );
}

/**
 * The hero headline, line by line (each line is a mask its words rise out
 * of). When the owner set the lines, the one-line `heading` is the heading's
 * accessible text and the lines are what is seen, so the block's every field
 * is drawn and a screen reader hears the headline once.
 */
export function HeadlineLines({ lines, heading, as: Tag = "h1", id }: { lines: string[]; heading?: string; as?: "h1" | "h2"; id?: string }) {
  const spoken = heading && lines.join(" ") !== heading ? heading : null;
  return (
    <Tag id={id} className="mg-h1">
      {spoken ? <span className="mg-sr">{spoken}</span> : null}
      {lines.map((line, lineIndex) => (
        <span key={lineIndex} className="mg-ln" aria-hidden={spoken ? "true" : undefined}><span style={{ ["--ln" as string]: String(lineIndex) }}>{line}</span></span>
      ))}
    </Tag>
  );
}
