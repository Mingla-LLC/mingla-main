import { expireFiles, handleExportWorkerRequest } from "./index.ts";

interface MarkerRow {
  id: string;
  status: "ready" | "expired";
  storage_path: string | null;
  prepared_storage_path: string | null;
  safe_error_code: string | null;
  expires_at: string;
}

function expiryService(
  rows: MarkerRow[],
  objects = new Set(
    rows.flatMap((row) =>
      [row.storage_path, row.prepared_storage_path].filter(
        (path): path is string => path !== null,
      )
    ),
  ),
  failRemove: Set<string> = new Set(),
  failMark: Set<string> = new Set(),
) {
  const removes: string[] = [];
  const marks: string[] = [];
  const builder = {
    select() {
      return this;
    },
    in() {
      return this;
    },
    or() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return {
    removes,
    marks,
    objects,
    service: {
      from() {
        return builder;
      },
      storage: {
        from() {
          return {
            remove(paths: string[]) {
              const path = paths[0];
              removes.push(path);
              const existed = failRemove.has(path)
                ? false
                : objects.delete(path);
              return Promise.resolve({
                data: existed ? [{ name: path }] : [],
                error: failRemove.has(path)
                  ? { message: "remove_failed" }
                  : null,
              });
            },
          };
        },
      },
      rpc(name: string, args: Record<string, string>) {
        if (name !== "biz_expire_brand_people_export") {
          throw new Error(`unexpected rpc: ${name}`);
        }
        const key = `${args.p_job_id}:${args.p_storage_path}`;
        marks.push(key);
        if (failMark.has(key)) {
          return Promise.resolve({ data: false, error: null });
        }
        const row = rows.find((entry) => entry.id === args.p_job_id);
        if (row?.storage_path === args.p_storage_path) row.storage_path = null;
        if (row?.prepared_storage_path === args.p_storage_path) {
          row.prepared_storage_path = null;
        }
        return Promise.resolve({ data: true, error: null });
      },
    },
  };
}

Deno.test("#1772 expiry cleanup deduplicates markers after no-error exact deletes", async () => {
  const rows: MarkerRow[] = [
    {
      id: "job-a",
      status: "expired",
      storage_path: "brand/shared.csv",
      prepared_storage_path: "brand/a.prepare.csv",
      safe_error_code: "privacy_erasure",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      id: "job-b",
      status: "expired",
      storage_path: "brand/shared.csv",
      prepared_storage_path: null,
      safe_error_code: "privacy_erasure",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
  ];
  const fake = expiryService(rows);
  const expired = await expireFiles(fake.service);
  if (
    expired !== 2 ||
    fake.removes.join(",") !== "brand/shared.csv,brand/a.prepare.csv" ||
    fake.marks.filter((entry) => entry.endsWith(":brand/shared.csv")).length !==
      2 ||
    rows.some((row) =>
      row.storage_path !== null || row.prepared_storage_path !== null
    )
  ) {
    throw new Error("both-marker cleanup was not deduplicated and exact");
  }
});

Deno.test("#1772 failed remove and crash-before-marker-clear converge on a later pass", async () => {
  const rows: MarkerRow[] = [{
    id: "job-c",
    status: "expired",
    storage_path: "brand/remove-fails.csv",
    prepared_storage_path: "brand/crash-window.csv",
    safe_error_code: "privacy_erasure",
    expires_at: "2099-01-01T00:00:00.000Z",
  }];
  const objects = new Set([
    "brand/remove-fails.csv",
    "brand/crash-window.csv",
  ]);
  const first = expiryService(
    rows,
    objects,
    new Set(["brand/remove-fails.csv"]),
    new Set(["job-c:brand/crash-window.csv"]),
  );
  if (
    await expireFiles(first.service) !== 0 ||
    rows[0].storage_path === null || rows[0].prepared_storage_path === null ||
    objects.has("brand/crash-window.csv")
  ) {
    throw new Error("failed/crashed cleanup cleared a durable marker");
  }
  const second = expiryService(rows, objects);
  if (
    await expireFiles(second.service) !== 1 ||
    rows[0].storage_path !== null || rows[0].prepared_storage_path !== null ||
    !second.removes.includes("brand/crash-window.csv")
  ) {
    throw new Error("later cleanup pass did not converge");
  }
});

function requestService(completion: "erased" | "ready") {
  const path = "brand/brand-a/job-a.csv";
  const objects = new Set<string>();
  const removed: string[] = [];
  let status: "queued" | "running" | "ready" | "expired" = "queued";
  let storagePath: string | null = null;
  let preparedPath: string | null = null;
  let safeCode: string | null = null;
  let retryCalls = 0;
  let erasurePass = -1;
  let service: Record<string, unknown>;

  const stateRow = () => ({
    id: "job-a",
    status,
    storage_path: storagePath,
    prepared_storage_path: preparedPath,
    prepared_checksum: "checksum-a",
    safe_error_code: safeCode,
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  const query = () => ({
    select() {
      return this;
    },
    in() {
      return this;
    },
    or() {
      return this;
    },
    limit() {
      return Promise.resolve({
        data: status === "expired" || status === "ready" ? [stateRow()] : [],
        error: null,
      });
    },
    eq() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: stateRow(), error: null });
    },
  });
  const storageBucket = {
    async upload(uploadPath: string) {
      if (completion === "erased") {
        status = "expired";
        safeCode = "privacy_erasure";
        erasurePass = await expireFiles(service);
        if (erasurePass !== 1 || preparedPath !== null) {
          throw new Error(
            "prepare-before-upload erasure did not clear its exact marker",
          );
        }
      }
      objects.add(uploadPath);
      return { data: { path: uploadPath }, error: null };
    },
    remove(paths: string[]) {
      const target = paths[0];
      removed.push(target);
      if (!objects.delete(target)) {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [{ name: target }], error: null });
    },
    download() {
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    },
  };
  service = {
    from() {
      return query();
    },
    storage: {
      from() {
        return storageBucket;
      },
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "biz_claim_brand_people_export_jobs") {
        status = "running";
        return Promise.resolve({
          data: [{
            id: "job-a",
            brand_id: "brand-a",
            export_kind: "brand_book",
            prepared_storage_path: null,
            prepared_row_count: null,
            prepared_checksum: null,
          }],
          error: null,
        });
      }
      if (name === "biz_brand_people_export_rows") {
        return Promise.resolve({
          data: [{ row_data: { personId: "person-a", name: "Ada" } }],
          error: null,
        });
      }
      if (name === "biz_heartbeat_brand_people_export") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "biz_prepare_brand_people_export_upload") {
        preparedPath = String(args.p_storage_path);
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "biz_complete_brand_people_export") {
        if (completion === "ready") {
          status = "ready";
          storagePath = path;
          preparedPath = null;
        }
        return Promise.resolve({
          data: null,
          error: { message: "response_lost" },
        });
      }
      if (name === "biz_expire_brand_people_export") {
        const exact = String(args.p_storage_path);
        const matched = storagePath === exact || preparedPath === exact;
        if (storagePath === exact) storagePath = null;
        if (preparedPath === exact) preparedPath = null;
        return Promise.resolve({ data: matched, error: null });
      }
      if (name === "biz_retry_or_fail_brand_people_export") {
        retryCalls += 1;
        return Promise.resolve({
          data: null,
          error: { message: "unexpected" },
        });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return {
    service,
    path,
    objects,
    removed,
    retryCalls: () => retryCalls,
    erasurePass: () => erasurePass,
    preparedPath: () => preparedPath,
  };
}

async function runRequest(fake: ReturnType<typeof requestService>) {
  const response = await handleExportWorkerRequest(
    new Request("https://worker.test", {
      method: "POST",
      headers: { authorization: "Bearer service-key" },
    }),
    {
      createService: () => fake.service,
      envGet: (name) =>
        name === "SUPABASE_URL" ? "https://example.test" : "service-key",
      randomUUID: () => "worker-a",
    },
  );
  return await response.json() as Record<string, number>;
}

Deno.test("#1772 erasure between prepare and upload clears the later exact object", async () => {
  const fake = requestService("erased");
  const body = await runRequest(fake);
  if (
    body.ready !== 0 || body.failed !== 0 || body.expired !== 0 ||
    fake.erasurePass() !== 1 || fake.preparedPath() !== null ||
    fake.objects.has(fake.path) || fake.retryCalls() !== 0 ||
    fake.removed.filter((entry) => entry === fake.path).length !== 2
  ) {
    throw new Error(
      `prepare/upload erasure race did not converge without retry: ${
        JSON.stringify({
          body,
          erasurePass: fake.erasurePass(),
          preparedCleared: fake.preparedPath() === null,
          objectRemaining: fake.objects.has(fake.path),
          retryCalls: fake.retryCalls(),
          exactRemoves: fake.removed.filter((entry) =>
            entry === fake.path
          ).length,
        })
      }`,
    );
  }
});

Deno.test("#1772 lost completion response preserves an observed ready export", async () => {
  const fake = requestService("ready");
  const body = await runRequest(fake);
  if (
    body.ready !== 1 || body.failed !== 0 || !fake.objects.has(fake.path) ||
    fake.removed.includes(fake.path) || fake.retryCalls() !== 0
  ) {
    throw new Error(
      "ambiguous completion deleted or retried an observed ready export",
    );
  }
});
