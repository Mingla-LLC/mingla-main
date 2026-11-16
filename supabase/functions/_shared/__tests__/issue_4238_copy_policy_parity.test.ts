/**
 * #4238 W3 T-5 — one copy checker for Admin, Host and Ari.
 *
 * The shared port (_shared/adCopyPolicy.ts) and Admin's browser copy
 * (mingla-admin/src/lib/adBuilder/policyLinter.js) must give exactly the
 * fixture's `expected` findings for every case, and each other's. Any drift
 * in either copy fails here (and in Admin's node:test twin).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  hostCopyText,
  hostCopyWarnings,
  runPolicyPrecheck,
} from "../adCopyPolicy.ts";

// Admin's plain-JS browser copy, loaded untyped (it has no declarations).
const adminUrl = new URL(
  "../../../../mingla-admin/src/lib/adBuilder/policyLinter.js",
  import.meta.url,
).href;
const admin: Record<string, unknown> = await import(adminUrl);
const adminPrecheck = admin.runPolicyPrecheck as (input: unknown) => unknown;

type Case = {
  copyText: string;
  channelSet: string[];
  expected: unknown;
};

const fixture = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/ad_copy_policy_cases.json", import.meta.url),
  ),
) as { cases: Case[] };

Deno.test("T-5 parity: the shared checker gives the fixture findings on every case", () => {
  for (const item of fixture.cases) {
    assertEquals(
      runPolicyPrecheck({
        copyText: item.copyText,
        channelSet: item.channelSet,
      }),
      item.expected,
      item.copyText,
    );
  }
});

Deno.test("T-5 parity: Admin's browser copy gives the same findings as the shared checker", () => {
  for (const item of fixture.cases) {
    const input = { copyText: item.copyText, channelSet: item.channelSet };
    assertEquals(
      adminPrecheck(input),
      runPolicyPrecheck(input),
      item.copyText,
    );
  }
});

Deno.test("T-5 parity: the exported messages are identical", async () => {
  const shared = await import("../adCopyPolicy.ts");
  assertEquals(shared.DATING_GUIDANCE, admin.DATING_GUIDANCE);
  assertEquals(shared.ALCOHOL_WARNING, admin.ALCOHOL_WARNING);
  assertEquals(
    shared.PERSONAL_ATTRIBUTES_EXAMPLES,
    admin.PERSONAL_ATTRIBUTES_EXAMPLES,
  );
});

Deno.test("SC-T5: Meta personal attributes, Reddit dating, alcohol", () => {
  const single = hostCopyWarnings({ primary: "Are you single?" }, ["meta"]);
  assertEquals(
    single.some((w) =>
      w.kind === "personal_attributes" && w.platforms[0] === "meta"
    ),
    true,
  );
  const dating = hostCopyWarnings({ headline: "meet someone tonight" }, [
    "reddit",
  ]);
  assertEquals(dating.map((w) => w.kind), ["dating"]);
  // Reddit's dating rule only applies when Reddit is chosen.
  assertEquals(
    hostCopyWarnings({ headline: "meet someone tonight" }, ["meta"]),
    [],
  );
  const beer = hostCopyWarnings({ primary: "Ice cold beer, live music" }, [
    "snapchat",
    "meta",
  ]);
  assertEquals(beer.map((w) => [w.kind, w.platforms]), [["alcohol", [
    "snapchat",
  ]]]);
});

Deno.test("T-5: Host words are joined the same way for every field", () => {
  assertEquals(
    hostCopyText({
      headline: "A",
      primary: " ",
      description: "B",
      last_tickets: "C",
      cta: "X",
    }),
    "A\nB\nC",
  );
  assertEquals(hostCopyText(null), "");
});

Deno.test("T-5 adversarial: warn-only — create_version never refuses for copy_warnings", async () => {
  const src = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const at = src.indexOf("const copyWarnings = hostCopyWarnings(");
  assertEquals(at > 0, true);
  // Between computing the warnings and the version RPC there is no refusal
  // keyed on them; they ride on the 201 response.
  const slice = src.slice(
    at,
    src.indexOf('db.rpc("ad_plan_create_version"', at),
  );
  assertEquals(/copyWarnings[^;]*\)\s*return json\(/.test(slice), false);
  assertEquals(/if \(copyWarnings/.test(slice), false);
  assertEquals(src.includes("copy_warnings: copyWarnings"), true);
});
