export const evidence = (status = "proven") => ({
  status,
  summary: `${status} evidence`,
  source_class: "provider_api",
  source_checked_at: "2026-08-12T12:00:00.000Z",
});

export const provider = (name, verdict = "ready") => ({
  provider: name,
  verdict,
  reason_code: verdict === "ready" ? "all_required_dimensions_proven" : "native_binding_missing",
  owner_label: verdict === "ready" ? null : "Engineering",
  action_code: verdict === "ready" ? null : "review_mingla_configuration",
  action_href: null,
  evidence: {
    payer: evidence(),
    identity: ["meta", "tiktok"].includes(name) ? evidence() : evidence("not_applicable"),
    binding: evidence(),
    measurement: evidence(),
    funding: evidence(),
  },
});

const target = (app_key, os, store_identifier, appsflyer_app_id) => ({
  app_key, os, display_name: app_key === "explorer" ? "Mingla Explorer" : "Mingla Business",
  store_identifier, appsflyer_app_id, needs_check: false,
  latest: { run_id: `${app_key}-${os}`, checked_at: "2026-08-12T12:00:00.000Z", stale_at: "2026-08-12T12:15:00.000Z", duration_ms: 200, results: ["meta","tiktok","snapchat","google","reddit"].map((name) => provider(name)) },
});

export const response = {
  contract_version: 1,
  server_now: "2026-08-12T12:05:00.000Z",
  targets: [
    target("explorer", "ios", "6760440898", "id6760440898"),
    target("explorer", "android", "com.mingla.app.v2", "com.mingla.app.v2"),
    target("business", "ios", "6768737367", "id6768737367"),
    target("business", "android", "com.sethogieva.minglabusiness", "com.sethogieva.minglabusiness"),
  ],
};
