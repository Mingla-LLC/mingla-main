import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "src/services/brandPaystackService.ts"),
  "utf8",
);
const hookSource = fs.readFileSync(
  path.join(repoRoot, "src/hooks/useBrandPaystack.ts"),
  "utf8",
);
const viewSource = fs.readFileSync(
  path.join(repoRoot, "src/components/brand/BrandPaystackOnboardView.tsx"),
  "utf8",
);

describe("#1176 organiser recipient wiring", () => {
  it("routes create and update through the existing onboarding edge owner", () => {
    expect(serviceSource).toContain(
      'action: "create_recipient" | "update_recipient"',
    );
    expect(serviceSource).toContain('"brand-paystack-onboard"');
    expect(hookSource).toContain("useCreatePaystackRecipient");
    expect(hookSource).toContain("useUpdatePaystackRecipient");
  });

  it("creates the RCP_ before changing the legacy ACCT_ so retry stays safe", () => {
    const recipientCall = viewSource.indexOf(
      "await recipientMutation.mutateAsync(input)",
    );
    const subaccountCall = viewSource.indexOf(
      "await submitMutation.mutateAsync(input)",
    );
    expect(recipientCall).toBeGreaterThan(-1);
    expect(subaccountCall).toBeGreaterThan(recipientCall);
    expect(viewSource).toContain("!recipientMutation.isPending");
  });
});
