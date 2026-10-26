// ORCH-0977 / #4111 — the one content-moderation call.
//
// Moved verbatim from moderate-content/index.ts so server-side callers (the
// #4111 public enquiry form) and the client-facing moderate-content endpoint
// share one implementation. Uses OpenAI's Moderation endpoint. On any
// infrastructure failure (missing key, network error, provider outage) the
// result is `flagged: false` with `checked: false` and a `failure` code, so a
// moderation outage never blocks messaging — callers that must not fail open
// silently log the failure code.

export type ModerationFailure =
  | "key_missing"
  | "provider_status"
  | "network_or_parse";

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  checked: boolean;
  failure?: ModerationFailure;
  providerStatus?: number;
}

export interface ModerationOptions {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}

export async function moderateText(
  text: string,
  options: ModerationOptions = {},
): Promise<ModerationResult> {
  // Empty / whitespace-only text is never objectionable.
  if (!text.trim()) {
    return { flagged: false, categories: [], checked: true };
  }
  const apiKey = options.apiKey !== undefined
    ? options.apiKey
    : Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return { flagged: false, categories: [], checked: false, failure: "key_missing" };
  }
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: text.slice(0, 4000),
      }),
    });
    if (!res.ok) {
      return {
        flagged: false,
        categories: [],
        checked: false,
        failure: "provider_status",
        providerStatus: res.status,
      };
    }
    const data = await res.json();
    const result = data?.results?.[0];
    const flagged = result?.flagged === true;
    const categories: string[] = flagged && result?.categories
      ? Object.entries(result.categories)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
      : [];
    return { flagged, categories, checked: true };
  } catch {
    return { flagged: false, categories: [], checked: false, failure: "network_or_parse" };
  }
}
