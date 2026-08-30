import { expireFiles } from "./index.ts";

interface MarkerRow {
  id: string;
  status: "expired";
  storage_path: string | null;
  prepared_storage_path: string | null;
  safe_error_code: "privacy_erasure";
  expires_at: string;
}

function partialFailureService(
  rows: MarkerRow[],
  objects: Set<string>,
  failingPaths: Set<string>,
) {
  const removals: string[] = [];
  const clears: string[] = [];
  const query = {
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
    removals,
    clears,
    service: {
      from() {
        return query;
      },
      storage: {
        from() {
          return {
            remove(paths: string[]) {
              const path = paths[0];
              removals.push(path);
              if (failingPaths.has(path)) {
                return Promise.resolve({
                  data: [],
                  error: { message: "scoped_remove_failed" },
                });
              }
              objects.delete(path);
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      },
      rpc(name: string, args: Record<string, string>) {
        if (name !== "biz_expire_brand_people_export") {
          throw new Error(`unexpected rpc: ${name}`);
        }
        const exact = `${args.p_job_id}:${args.p_storage_path}`;
        clears.push(exact);
        const row = rows.find((candidate) => candidate.id === args.p_job_id);
        if (row?.storage_path === args.p_storage_path) {
          row.storage_path = null;
        }
        if (row?.prepared_storage_path === args.p_storage_path) {
          row.prepared_storage_path = null;
        }
        return Promise.resolve({ data: true, error: null });
      },
    },
  };
}

Deno.test(
  "#1772 one marker's remove failure cannot roll back its sibling or erase the retry witness",
  async () => {
    const readyPath = "brand/job-partial-ready.csv";
    const blockedPath = "brand/job-partial-blocked.csv";
    const rows: MarkerRow[] = [{
      id: "job-partial",
      status: "expired",
      storage_path: readyPath,
      prepared_storage_path: blockedPath,
      safe_error_code: "privacy_erasure",
      expires_at: "2099-01-01T00:00:00.000Z",
    }];
    const objects = new Set([readyPath, blockedPath]);
    const first = partialFailureService(
      rows,
      objects,
      new Set([blockedPath]),
    );

    const firstExpired = await expireFiles(first.service);
    if (
      firstExpired !== 1 ||
      rows[0].storage_path !== null ||
      rows[0].prepared_storage_path !== blockedPath ||
      objects.has(readyPath) ||
      !objects.has(blockedPath) ||
      first.clears.join(",") !== `job-partial:${readyPath}` ||
      first.removals.join(",") !== `${readyPath},${blockedPath}`
    ) {
      throw new Error(
        "partial cleanup did not clear only the proven marker and retain the failed witness",
      );
    }

    const retry = partialFailureService(rows, objects, new Set());
    const retryExpired = await expireFiles(retry.service);
    if (
      retryExpired !== 1 ||
      rows[0].storage_path !== null ||
      rows[0].prepared_storage_path !== null ||
      objects.has(blockedPath) ||
      retry.removals.join(",") !== blockedPath ||
      retry.clears.join(",") !== `job-partial:${blockedPath}`
    ) {
      throw new Error("the retained marker did not converge on its next pass");
    }
  },
);
