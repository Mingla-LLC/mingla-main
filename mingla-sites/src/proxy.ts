import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "./lib/csp";

/*
 * A fresh nonce per request, which is why every page in this app is
 * force-dynamic: Next.js can only stamp a nonce onto its bootstrap scripts
 * while it is rendering a real request.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({
    nonce,
    pathname: request.nextUrl.pathname,
    dev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the nonce back out of this header to stamp its own scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except API routes and static assets. /preview is included
      // on purpose: the draft has to be interactive too.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
