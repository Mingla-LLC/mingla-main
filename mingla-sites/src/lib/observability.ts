export type PublicObservation = {
  event: "mingla_sites_request" | "mingla_sites_state";
  metric: string;
  request_id: string;
  operation_id: string | null;
  site_id: string | null;
  publication_id: string | null;
  direction: "public_runtime";
  route: string;
  state_transition: string;
  latency_ms: number;
  retry_count: number;
  safe_error_code: "NOT_FOUND" | "ARTIFACT_DIGEST_MISMATCH" | null;
  status_code: number | null;
  version: "sites-v1";
};

export function emitPublicObservation(observation: PublicObservation): void {
  console.info(JSON.stringify(observation));
}
