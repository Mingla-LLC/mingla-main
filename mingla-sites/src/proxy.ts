import { NextRequest, NextResponse } from "next/server";
import { loadPublication, normalizePublicHost } from "./lib/publication";

export async function proxy(request: NextRequest) {
  try {
    const host = normalizePublicHost(request.headers.get("x-forwarded-host") || request.headers.get("host"));
    const { resolution } = await loadPublication(host);
    const response = NextResponse.next();
    response.headers.set("x-mingla-publication-id", resolution.publication_id);
    response.headers.set("x-mingla-artifact-digest", resolution.artifact_digest);
    response.headers.set("cache-control", "public, max-age=30, stale-if-error=300");
    return response;
  } catch {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
}

export const config = { matcher: ["/"] };
