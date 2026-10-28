import { emitCmsObservation } from "./observability";

/*
 * #2829 W10 — every preview Studio builds is reported to Core as the site's
 * newest preview: it is what the site's private share links show (an agency
 * shares the draft with its client; the client sees the latest preview, not a
 * frozen one). A failed report never breaks the preview the owner opened; it
 * is observed, and the share link keeps showing the previous preview.
 */
type Report = (path: string, siteId: string, operationId: string, payload: Record<string, unknown>) => Promise<unknown>;

const reportToCore: Report = async (path, siteId, operationId, payload) =>
  (await import("./gateway")).callCore(path, siteId, operationId, payload);

export async function reportPreviewBuilt(
  siteId: string,
  artifactKey: string,
  report: Report = reportToCore,
): Promise<boolean> {
  try {
    await report(`/internal/v1/sites/${siteId}/preview-artifacts`, siteId, crypto.randomUUID(), {
      artifact_key: artifactKey,
    });
    return true;
  } catch (error) {
    emitCmsObservation({
      event: "mingla_sites_state",
      metric: "cms.preview_built.report_failed",
      request_id: crypto.randomUUID(),
      operation_id: null,
      site_id: siteId,
      publication_id: null,
      direction: "cms_to_core",
      route: "/internal/v1/sites/{siteId}/preview-artifacts",
      state_transition: "preview_built->report_failed",
      latency_ms: 0,
      retry_count: 0,
      safe_error_code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "CORE_UNAVAILABLE",
      status_code: null,
      version: "sites-v1",
    });
    return false;
  }
}
