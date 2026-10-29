import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  featureGuideCatalogFromContract,
  featureGuideCatalogFromSql,
  featureGuideImpactVerdict,
  mergeFeatureGuideCatalogs,
  parseFeatureGuide,
} from "../../../.github/scripts/release-records/lib.mjs";

// Structural companion proof for the four #4179 invariants owned by the
// PostgreSQL 17 regression below.

const root = new URL("../../../", import.meta.url);
const migrationPath = new URL(
  "../20280209004179_issue_4179_feature_guide_merge_reconciliation.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationPath);

function taggedJson(tag: string): unknown[] {
  const match = sql.match(
    new RegExp(`\\$${tag}\\$\\n([\\s\\S]*?)\\n\\$${tag}\\$::jsonb`),
  );
  assert(match, `${tag} payload is present`);
  return JSON.parse(match[1]);
}

const review = taggedJson("merge_review") as Array<{
  pr: number;
  disposition: "existing" | "new";
  capability_keys: string[];
}>;
const guide = taggedJson("guide") as Array<{
  capability_key: string;
  is_new: boolean;
  claimed_status?: "planned" | "live" | "retired";
  title: string;
  outcome_summary: string;
  how_to: string;
  limitations: string;
  support_wording: string;
}>;
const noEffectBlock = sql.match(
  /FROM unnest\(ARRAY\[([\s\S]*?)\]::integer\[\]\) pr/,
);
assert(noEffectBlock, "no-effect merge list is present");
const noEffect = [...noEffectBlock[1].matchAll(/\d+/g)].map((match) =>
  Number(match[0])
);

const expectedPrs = `
3984 3983 3986 3987 3989 3979 3990 3991 3993 3994 3992 3996 4000 3998
4002 4003 4004 3985 4007 4006 4005 4010 4009 4016 4017 4019 4014 4008
4013 4021 4015 4024 4031 4032 4028 4011 4033 4022 4034 4035 4030 4042
4041 4044 4046 4050 4051 4036 4025 4038 4053 4054 4055 4052 4039 4049
4056 4059 4060 4061 4065 4068 4067 4071 4072 4070 4075 4057 4088 4074
4089 4083 4076 4090 4091 4081 4078 4092 4066 4093 4094 4097 4098 4096
4077 4099 4100 4101 4085 4103 4105 4106 4107 4109 4108 4110 4113 4112
4115 4116 4117 4123 4124 4125 4126 4127 4128 4129 4132 4131 4133 4135
4136 4138 4139 4141 4142 4140 4146 4145 4147 4152 4153 4149 4148 4154
4157 4155 4158 4161 4163 4156 4165 4166 4164 4167 4162 4169 4170 4172
4175 4181 4178 4176
`.trim().split(/\s+/).map(Number);

Deno.test("#4179 classifies the sealed 144-merge window exactly once", () => {
  const actual = [...review.map((row) => row.pr), ...noEffect];
  assertEquals(actual.length, 144);
  assertEquals(new Set(actual).size, 144);
  assertEquals(
    [...actual].sort((a, b) => a - b),
    [...expectedPrs].sort((a, b) => a - b),
  );
  assertEquals(review.length, 95);
  assertEquals(noEffect.length, 49);
  assert(review.every((row) => ["existing", "new"].includes(row.disposition)));
  assert(review.every((row) => row.capability_keys.length > 0));
});

Deno.test("#4179 first-parent range agrees with the sealed review when git and history are available", async () => {
  const baseline = "c604fb6931ecb00c939ead8023198a7648bba606";
  const head = "896d0482f669d9e0d9f407c6b05a7bc5617010d7";
  const runPermission = await Deno.permissions.query({ name: "run", command: "git" });
  if (runPermission.state !== "granted") return;
  const present = await new Deno.Command("git", {
    cwd: root,
    args: ["cat-file", "-e", `${baseline}^{commit}`],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!present.success) return;
  const result = await new Deno.Command("git", {
    cwd: root,
    args: [
      "log",
      "--first-parent",
      "--format=%H%x09%s",
      `${baseline}..${head}`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(result.success, new TextDecoder().decode(result.stderr));
  const exceptional = new Map([
    ["896d0482f669d9e0d9f407c6b05a7bc5617010d7", 4176],
    ["43948aa85f192dd3d966c333f4ca0d331cd88f81", 4172],
    ["4a87cf286f61fa13d6664af323a47f8dba937bd0", 4083],
    ["33fd9b24bb75b0f9206a8f21e09f6a4bbb4766ce", 4041],
  ]);
  const fromGit = new TextDecoder().decode(result.stdout).trim().split("\n")
    .map((line) => {
      const [sha, subject] = line.split("\t", 2);
      const suffix = subject.match(/\(#(\d+)\)$/);
      return suffix ? Number(suffix[1]) : exceptional.get(sha);
    });
  assertEquals(fromGit.length, 144);
  assert(fromGit.every((pr): pr is number => typeof pr === "number"));
  assertEquals(
    [...fromGit].sort((a, b) => a - b),
    [...expectedPrs].sort((a, b) => a - b),
  );
});

Deno.test("#4179 maps only to known or newly declared capability keys", async () => {
  const allMigrationNames: string[] = [];
  for await (const entry of Deno.readDir(new URL("../", import.meta.url))) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      allMigrationNames.push(entry.name);
    }
  }
  const known = new Set<string>();
  for (const name of allMigrationNames) {
    const source = await Deno.readTextFile(
      new URL(`../${name}`, import.meta.url),
    );
    for (const match of source.matchAll(/"capability_key"\s*:\s*"([^"]+)"/g)) {
      known.add(match[1]);
    }
    for (
      const match of source.matchAll(
        /'([a-z0-9]+(?:-[a-z0-9]+)+)'\s*,\s*'[^']+'/g,
      )
    ) {
      if (
        [
          "official-brand-groups",
          "brand-files-and-guides",
          "product-inbox-avengers",
        ].includes(match[1])
      ) known.add(match[1]);
    }
  }
  const declaredNew = new Set(
    guide.filter((row) => row.is_new).map((row) => row.capability_key),
  );
  assertEquals([...declaredNew].sort(), [
    "account-app-updates",
    "brand-customer-enquiries",
    "staff-mingla-money",
    "web-blog",
  ]);
  for (const row of review) {
    for (const key of row.capability_keys) {
      assert(
        known.has(key) || declaredNew.has(key),
        `unknown capability ${key} for PR #${row.pr}`,
      );
    }
  }
});

Deno.test("#4179 removes stale claims and keeps merged-but-unreleased native work honest", () => {
  assertEquals(guide.length, 32);
  assertEquals(new Set(guide.map((row) => row.capability_key)).size, 32);
  const byKey = new Map(guide.map((row) => [row.capability_key, row]));
  const paystack = JSON.stringify(byKey.get("trips-installments"));
  assert(paystack.includes("eligible Nigerian Paystack"));
  assert(!paystack.includes("Paystack) brands cannot"));
  assert(!paystack.includes("not available for brands paid out in Nigeria"));
  assertEquals(byKey.get("events-ticket-transfers")?.claimed_status, "planned");
  assertEquals(byKey.get("account-app-updates")?.claimed_status, "planned");
  assertEquals(byKey.get("sites-brand-website")?.claimed_status, "live");
  assertEquals(byKey.get("programs-creators")?.claimed_status, "live");
  for (
    const key of [
      "discover-events",
      "discover-stays",
      "discover-swipe-deck",
      "discover-trips",
    ]
  ) {
    const limitations = byKey.get(key)?.limitations.toLowerCase() ?? "";
    assert(limitations.includes("staff"), key);
    assert(limitations.includes("test"), key);
    assert(limitations.includes("demo"), key);
    assert(limitations.includes("excluded"), key);
  }
  for (const row of guide) {
    const text = JSON.stringify(row);
    assert(!text.includes("Community & Support console"), row.capability_key);
    assert(!text.includes("private pilot with one brand"), row.capability_key);
    assert(
      !text.includes("Creators program isn't available yet"),
      row.capability_key,
    );
  }
  assert(sql.includes("verification_due_at = now()"));
  assert(
    sql.includes(
      "'release_record','feature_flag','deployment','app_release','live_check'",
    ),
  );
});

Deno.test("#4179 reasoned classifications have no 20-key truncation", () => {
  const keys = Array.from({ length: 32 }, (_, index) => `feature-${index}`);
  assertEquals(
    parseFeatureGuide(`Feature Guide: ${keys.join(", ")}`),
    { kind: "keys", keys },
  );
  assertEquals(parseFeatureGuide("Feature Guide: none").reason, undefined);
  assertEquals(
    parseFeatureGuide("Feature Guide: none — CI-only manifest reseal"),
    { kind: "none", reason: "CI-only manifest reseal" },
  );
  assertEquals(
    parseFeatureGuide(
      `Feature Guide: ${
        Array.from({ length: 501 }, (_, index) => `k${index}`).join(",")
      }`,
    ).kind,
    "invalid",
  );
});

Deno.test("#4179 product paths fail closed against the versioned capability catalog", () => {
  const base = featureGuideCatalogFromSql([
    `$catalog$[{"capability_key":"checkout-trips","claim_refs":["mingla-business/app/checkout-trip/page.tsx"]}]$catalog$`,
  ]);
  const added = featureGuideCatalogFromSql([
    `$guide$[{"capability_key":"brand-new","source_path":"app-mobile/src/new.ts"}]$guide$`,
  ]);
  const paths = ["mingla-business/app/checkout-trip/page.tsx"];
  const none = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: none — internal refactor"),
    paths,
    baseCatalog: base,
    prCatalog: new Map(),
  });
  assertEquals(none.ok, false);
  assert(none.problems.some((problem) => problem.includes("product-owned")));
  const omitted = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: brand-new"),
    paths,
    baseCatalog: base,
    prCatalog: added,
  });
  assertEquals(omitted.ok, false);
  assertEquals(omitted.omitted, ["checkout-trips"]);
  const covered = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: checkout-trips, brand-new"),
    paths,
    baseCatalog: base,
    prCatalog: added,
  });
  assertEquals(covered.ok, true);
  const infra = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: none — CI-only manifest reseal"),
    paths: [".github/ci-batch/MANIFEST.json"],
    baseCatalog: base,
    prCatalog: new Map(),
  });
  assertEquals(infra.ok, true);
  const testsOnly = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: none — regression coverage only"),
    paths: ["supabase/functions/_shared/__tests__/feature.test.ts"],
    baseCatalog: base,
    prCatalog: new Map(),
  });
  assertEquals(testsOnly.ok, true);
  const unmapped = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: checkout-trips"),
    paths: ["app-mobile/src/new-unowned-screen.tsx"],
    baseCatalog: base,
    prCatalog: new Map(),
  });
  assertEquals(unmapped.ok, false);
  assertEquals(unmapped.unmapped, ["app-mobile/src/new-unowned-screen.tsx"]);
  const contract = featureGuideCatalogFromContract(JSON.stringify({
    version: 1,
    mappings: [{
      capability_key: "checkout-trips",
      paths: ["app-mobile/src/new-unowned-screen.tsx"],
    }],
  }));
  const mapped = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: checkout-trips"),
    paths: ["app-mobile/src/new-unowned-screen.tsx"],
    baseCatalog: mergeFeatureGuideCatalogs(base, contract),
    prCatalog: new Map(),
  });
  assertEquals(mapped.ok, true);
  const smuggled = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: invented-capability"),
    paths: ["app-mobile/src/new-unowned-screen.tsx"],
    baseCatalog: featureGuideCatalogFromContract(JSON.stringify({
      version: 1,
      mappings: [{
        capability_key: "invented-capability",
        paths: ["app-mobile/src/new-unowned-screen.tsx"],
      }],
    })),
    prCatalog: new Map(),
    knownKeys: base.keys(),
  });
  assertEquals(smuggled.ok, false);
  assertEquals(smuggled.unknown, ["invented-capability"]);
});

Deno.test("#4179 prevention layer invalidates, retries and exposes contiguous coverage", async () => {
  for (
    const token of [
      "source_changed_at",
      "ops_release_guide_keys",
      "ops_feature_guide_coverage",
      "first_parent_sha",
      "issue_4179_capture_release_guide_keys",
      "ops_feature_guide_coverage_reconcile",
      "feature_guide_reason",
      "jsonb_array_length(d->'feature_guide') <= 500",
      "pending.applied_at IS NULL",
      "feature_guide_gap:sha-",
      "I-4179-FEATURE-GUIDE-COVERAGE-WATERMARK",
      "I-4179-FEATURE-GUIDE-PER-KEY-RETRY",
    ]
  ) assert(sql.includes(token), token);
  const bridge = await Deno.readTextFile(
    new URL("supabase/functions/_shared/opsBridges.ts", root),
  );
  assert(bridge.includes('admin.rpc("ops_feature_guide_coverage_reconcile")'));
  assert(bridge.includes("first_parent_sha: c.parents?.[0]?.sha"));
  const contract = featureGuideCatalogFromContract(await Deno.readTextFile(
    new URL("docs/contracts/feature-guide-impact.json", root),
  ));
  assert(
    contract.get("staff-feature-guide")?.includes(
      "supabase/functions/_shared/opsBridges.ts",
    ),
  );
  const prLinks = await Deno.readTextFile(
    new URL(".github/scripts/release-records/pr-links.mjs", root),
  );
  assert(prLinks.includes("headImpactContract"));
  assert(prLinks.includes("feature_guide_contract_removed"));
  const service = await Deno.readTextFile(
    new URL("mingla-admin/src/services/featureGuideService.js", root),
  );
  const panel = await Deno.readTextFile(
    new URL(
      "mingla-admin/src/components/community/FeatureGuidePanel.jsx",
      root,
    ),
  );
  assert(
    service.includes('supabase.rpc("issue_4179_feature_guide_freshness")'),
  );
  assert(panel.includes("Feature Guide coverage needs review"));
  assert(panel.includes("Promise.allSettled"));
  assert(panel.includes('{ state: "unavailable" }'));
});
