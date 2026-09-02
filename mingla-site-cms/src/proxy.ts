import { type NextRequest, NextResponse } from "next/server";
import {
  decodeSession,
  encodeSession,
  STUDIO_COOKIE,
  STUDIO_CSRF_COOKIE,
} from "./lib/session";
import { cmsConfig } from "./lib/config";

const PAGES_ROUTE = "/admin/collections/pages";

function isPathOrDescendant(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function strippedStudioDestination(pathname: string): string | null {
  if (pathname === "/admin" || pathname === "/admin/") return PAGES_ROUTE;
  if (isPathOrDescendant(pathname, "/admin/collections/media")) {
    return "/studio/media";
  }
  if (
    isPathOrDescendant(pathname, "/admin/account") ||
    isPathOrDescendant(pathname, "/admin/collections/tenants") ||
    isPathOrDescendant(pathname, "/admin/collections/studio-users")
  ) return PAGES_ROUTE;
  return null;
}

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
  const sessionToken = request.cookies.get(STUDIO_COOKIE)?.value ?? null;
  const session = await decodeSession(sessionToken);
  if (
    !session &&
    (request.nextUrl.pathname.startsWith("/admin") ||
      request.nextUrl.pathname.startsWith("/studio"))
  ) {
    return NextResponse.redirect(new URL("/mingla/session-expired", request.url));
  }
  if (!session) return response;
  const strippedDestination = strippedStudioDestination(
    request.nextUrl.pathname,
  );
  if (strippedDestination) {
    return NextResponse.redirect(new URL(strippedDestination, request.url));
  }
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
  matcher: ["/admin/:path*", "/studio/:path*", "/api/:path*", "/preview"],
};
