import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const historicalTargetPath = path.join(
  root,
  "src/components/intel/__tests__/turnoutMounts.issue1008.happy.test.ts",
);

type ForbiddenMarker = {
  label: string;
  pattern: RegExp;
};

const forbiddenMarkers: ForbiddenMarker[] = [
  { label: "node:child_process", pattern: /node:child_process/ },
  { label: "execFileSync", pattern: /execFileSync/ },
  { label: "merge-base", pattern: /merge-base/ },
  {
    label: "diff --name-only",
    pattern: /["']diff["'][\s\S]{0,80}["']--name-only["']/,
  },
  { label: "origin\/main", pattern: /origin\/main/ },
];

const durableExperienceRead =
  /read\(\s*["']src\/components\/experience\/ExperienceCreatorWizard\.tsx["']\s*,?\s*\)/;
const exactOneProviderAssertion =
  /expect\(\s*experienceWizard\.match\(\s*\/<LazyTurnoutIntelProvider\/g\s*\)\s*\)\.toHaveLength\(\s*1\s*\)/;
const disabledAutoRunAssertion =
  /expect\(\s*experienceWizard\s*\)\.toContain\(\s*["']autoRunEnabled=\{false\}["']\s*\)/;

function targetContractViolations(source: string): string[] {
  const violations = forbiddenMarkers
    .filter(({ pattern }) => pattern.test(source))
    .map(({ label }) => `forbidden:${label}`);

  if (!durableExperienceRead.test(source)) {
    violations.push("missing:durable-experience-read");
  }
  if (!exactOneProviderAssertion.test(source)) {
    violations.push("missing:exact-one-provider-assertion");
  }
  if (!disabledAutoRunAssertion.test(source)) {
    violations.push("missing:disabled-auto-run-assertion");
  }
  return violations;
}

function experienceSourceViolations(source: string): string[] {
  const violations: string[] = [];
  if ((source.match(/<LazyTurnoutIntelProvider/g) ?? []).length !== 1) {
    violations.push("provider-count-must-equal-one");
  }
  if (!source.includes("autoRunEnabled={false}")) {
    violations.push("automatic-execution-must-stay-disabled");
  }
  return violations;
}

// #2068's changed-file assertion passed only inside its originating PR and then
// false-reded every unrelated branch. Current PR composition must never again
// stand in for this durable Experience source contract.
const exactBadMechanismFrom49baf8c85 = `
import { execFileSync } from "node:child_process";
const base = execFileSync(
  "git",
  ["merge-base", "HEAD", "origin/main"],
  { cwd: repoRoot },
);
const changed = execFileSync(
  "git",
  ["diff", "--name-only", base, "HEAD"],
  { cwd: repoRoot },
);
expect(changed).toContain(
  "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
);
`;

describe("#2080 turnout mount branch-independence adversarial contract", () => {
  it("accepts the repaired durable target and rejects every marker in the exact old Git mechanism", () => {
    const repairedTarget = fs.readFileSync(historicalTargetPath, "utf8");
    expect(targetContractViolations(repairedTarget)).toEqual([]);

    expect(targetContractViolations(exactBadMechanismFrom49baf8c85)).toEqual(
      expect.arrayContaining([
        "forbidden:node:child_process",
        "forbidden:execFileSync",
        "forbidden:merge-base",
        "forbidden:diff --name-only",
        "forbidden:origin/main",
      ]),
    );
  });

  it("requires the durable Experience read, exact-one provider assertion, and disabled-auto-run assertion", () => {
    const repairedTarget = fs.readFileSync(historicalTargetPath, "utf8");

    expect(
      targetContractViolations(
        repairedTarget.replace(
          "src/components/experience/ExperienceCreatorWizard.tsx",
          "src/components/experience/UnrelatedWizard.tsx",
        ),
      ),
    ).toContain("missing:durable-experience-read");
    expect(
      targetContractViolations(
        repairedTarget.replace(
          "expect(experienceWizard.match(/<LazyTurnoutIntelProvider/g)).toHaveLength(1)",
          "expect(experienceWizard.match(/<LazyTurnoutIntelProvider/g)).toHaveLength(2)",
        ),
      ),
    ).toContain("missing:exact-one-provider-assertion");
    expect(
      targetContractViolations(
        repairedTarget.replace(
          'toContain("autoRunEnabled={false}")',
          'toContain("autoRunEnabled={true}")',
        ),
      ),
    ).toContain("missing:disabled-auto-run-assertion");
  });

  it("rejects zero providers, two providers, and enabled automatic execution in memory", () => {
    expect(experienceSourceViolations("<ExperienceWizard />")).toContain(
      "provider-count-must-equal-one",
    );
    expect(
      experienceSourceViolations(`
        <LazyTurnoutIntelProvider autoRunEnabled={false} />
        <LazyTurnoutIntelProvider autoRunEnabled={false} />
      `),
    ).toContain("provider-count-must-equal-one");
    expect(
      experienceSourceViolations(
        "<LazyTurnoutIntelProvider autoRunEnabled={true} />",
      ),
    ).toContain("automatic-execution-must-stay-disabled");
    expect(
      experienceSourceViolations(
        "<LazyTurnoutIntelProvider autoRunEnabled={false} />",
      ),
    ).toEqual([]);
  });
});
