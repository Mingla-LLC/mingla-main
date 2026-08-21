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
const WORKFLOW = readRepo(
  ".github/workflows/issue-2230-consumer-multiday-tests.yml",
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

  it("runs this tester guard and its production files through the issue workflow and gate", () => {
    const testerPath =
      "app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx";
    const quantityRowPath = "packages/offering-rendering/QuantityRow.tsx";

    expect(WORKFLOW.match(new RegExp(testerPath.replaceAll(".", "\\."), "g")))
      .toHaveLength(2);
    expect(WORKFLOW).toContain(
      "src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx",
    );
    expect(WORKFLOW.match(new RegExp(quantityRowPath.replaceAll(".", "\\."), "g")))
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
