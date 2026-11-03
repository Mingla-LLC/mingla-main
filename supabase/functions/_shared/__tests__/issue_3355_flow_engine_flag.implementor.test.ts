// Issue #3355: the flow engine switch is the `ari_flow_engine` feature flag,
// not a production secret (the secret budget is full). These pin the reader:
// env override for local/eval, the flag row otherwise, off on any failure,
// and one read per 15 s per isolate.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  FLOW_ENGINE_FLAG_KEY,
  readFlowEngineEnabled,
  resetFlowEngineFlagCache,
} from "../ariFlows/store.ts";

function fakeService(
  row: unknown,
  opts: { error?: boolean; throws?: boolean } = {},
): { client: SupabaseClient; reads: string[] } {
  const reads: string[] = [];
  const client = {
    from(table: string) {
      if (opts.throws) throw new Error("network");
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          reads.push(`${table}:${value}`);
          return query;
        },
        maybeSingle: () =>
          Promise.resolve(
            opts.error
              ? { data: null, error: { message: "denied" } }
              : { data: row, error: null },
          ),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, reads };
}

Deno.test("#3355 flow engine flag: on only when the ari_flow_engine row is enabled", async () => {
  resetFlowEngineFlagCache();
  const on = fakeService({ is_enabled: true });
  assertEquals(await readFlowEngineEnabled(on.client, undefined, 1_000), true);
  assertEquals(on.reads, [`feature_flags:${FLOW_ENGINE_FLAG_KEY}`]);
  resetFlowEngineFlagCache();
  const off = fakeService({ is_enabled: false });
  assertEquals(
    await readFlowEngineEnabled(off.client, undefined, 1_000),
    false,
  );
  resetFlowEngineFlagCache();
  const missing = fakeService(null);
  assertEquals(
    await readFlowEngineEnabled(missing.client, undefined, 1_000),
    false,
  );
});

Deno.test("#3355 flow engine flag: a failed read is off, never on", async () => {
  resetFlowEngineFlagCache();
  assertEquals(
    await readFlowEngineEnabled(
      fakeService(null, { error: true }).client,
      undefined,
      1_000,
    ),
    false,
  );
  resetFlowEngineFlagCache();
  assertEquals(
    await readFlowEngineEnabled(
      fakeService(null, { throws: true }).client,
      undefined,
      1_000,
    ),
    false,
  );
});

Deno.test("#3355 flow engine flag: ARI_FLOW_ENGINE=on overrides for local and eval runs", async () => {
  resetFlowEngineFlagCache();
  const off = fakeService({ is_enabled: false });
  assertEquals(await readFlowEngineEnabled(off.client, "on", 1_000), true);
  assertEquals(off.reads, []);
});

Deno.test("#3355 flow engine flag: one read per 15 s per isolate", async () => {
  resetFlowEngineFlagCache();
  const on = fakeService({ is_enabled: true });
  await readFlowEngineEnabled(on.client, undefined, 1_000);
  await readFlowEngineEnabled(on.client, undefined, 15_999);
  assertEquals(on.reads.length, 1);
  await readFlowEngineEnabled(on.client, undefined, 16_000);
  assertEquals(on.reads.length, 2);
});
