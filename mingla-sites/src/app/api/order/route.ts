import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { loadPublication, normalizePublicHost } from "../../../lib/publication";
import { runtimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

/**
 * #2830 — the website's ONLY door to ordering, and it is deliberately narrow.
 *
 * WHY A PROXY AT ALL. The runtime's CSP is `connect-src 'self'`, so the page
 * cannot call Mingla directly, and relaxing that to reach a payments origin
 * from a customer's browser would be a poor trade. This route keeps the policy
 * tight and gives us one place to enforce the rules below.
 *
 * WHAT THE BROWSER MAY SEND: menu item ids and quantities. That is all.
 *
 * IT MAY NOT SEND A PRICE, and this route will not forward one even if asked.
 * A cart runs in the customer's browser; anyone with dev tools can edit what it
 * posts. Mingla prices the order from its own menu — `venue-order-create` takes
 * `{ menuItemId, quantity }` and looks the money up itself — so a browser can
 * never name its own price. This is true regardless of how fresh the published
 * menu is, which is why it is a rule and not a staleness workaround.
 *
 * THE VENUE COMES FROM THE PUBLISHED ARTIFACT, never from the request. A caller
 * cannot point a gogi order at somebody else's kitchen.
 */
const MAX_LINES = 40;
const MAX_QTY = 50;

type Line = { menuItemId: string; quantity: number };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeLines(value: unknown): Line[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) {
    return null;
  }
  const lines: Line[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const menuItemId = row.menuItemId;
    const quantity = row.quantity;
    if (typeof menuItemId !== "string" || !UUID.test(menuItemId)) return null;
    if (
      typeof quantity !== "number" || !Number.isInteger(quantity) ||
      quantity < 1 || quantity > MAX_QTY
    ) return null;
    lines.push({ menuItemId, quantity });
  }
  return lines;
}

/** The venue this published site is allowed to order against, or null. */
async function orderableVenue(): Promise<
  { venueId: string; siteId: string } | null
> {
  const incoming = await headers();
  const host = normalizePublicHost(
    incoming.get("x-forwarded-host") || incoming.get("host"),
  );
  const { artifact } = await loadPublication(host);
  for (const page of artifact.pages) {
    for (const block of page.blocks) {
      if (block.type !== "menu_board") continue;
      const venueId = (block as Record<string, unknown>).venue_id;
      if (typeof venueId === "string" && UUID.test(venueId)) {
        return { venueId, siteId: artifact.site_id };
      }
    }
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const lines = safeLines(payload.lines);
  const mode = payload.mode === "create" ? "create" : "preview";
  if (!lines) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  let venue: { venueId: string; siteId: string } | null;
  try {
    venue = await orderableVenue();
  } catch {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  if (!venue) {
    // The published site has no orderable venue, so it has no cart either.
    return NextResponse.json({ ok: false, error: "ordering_unavailable" }, { status: 409 });
  }

  const config = runtimeConfig();
  const response = await fetch(
    `${config.coreBaseUrl}/functions/v1/venue-order-create`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        venueId: venue.venueId,
        surface: "web",
        mode,
        src: "mingla_sites",
        // Only ids and quantities cross this boundary.
        lines: lines.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          modifierIds: [],
          notes: null,
        })),
        ...(mode === "create" && typeof payload.buyer === "object" &&
            payload.buyer !== null
          ? { buyer: payload.buyer }
          : {}),
        ...(mode === "create" && typeof payload.idempotencyKey === "string"
          ? { idempotencyKey: payload.idempotencyKey.slice(0, 200) }
          : {}),
      }),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    return NextResponse.json(
      { ok: false, error: "ordering_unavailable" },
      { status: 503 },
    );
  }
  // Pass Mingla's answer through unchanged. It is the authority on price and
  // on whether an item can still be ordered at all.
  return NextResponse.json(result, { status: response.status });
}
