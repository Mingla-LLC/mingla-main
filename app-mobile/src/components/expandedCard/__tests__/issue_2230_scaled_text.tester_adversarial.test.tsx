import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(__dirname, "..", "..", "..", "..");
const REPO_ROOT = join(APP_ROOT, "..");
const readApp = (rel: string): string => readFileSync(join(APP_ROOT, rel), "utf8");
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const SHEET = readApp("src/components/expandedCard/TicketCartSheet.tsx");
const SHARED_QUANTITY_ROW = readRepo("packages/offering-rendering/QuantityRow.tsx");
const BUSINESS_QUANTITY_ROW = readRepo(
  "mingla-business/src/components/checkout/QuantityRow.tsx",
);
// [TEST-MOD-APPROVED #2439] SC-14.2. Both halves of this file are repointed
// together, because they go stale together. The WORKFLOW half read
// `.github/workflows/issue-2230-consumer-multiday-tests.yml`, which Phase 3C
// deletes at cutover; the GATE half reads the strict-grep guard, which is
// repointed at the CI registry in the SAME shadow commit. Both reads happen at
// module load, so either one breaking is a suite-wide import failure rather than
// a single failing assertion. All seven protected properties are preserved: the
// three WORKFLOW ones are now asserted against the registry record that actually
// runs the suite, and the four GATE ones are unchanged.
const REGISTRY = JSON.parse(readRepo(".github/ci-batch/MANIFEST.json"));
const SUITE = REGISTRY.suites.find(
  (suite: { id: string }) => suite.id === "issue-2230-consumer-multiday-tests",
);
const GATE = readRepo(
  ".github/scripts/strict-grep/issue-2230-consumer-carries-occurrences.mjs",
);

describe("#2230 tester adversarial — scaled text stays scoped to multi-day Consumer checkout", () => {
  it("unwraps the multi-day heading without changing the null-path one-line contract", () => {
    const headerStart = SHEET.indexOf("const header = (");
    const headerEnd = SHEET.indexOf("const ticketRows", headerStart);
    const header = SHEET.slice(headerStart, headerEnd);

    expect(headerStart).toBeGreaterThan(-1);
    expect(headerEnd).toBeGreaterThan(headerStart);
    expect(header).toContain("Get tickets");
    expect(header).toContain(
      "numberOfLines={multiDaySelection === null ? 1 : undefined}",
    );
    expect(header).not.toContain("numberOfLines={1}");
  });

  it("keeps shared ticket names capped by default and opts in only from TicketCartSheet", () => {
    expect(SHARED_QUANTITY_ROW).toContain("allowUnboundedNameWrap?: boolean;");
    expect(SHARED_QUANTITY_ROW).toContain("allowUnboundedNameWrap = false");
    expect(SHARED_QUANTITY_ROW).toContain(
      "numberOfLines={allowUnboundedNameWrap ? undefined : 2}",
    );
    expect(SHEET).toContain(
      "allowUnboundedNameWrap={multiDaySelection !== null}",
    );
    expect(BUSINESS_QUANTITY_ROW).not.toContain("allowUnboundedNameWrap");

    const optInOccurrences = [
      ...SHEET.matchAll(/allowUnboundedNameWrap=/g),
    ].length;
    expect(optInOccurrences).toBe(1);
  });

  it("does not hide clipping behind a font-size cap or shrink workaround", () => {
    for (const source of [SHEET, SHARED_QUANTITY_ROW]) {
      expect(source).not.toContain("maxFontSizeMultiplier");
      expect(source).not.toContain("adjustsFontSizeToFit");
      expect(source).not.toContain("minimumFontScale");
    }
  });

  it("runs this tester guard and its production files through the CI registry and gate", () => {
    const testerPath =
      "app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx";
    const quantityRowPath = "packages/offering-rendering/QuantityRow.tsx";

    // Property 1 (was: the tester path occurs exactly 2 times in the workflow).
    // The two occurrences were the push and pull_request path lists; assert them
    // as the two lists they always were.
    const pathLists = [
      SUITE.triggerContract.push.paths,
      SUITE.triggerContract.pullRequest.paths,
    ];
    expect(pathLists.filter((list: string[]) => list.includes(testerPath)))
      .toHaveLength(2);
    // Property 2 (was: the workflow contains the app-relative tester literal).
    // The literal only mattered because it is what the runner executes, so
    // assert the leaf that executes it, with its working directory.
    const executedByAppMobileLeaf = SUITE.steps
      .flatMap((step: { cwd: string; children: { cwd: string; invocation: { argv: string[] } | null }[] }) =>
        step.children.map((child) => ({ cwd: child.cwd ?? step.cwd, argv: child.invocation?.argv?.[1] ?? "" })))
      .some(({ cwd, argv }: { cwd: string; argv: string }) => cwd === "app-mobile" && argv.includes(
        "src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx",
      ));
    expect(executedByAppMobileLeaf).toBe(true);
    // Property 3 (was: the shared QuantityRow occurs exactly 2 times).
    expect(pathLists.filter((list: string[]) => list.includes(quantityRowPath)))
      .toHaveLength(2);
    expect(GATE).toContain(testerPath);
    expect(GATE).toContain(quantityRowPath);
    expect(GATE).toContain(
      "allowUnboundedNameWrap={multiDaySelection !== null}",
    );
    expect(GATE).toContain(
      "numberOfLines={multiDaySelection === null ? 1 : undefined}",
    );
  });
});
