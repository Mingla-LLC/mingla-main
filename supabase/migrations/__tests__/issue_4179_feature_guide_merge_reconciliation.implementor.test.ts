import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Structural companion proof for the two #4179 invariants owned by the
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
4175 4181 4178
`.trim().split(/\s+/).map(Number);

Deno.test("#4179 classifies the sealed 143-merge window exactly once", () => {
  const actual = [...review.map((row) => row.pr), ...noEffect];
  assertEquals(actual.length, 143);
  assertEquals(new Set(actual).size, 143);
  assertEquals(
    [...actual].sort((a, b) => a - b),
    [...expectedPrs].sort((a, b) => a - b),
  );
  assertEquals(review.length, 95);
  assertEquals(noEffect.length, 48);
  assert(review.every((row) => ["existing", "new"].includes(row.disposition)));
  assert(review.every((row) => row.capability_keys.length > 0));
});

Deno.test("#4179 first-parent range agrees with the sealed review when history is present", async () => {
  const baseline = "c604fb6931ecb00c939ead8023198a7648bba606";
  const head = "c93ccb5b76ce90d638dbff7aaabf5b0eb2336994";
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
  assertEquals(fromGit.length, 143);
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
