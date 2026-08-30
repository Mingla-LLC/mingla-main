import { NextResponse } from "next/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (
    !request.headers.get("cookie")?.includes(
      "mingla_site_analytics_consent_v1=granted",
    )
  ) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const keys = new Set([
    "siteId",
    "brandId",
    "publicationId",
    "event_name",
    "source_kind",
    "source_ref",
  ]);
  if (
    Object.keys(input).some((key) => !keys.has(key)) ||
    ![input.siteId, input.brandId, input.publicationId].every((id) =>
      typeof id === "string" && UUID.test(id)
    ) ||
    !["reservation_start", "checkout_start"].includes(
      String(input.event_name),
    ) ||
    input.source_kind !== "site" ||
    !/^[A-Za-z0-9_.-]{1,80}$/.test(String(input.source_ref || ""))
  ) return NextResponse.json({ ok: false }, { status: 400 });
  const { runtimeConfig } = await import("../../../lib/config");
  const config = runtimeConfig();
  const response = await fetch(
    `${config.coreBaseUrl}/functions/v1/brand-site-attribution`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://gogi.sites.usemingla.com",
      },
      body: JSON.stringify({
        action: "issue",
        consent_granted: true,
        event_name: input.event_name,
        site_id: input.siteId,
        brand_id: input.brandId,
        publication_id: input.publicationId,
        consent_policy_version: "sites-v1",
        source_kind: "site",
        source_ref: input.source_ref,
      }),
      cache: "no-store",
    },
  ).catch(() => null);
  if (!response?.ok) return NextResponse.json({ ok: false }, { status: 503 });
  const result = await response.json();
  return NextResponse.json(result, {
    status: 200,
    headers: { "cache-control": "no-store, private" },
  });
}
