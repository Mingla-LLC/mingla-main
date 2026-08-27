import type { NormalizedCompetitorSource } from "./competitorSourceIdentity.ts";

export interface WebsiteObservationFacts {
  profile: { name?: string; bio?: string; outbound_urls: string[] };
  site_signals: {
    title_present: boolean;
    description_present: boolean;
    outbound_link_count: number;
  };
}
const PRIVATE =
  /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/i;
const PRIVATE_V6 = /^(?:::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;
const MAX_REDIRECTS = 3;
type Resolver = (
  hostname: string,
  recordType: "A" | "AAAA",
) => Promise<string[]>;
const defaultResolver: Resolver = (hostname, recordType) =>
  Deno.resolveDns(hostname, recordType) as Promise<string[]>;
async function assertPublicDns(
  hostname: string,
  resolver: Resolver,
): Promise<void> {
  const resolved: string[] = [];
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      resolved.push(...await resolver(hostname, recordType));
    } catch { /* A host may legitimately publish only one address family. */ }
  }
  if (
    !resolved.length ||
    resolved.some((address) =>
      PRIVATE.test(address) || PRIVATE_V6.test(address)
    )
  ) throw new Error("invalid");
}
async function assertPublicTarget(url: URL, resolver: Resolver): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) || url.username ||
    url.password || PRIVATE.test(hostname) || PRIVATE_V6.test(hostname)
  ) throw new Error("invalid");
  await assertPublicDns(hostname, resolver);
}
async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > 2_000_000) {
        await reader.cancel();
        throw new Error("unsupported");
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
export async function observeCompetitorWebsite(
  source: NormalizedCompetitorSource,
  fetcher: typeof fetch = fetch,
  resolver: Resolver = defaultResolver,
): Promise<
  {
    facts: WebsiteObservationFacts;
    checkedAt: string;
    latestObservedAt: string | null;
  }
> {
  if (source.kind !== "website") throw new Error("invalid");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    let current = new URL(source.normalizedUrl);
    let response: Response | null = null;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertPublicTarget(current, resolver);
      response = await fetcher(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === MAX_REDIRECTS) {
        throw new Error("unreachable");
      }
      try {
        current = new URL(location, current);
      } catch {
        throw new Error("invalid");
      }
    }
    if (!response) throw new Error("unreachable");
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "removed"
          : response.status === 429
          ? "rate_limited"
          : "unreachable",
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) throw new Error("unsupported");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 2_000_000) throw new Error("unsupported");
    const html = await readBoundedText(response);
    const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ").trim();
    const description = html.match(
      /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']{1,500})/i,
    )?.[1]?.trim();
    const links = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)]
      .slice(0, 10).map((match) => match[1]);
    return {
      facts: {
        profile: {
          ...(title ? { name: title } : {}),
          ...(description ? { bio: description } : {}),
          outbound_urls: links,
        },
        site_signals: {
          title_present: Boolean(title),
          description_present: Boolean(description),
          outbound_link_count: links.length,
        },
      },
      checkedAt: new Date().toISOString(),
      latestObservedAt: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
