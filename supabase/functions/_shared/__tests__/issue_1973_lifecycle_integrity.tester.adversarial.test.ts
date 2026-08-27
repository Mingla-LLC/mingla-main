// [TEST-MOD-APPROVED #1973]
// Independent #1973 attacks: closed CAS, complete canonical readback, Nigerian
// currency parity, and executable Snap proposal compatibility.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool } from "../agentTools.ts";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("#1973 tester: every mutable existing experience action requires a revision", () => {
  for (
    const name of [
      "publish_experience",
      "update_experience",
      "manage_experience_stops",
      "unpublish_experience",
    ]
  ) {
    const tool = findTool(name);
    assert(tool, `${name} must be registered`);
    const required = tool.parameters.required as string[];
    assert(
      required.includes("expected_revision"),
      `${name} must reject a confirmation that omits compare-and-set revision`,
    );
  }
});

Deno.test("#1973 tester: canonical graph readback is complete and CAS cannot be disabled with null", async () => {
  const sql = await read(
    "supabase/migrations/20270408001973_issue_1973_ari_experience_lifecycle.sql",
  );
  const readback = sql.slice(
    sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.issue_1973_read_experience_graph",
    ),
    sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.issue_1973_current_experience_payload",
    ),
  );
  for (
    const field of [
      "cover_media_provider",
      "cover_media_source_url",
      "cover_media_credit",
      "cover_media_credit_url",
      "cover_media_alt",
      "cover_media_gallery",
    ]
  ) {
    assertStringIncludes(
      readback,
      field,
      `canonical readback missing ${field}`,
    );
  }
  assertStringIncludes(
    readback,
    "'theme',v_event.theme",
    "canonical readback must preserve theme-owned privacy/settings leaves",
  );
  assert(
    !sql.includes("p_expected_revision timestamptz DEFAULT NULL"),
    "database mutation boundaries must not permit null to bypass CAS",
  );
  assert(
    !sql.includes("p_expected_revision IS NOT NULL AND"),
    "a null revision must fail closed, not skip the revision comparison",
  );
});

Deno.test("#1973 tester: the effective canonical create owner supports a Nigerian brand", async () => {
  const sql = await read(
    "supabase/migrations/20270323001919_issue_1919_provider_neutral_paid_readiness.sql",
  );
  const start = sql.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.biz_create_experience(",
  );
  assert(start >= 0, "latest canonical create definition must exist");
  const body = sql.slice(start, sql.indexOf("\n$$;", start) + 4);
  assertStringIncludes(
    body,
    "'NGN'::bpchar",
    "Nigerian brands must not fail event_currency_unsupported",
  );
});

Deno.test("#1973 tester: parser-emitted restaurant Snap args confirm without a Play capacity leak", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (
        fn === "biz_brand_effective_rank_for_caller" ||
        fn === "biz_role_rank"
      ) {
        return { data: 40, error: null };
      }
      return {
        data: { event: { id: crypto.randomUUID(), status: "draft" } },
        error: null,
      };
    },
    from: () => {
      throw new Error("canonical create must not use direct table writers");
    },
  } as never;
  const tool = findTool("create_experience");
  assert(tool);
  await tool.executor(
    {
      brand_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Free tasting",
      narrative: "Two complimentary samples",
      temporaryCategory: "restaurant",
      capacity_max: 4,
      stops: [
        { name: "Sample A", price_cents: 0 },
        { name: "Sample B", price_cents: 0 },
      ],
    },
    client,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  );
  const payload = calls.at(-1)?.args.p_payload as Record<string, unknown>;
  assertEquals(
    payload.capacity,
    null,
    "restaurant Snap proposals must not acquire the Play-only capacity_max field",
  );
});
