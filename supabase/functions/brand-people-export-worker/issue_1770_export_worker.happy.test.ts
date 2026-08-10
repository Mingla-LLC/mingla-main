const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("issue #1770 export worker owns leases, deterministic upload, and expiry", () => {
  for (
    const token of [
      'request.headers.get("authorization") !== `Bearer ${serviceKey}`',
      '"biz_claim_brand_people_export_jobs"',
      '"biz_heartbeat_brand_people_export"',
      '"biz_prepare_brand_people_export_upload"',
      '"biz_complete_brand_people_export"',
      '"biz_retry_or_fail_brand_people_export"',
      "persistExportFailure",
      "heartbeatError || heartbeat !== true",
      'error: "export_failure_persistence_unproven"',
      'state: "unknown"',
      "failed: 0",
      "`brand/${job.brand_id}/${job.id}.csv`",
      ".download(storagePath)",
      ").remove(paths)",
    ]
  ) {
    if (!source.includes(token)) {
      throw new Error(`missing worker contract: ${token}`);
    }
  }
  if (
    source.includes(
      'await service.rpc("biz_heartbeat_brand_people_export"',
    ) ||
    source.includes(
      'await service.rpc("biz_retry_or_fail_brand_people_export"',
    )
  ) {
    throw new Error("lease/failure persistence result became unchecked");
  }
  for (const forbidden of ["console.log", "requested_by", "storagePath:"]) {
    if (source.includes(forbidden)) {
      throw new Error(`unsafe worker output: ${forbidden}`);
    }
  }
});
