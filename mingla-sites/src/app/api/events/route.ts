import { NextResponse } from "next/server";
import { signedCorePost } from "../../../lib/coreGateway";

const EVENT_NAMES = new Set([
  "site_view",
  "page_view",
  "cta_click",
  "offering_view",
  "reservation_start",
  "checkout_start",
  "checkout_complete",
  "contact_click",
  "consent_granted",
  "consent_denied",
]);
const KEYS = new Set([
  "event_name",
  "occurred_at",
  "site_id",
  "brand_id",
  "publication_id",
  "page_role",
  "cta_kind",
  "offering_id",
  "referrer_class",
  "consent_policy_version",
  "event_id",
]);

export async function POST(request: Request) {
  if (
    !request.headers.get("cookie")?.includes(
      "mingla_site_analytics_consent_v1=granted",
    )
  ) return NextResponse.json({ ok: false }, { status: 403 });
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) return NextResponse.json({ ok: false }, { status: 415 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const event = body as Record<string, unknown>;
  if (
    Object.keys(event).some((key) => !KEYS.has(key)) ||
    !EVENT_NAMES.has(String(event.event_name)) ||
    event.consent_policy_version !== "sites-v1"
  ) return NextResponse.json({ ok: false }, { status: 400 });
  await signedCorePost({
    edgeFunction: "brand-site-attribution",
    path: `/internal/v1/sites/${String(event.site_id)}/analytics-events`,
    siteId: String(event.site_id),
    body: {
      ...event,
      action: "event",
      consent_granted: true,
      occurred_at: event.occurred_at || new Date().toISOString(),
    },
  }).catch(() => undefined);
  return new NextResponse(null, { status: 202 });
}
