export type BlogReferenceDocument = { version?: unknown; blocks?: unknown };
export type LinkCheckReference = { url: string; source: string };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function collectBlogLinkReferences(
  document: BlogReferenceDocument,
  marketingOrigin = "https://usemingla.com",
): LinkCheckReference[] {
  const blocks = Array.isArray(document?.blocks) ? document.blocks : [];
  const found: LinkCheckReference[] = [];
  const add = (value: unknown, source: string) => {
    if (typeof value !== "string" || !value.trim()) return;
    const raw = value.trim();
    const url = raw.startsWith("/") ? `${marketingOrigin}${raw}` : raw;
    if (!found.some((entry) => entry.url === url)) found.push({ url, source });
  };
  for (const candidate of blocks) {
    if (!candidate || typeof candidate !== "object") continue;
    const block = candidate as Record<string, unknown>;
    const type = block.type;
    if (type === "city") add(`/cities/${String(block.citySlug ?? "")}`, "city");
    if (type === "embed") add(block.url, "embed");
    if (type === "button") {
      const target = block.target as Record<string, unknown> | undefined;
      if (target?.kind === "url") add(target.href, "button");
      if (target?.kind === "page") add(target.path, "button");
    }
    if (["paragraph", "quote", "callout"].includes(String(type))) {
      collectRichTextLinks(block.html, (url) => add(url, "rich_text"));
    }
    if (type === "list" && Array.isArray(block.items)) {
      for (const item of block.items) collectRichTextLinks(item, (url) => add(url, "rich_text"));
    }
  }
  return found.slice(0, 60);
}

function collectRichTextLinks(value: unknown, add: (url: string) => void) {
  if (typeof value !== "string") return;
  for (const match of value.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    add(match[1] ?? match[2] ?? "");
  }
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const match = (mapped ?? normalized).match(IPV4);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}

export function validateLinkCheckUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("https_required");
  if (url.username || url.password) throw new Error("credentials_forbidden");
  if (isPrivateAddress(url.hostname)) throw new Error("private_address");
  return url;
}

export function classifyLinkStatus(status: number): boolean {
  return status >= 200 && status <= 399;
}

export function isBlogNotReadyError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const text = `${String(value?.code ?? "")} ${String(value?.message ?? "")} ${String(value?.details ?? "")}`;
  return /42P01|PGRST20[245]|function .* does not exist|relation .* does not exist/i.test(text);
}
