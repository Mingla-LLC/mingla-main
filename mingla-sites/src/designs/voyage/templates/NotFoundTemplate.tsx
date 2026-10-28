import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import { headerCta } from "../../../lib/pageRouting";
import { collectionIndexPath } from "../routing";
import { SiteLink } from "../parts";

/*
 * #2829 W7 — the voyage 404: a full-height centred panel on the tinted
 * ground with a soft accent glow (no cover, so the header stays solid).
 * "404", "This page has moved on", and the way on: when the site has a trips
 * page, the owner's header button (or "Browse trips") goes there; otherwise
 * back home.
 */
export function NotFoundTemplate({ artifact }: { artifact: ArtifactV2 }) {
  const trips = collectionIndexPath(artifact, "trips");
  const cta = headerCta(artifact);
  const action = trips
    ? { label: cta && cta.href === trips ? cta.label : "Browse trips", href: trips }
    : { label: "Back to the home page", href: "/" };
  return (
    <div className="notfound band">
      <div className="shell v-notfound">
        <p className="eyebrow">404</p>
        <h1 className="v-notfound__title">This page has moved on</h1>
        <p className="lede v-notfound__lede">{trips ? "The page you were looking for isn’t here. Try our upcoming trips instead." : "The page you were looking for isn’t here."}</p>
        <SiteLink href={action.href} className="btn btn--primary btn--lg v-notfound__action">{action.label}</SiteLink>
      </div>
    </div>
  );
}
