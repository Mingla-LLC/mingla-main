import { NextResponse } from "next/server";
import { hasGrantedAnalyticsConsent } from "../../../lib/consent";
import { PAGE_PATH, recordSiteEvent, SITE_EVENT_KEYS, SITE_EVENT_NAMES } from "../../../lib/siteEvents";
import { loadPublication, requestHost } from "../../../lib/publication";

export async function POST(request: Request) {
  if (!hasGrantedAnalyticsConsent(request.headers.get("cookie"))) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) return NextResponse.json({ ok: false }, { status: 415 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const event = body as Record<string, unknown>;
  if (
    Object.keys(event).some((key) => !SITE_EVENT_KEYS.has(key)) ||
    !SITE_EVENT_NAMES.has(String(event.event_name)) ||
    event.consent_policy_version !== "sites-v1" ||
    // #2829 W10 — "top pages": a page address only, never a query or fragment.
    (event.page_path !== undefined && (typeof event.page_path !== "string" || !PAGE_PATH.test(event.page_path)))
  ) return NextResponse.json({ ok: false }, { status: 400 });
  // #2829 — the site comes from the host this request arrived on: the ids in
  // the body must be that host's site, brand and live publication.
  let publication: Awaited<ReturnType<typeof loadPublication>>;
  try {
    publication = await loadPublication(requestHost(request.headers));
  } catch {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const { artifact, resolution } = publication;
  if (
    event.site_id !== artifact.site_id ||
    event.brand_id !== artifact.brand_id ||
    event.publication_id !== artifact.publication_id
  ) return NextResponse.json({ ok: false }, { status: 403 });
  await recordSiteEvent(resolution, {
    ...event,
    site_id: artifact.site_id,
    brand_id: artifact.brand_id,
    publication_id: artifact.publication_id,
  }).catch(() => undefined);
  return new NextResponse(null, { status: 202 });
}
