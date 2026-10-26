import fs from "node:fs";
import path from "node:path";

describe("#3872 creator onboarding", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.tsx"), "utf8");

  it("shows all six user-readable readiness outcomes", () => {
    for (const label of [
      "Your creator profile",
      "Prove one social account",
      "Set your packages",
      "Add a showcase",
      "Choose where you are paid",
      "Review the creator agreement",
    ]) expect(source).toContain(label);
  });

  it("does not allow the UI to self-assign verified status", () => {
    expect(source).toContain("creatorProgramService.verifyHandle");
    expect(source).toContain("creatorProgramService.recompute");
    expect(source).not.toContain('verification: "verified"');
  });

  it("keeps legal signing fail closed without an approved version", () => {
    expect(source).toContain("EXPO_PUBLIC_CREATOR_AGREEMENT_VERSION");
    expect(source).toContain("disabled={!agreementVersion}");
  });
});
