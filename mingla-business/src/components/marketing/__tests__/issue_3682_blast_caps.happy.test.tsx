/**
 * #3682 Wave 2.7 — ComposerReviewSheet week warning + allowance (source contract).
 */
import { readFileSync } from "fs";
import path from "path";

const sheet = readFileSync(
  path.join(__dirname, "../ComposerReviewSheet.tsx"),
  "utf8",
);
const compose = readFileSync(
  path.join(
    __dirname,
    "../../../../app/(tabs)/marketing/campaigns/compose.tsx",
  ),
  "utf8",
);
const preview = readFileSync(
  path.join(__dirname, "../../../hooks/marketing/useBookBlastPreview.ts"),
  "utf8",
);

describe("#3682 Wave 2.7 blast caps + week warning", () => {
  it("ComposerReviewSheet declares allowance + week warning props", () => {
    expect(sheet).toMatch(/allowanceLabel\?\s*:\s*string/);
    expect(sheet).toMatch(/weekBlastWarning\?\s*:\s*boolean/);
    expect(sheet).toContain("Send anyway");
    expect(sheet).toContain("Not now");
    expect(sheet).toContain("composer-review-week-warning");
    expect(sheet).toContain("You've sent 3 blasts in the last 7 days");
  });

  it("keeps ORCH-1270 ctaLabel derivation intact", () => {
    expect(sheet).toMatch(
      /const ctaLabel = isSendNow \? "Send now" : "Schedule";/,
    );
  });

  it("compose wires allowance + week warning into the review sheet", () => {
    expect(compose).toContain("bookAllowanceLabel");
    expect(compose).toContain("bookWeekBlastWarning");
    expect(compose).toContain("allowanceLabel={bookAllowanceLabel}");
    expect(compose).toContain("weekBlastWarning={bookWeekBlastWarning}");
    expect(compose).toContain("MONTHLY_CAP");
  });

  it("getBookBlastDisabledReason blocks over remaining allowance", () => {
    expect(preview).toContain("smsRemaining");
    expect(preview).toContain("emailRemaining");
    expect(preview).toContain("remain this month");
  });
});
