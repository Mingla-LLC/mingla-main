const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

function expandIpv6(value: string): number[] | null {
  if (value.includes("%") || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  let source = value;
  const mappedIndex = source.lastIndexOf(":");
  if (source.includes(".")) {
    const v4 = parseIpv4(source.slice(mappedIndex + 1));
    if (!v4) return null;
    source = `${source.slice(0, mappedIndex)}:${
      ((v4[0] << 8) | v4[1]).toString(16)
    }:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  if ((source.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw = ""] = source.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-fA-F]{1,4}$/.test(part))) {
    return null;
  }
  if (!source.includes("::") && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (source.includes("::") && missing < 1) return null;
  const parts = [
    ...left.map((part) => parseInt(part, 16)),
    ...Array(Math.max(0, missing)).fill(0),
    ...right.map((part) => parseInt(part, 16)),
  ];
  return parts.length === 8 ? parts : null;
}

function canonicalIpv6(parts: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < parts.length;) {
    if (parts[index] !== 0) {
      index++;
      continue;
    }
    let end = index;
    while (end < parts.length && parts[end] === 0) end++;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const hex = parts.map((part) => part.toString(16));
  if (bestStart < 0) return hex.join(":");
  const before = hex.slice(0, bestStart).join(":");
  const after = hex.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}

function publicIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  if (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) return false;
  return true;
}

function publicIpv6(parts: number[]): boolean {
  if (
    parts.every((part) => part === 0) ||
    parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1
  ) {
    return false;
  }
  const first = parts[0];
  if (
    (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && parts[1] === 0x0db8)
  ) {
    return false;
  }
  return (first & 0xe000) === 0x2000;
}

export function canonicalPublicIpLiteral(value: string): string | null {
  if (
    !value || CONTROL_RE.test(value) ||
    value.includes(":") && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)
  ) {
    return null;
  }
  let literal = value;
  if (literal.startsWith("[") && literal.endsWith("]")) {
    literal = literal.slice(1, -1);
  } else if (literal.startsWith("[") || literal.endsWith("]")) {
    return null;
  }
  const v4 = parseIpv4(literal);
  if (v4) return publicIpv4(v4) ? v4.join(".") : null;
  const v6 = expandIpv6(literal);
  if (!v6) return null;
  if (
    v6.slice(0, 5).every((part) => part === 0) &&
    v6[5] === 0xffff
  ) {
    const mapped = [
      v6[6] >> 8,
      v6[6] & 255,
      v6[7] >> 8,
      v6[7] & 255,
    ];
    return publicIpv4(mapped) ? mapped.join(".") : null;
  }
  return publicIpv6(v6) ? canonicalIpv6(v6) : null;
}

export function sourceRefundClientIp(
  xForwardedFor: string | null,
): string | null {
  if (
    !xForwardedFor || xForwardedFor.length > 512 ||
    CONTROL_RE.test(xForwardedFor)
  ) {
    return null;
  }
  const hops = xForwardedFor.split(",");
  if (hops.length > 8) return null;
  let first: string | null = null;
  for (let index = 0; index < hops.length; index++) {
    const hop = hops[index].replace(/^[ \t]+|[ \t]+$/g, "");
    if (!hop) return null;
    const parsed = canonicalPublicIpLiteral(hop);
    if (index === 0) {
      if (!parsed) return null;
      first = parsed;
    } else {
      const literal = hop.startsWith("[") && hop.endsWith("]")
        ? hop.slice(1, -1)
        : hop;
      if (!parseIpv4(literal) && !expandIpv6(literal)) return null;
    }
  }
  return first;
}
