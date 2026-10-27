/* eslint-disable @next/next/no-img-element -- the cover photograph is the site's own first-party, immutable media. */
import Link from "next/link";
import type { ReactNode } from "react";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { hrefForPage, sitePages, type ArtifactPage } from "../../../lib/pageRouting";
import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import { srcSetFor, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — page_header `cover-center`: a full-viewport cover with the page
 * title centred, the breadcrumb back home above it (built from the page tree:
 * Home, then each parent page, then this page) and the line under it (a new
 * line in the owner's text starts a new line). Over the owner's photograph
 * under a scrim, or — with no photograph — the lit dark panel.
 */
export type Crumb = { label: string; href: string | null };

/** Home → each ancestor page (when it exists) → this page. */
export function breadcrumbFor(artifact: ArtifactV2, page: ArtifactPage, currentLabel: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Home", href: "/" }];
  const segments = page.path.split("/").filter(Boolean);
  const pages = sitePages(artifact);
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestor = pages.find((candidate) => candidate.enabled && candidate.path === segments.slice(0, depth).join("/"));
    if (ancestor) crumbs.push({ label: ancestor.title, href: hrefForPage(ancestor) });
  }
  crumbs.push({ label: currentLabel, href: null });
  return crumbs;
}

export function Breadcrumb({ crumbs, center }: { crumbs: Crumb[]; center?: boolean }) {
  const parts: ReactNode[] = [];
  crumbs.forEach((crumb, index) => {
    if (index > 0) parts.push(<li key={`sep-${index}`} aria-hidden="true" className="v-crumb-sep">/</li>);
    parts.push(
      crumb.href === null
        ? <li key={`c-${index}`} aria-current="page" className="v-crumb-current">{crumb.label}</li>
        : <li key={`c-${index}`}><Link href={crumb.href} className="v-crumb-link">{crumb.label}</Link></li>,
    );
  });
  return (
    <nav aria-label="Breadcrumb" className={`meta v-crumbs${center ? " v-crumbs--center" : ""}`}>
      <ol className={`v-crumbs__list${center ? " v-crumbs__list--center" : ""}`}>{parts}</ol>
    </nav>
  );
}

export function PageHeader({ block, ctx }: VoyageBlockProps) {
  const picture = isSafeHref(block.media_url) ? String(block.media_url) : null;
  const heading = text(block.heading);
  return (
    <section className={`cover cover--center v-cover v-cover--header ${picture ? "on-photo" : "on-dark header-gradient"}`}>
      {picture ? (
        <>
          <img src={picture} srcSet={srcSetFor(ctx.artifact, picture)} alt="" aria-hidden="true" sizes="100vw" className="v-cover__img v-cover__img--header photo-header" />
          <span aria-hidden="true" className="scrim-header v-behind" />
        </>
      ) : null}
      <div className="shell v-center">
        <Breadcrumb crumbs={breadcrumbFor(ctx.artifact, ctx.page, heading)} center />
        <h1 className="v-page-title">{heading}</h1>
        {text(block.subheading) ? <p className="lede v-on-photo-lede v-page-lede">{text(block.subheading)}</p> : null}
      </div>
    </section>
  );
}
