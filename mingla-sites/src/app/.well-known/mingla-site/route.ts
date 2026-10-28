import { NextResponse } from "next/server";
import { sha256 } from "../../../lib/crypto";
import { signedHostResolution } from "../../../lib/coreGateway";
import { requestHost } from "../../../lib/publication";

/*
 * #2829 W8 (AD-10, S-9) — "is this address really pointed at this site?"
 *
 * Core activates a brand's own domain only when HTTPS on that domain answers
 * here with the hash of the site Core is attaching it to, so a domain somebody
 * else points at the hosting provider can never be bound to a different site.
 * It answers for an address that is still waiting to go live (that is what the
 * probe is for) as well as a live one, with the first 16 hex characters of
 * sha256(site id) and nothing else: no brand name, no ids, no publication.
 * Unknown, revoked, deleted or suspended: 404. Never cached.
 */
function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request): Promise<NextResponse> {
  let hostname: string;
  try {
    hostname = requestHost(request.headers);
  } catch {
    return notFound();
  }
  try {
    const response = await signedHostResolution(hostname, "probe");
    if (!response.ok) return notFound();
    const payload = await response.json();
    const data = payload?.ok ? payload.data : null;
    if (!data || data.hostname !== hostname || typeof data.site_id !== "string") return notFound();
    const site = (await sha256(new TextEncoder().encode(data.site_id))).slice(0, 16);
    return NextResponse.json({ site }, {
      status: 200,
      headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  } catch {
    return notFound();
  }
}
