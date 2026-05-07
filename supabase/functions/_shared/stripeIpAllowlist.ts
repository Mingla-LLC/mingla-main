interface CidrRange {
  base: number;
  mask: number;
}

const STRIPE_IPV4_CIDRS = [
  "3.18.12.63/32",
  "3.130.192.231/32",
  "13.235.14.237/32",
  "13.235.122.149/32",
  "18.211.135.69/32",
  "35.154.171.200/32",
  "52.15.183.38/32",
  "54.88.130.119/32",
  "54.88.130.237/32",
  "54.187.174.169/32",
  "54.187.205.235/32",
  "54.187.216.72/32",
] as const;

const STRIPE_RANGES = STRIPE_IPV4_CIDRS.map(parseCidr);

function parseIpv4(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) + n;
  }
  return out >>> 0;
}

function parseCidr(cidr: string): CidrRange {
  const [ip, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  const parsed = parseIpv4(ip);
  if (parsed === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    throw new Error(`Invalid IPv4 CIDR: ${cidr}`);
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: parsed & mask, mask };
}

export function extractClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null;
}

export function isStripeSourceIp(ip: string | null): boolean {
  if (!ip) return false;
  const parsed = parseIpv4(ip);
  if (parsed === null) return false;
  return STRIPE_RANGES.some((range) => (parsed & range.mask) === range.base);
}

export function verifyStripeSourceIp(req: Request): boolean {
  return isStripeSourceIp(extractClientIp(req));
}

export const STRIPE_WEBHOOK_IPV4_CIDRS = STRIPE_IPV4_CIDRS;
