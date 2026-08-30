import { type NextRequest, NextResponse } from "next/server";
import {
  decodeSession,
  encodeSession,
  STUDIO_COOKIE,
  STUDIO_CSRF_COOKIE,
} from "./lib/session";
import { cmsConfig } from "./lib/config";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const csrf = request.cookies.get(STUDIO_CSRF_COOKIE)?.value;
  const requestHeaders = new Headers(request.headers);
  if (
    csrf &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.headers.get("origin") === cmsConfig().cmsOrigin
  ) {
    requestHeaders.set("x-mingla-csrf", csrf);
  }
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  const session = await decodeSession(request.cookies.get(STUDIO_COOKIE)?.value ?? null);
  if (!session) return response;
  const now = Math.floor(Date.now() / 1000);
  const refreshedIdle = Math.min(session.absolute_expires_at, now + 30 * 60);
  if (refreshedIdle <= session.idle_expires_at + 60) return response;
  response.cookies.set(
    STUDIO_COOKIE,
    await encodeSession({ ...session, idle_expires_at: refreshedIdle }),
    {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: Math.max(0, session.absolute_expires_at - now),
    },
  );
  if (csrf) {
    response.cookies.set(STUDIO_CSRF_COOKIE, csrf, {
      path: "/",
      secure: true,
      httpOnly: false,
      sameSite: "lax",
      maxAge: 30 * 60,
    });
  }
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/preview"],
};
