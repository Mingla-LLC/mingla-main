// #4541 R8.4: the caller's address as the platform's edge reports it.
//
// The first x-forwarded-for hop is whatever the caller typed, so a limiter
// keyed on it can be dodged by sending a new value each time. This reads only
// the headers the platform's edge sets itself (cf-connecting-ip, then
// x-real-ip), normalised to one canonical public literal, and never reads a
// caller-supplied leading x-forwarded-for hop. With neither header (or a
// private, malformed or multi-value one) it returns "unknown", which the
// callers count in their own generous bucket so a platform header change can
// never lock every guest out (and is logged once per instance).

import { canonicalPublicIpLiteral } from "./sourceRefundClientIp.ts";

export const PLATFORM_IP_HEADERS = ["cf-connecting-ip", "x-real-ip"] as const;
export const UNKNOWN_CLIENT_IP = "unknown";

export function platformClientIp(req: Request): string {
  for (const name of PLATFORM_IP_HEADERS) {
    const raw = req.headers.get(name);
    if (raw === null) continue;
    const value = raw.trim();
    if (value.length === 0 || value.length > 64 || value.includes(",")) continue;
    const canonical = canonicalPublicIpLiteral(value);
    if (canonical !== null) return canonical;
  }
  return UNKNOWN_CLIENT_IP;
}
