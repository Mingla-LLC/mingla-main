import { signedCorePost, type SiteBinding } from "./coreGateway";
import { emitPublicObservation } from "./observability";
import type { EnquiryAvailability } from "./siteForms";

/*
 * #2829 W5 (amendment A4) — whether a brand takes messages right now, as
 * Mingla's brand page decides it (#4111's enquiries switch and "someone is
 * there to read it"). A site hides its contact form when the answer is
 * "unavailable". Cached 60 s per site. When Core cannot answer, the answer is
 * "unknown" and the form stays: a send Mingla refuses is shown to the
 * visitor, never swallowed. Every failed read is logged.
 */
export const ENQUIRY_STATUS_FRESH_MS = 60_000;
const TIMEOUT_MS = 2_000;

const cache = new Map<string, { value: EnquiryAvailability; at: number }>();

export function clearEnquiryAvailabilityCache(): void {
  cache.clear();
}

export type EnquiryStatusFetcher = (site: SiteBinding) => Promise<EnquiryAvailability>;

export const fetchEnquiryStatus: EnquiryStatusFetcher = async (site) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await Promise.race([
      signedCorePost({
        edgeFunction: "brand-site-runtime-resolve",
        path: `/internal/v1/sites/${site.site_id}/enquiry-status`,
        site,
        body: { site_id: site.site_id },
      }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("STATUS_TIMEOUT")))),
    ]);
    if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
    const payload = await response.json() as { ok?: unknown; data?: { status?: unknown } };
    const status = payload?.data?.status;
    if (payload?.ok !== true || (status !== "available" && status !== "unavailable" && status !== "unknown")) {
      throw new Error("STATUS_UNAVAILABLE");
    }
    return status;
  } finally {
    clearTimeout(timer);
  }
};

export async function enquiryAvailability(
  site: SiteBinding,
  deps: { fetcher?: EnquiryStatusFetcher; now?: () => number } = {},
): Promise<EnquiryAvailability> {
  const now = deps.now ?? Date.now;
  const cached = cache.get(site.site_id);
  if (cached && now() - cached.at < ENQUIRY_STATUS_FRESH_MS) return cached.value;
  try {
    const value = await (deps.fetcher ?? fetchEnquiryStatus)(site);
    cache.set(site.site_id, { value, at: now() });
    return value;
  } catch {
    emitPublicObservation({
      event: "mingla_sites_state",
      metric: "public.forms.enquiry_status_unknown",
      request_id: crypto.randomUUID(),
      operation_id: null,
      site_id: site.site_id,
      publication_id: null,
      direction: "public_runtime",
      route: "/forms/enquiry-status",
      state_transition: "status_unavailable->form_kept",
      latency_ms: 0,
      retry_count: 0,
      safe_error_code: null,
      status_code: null,
      version: "sites-v1",
    });
    return "unknown";
  }
}
