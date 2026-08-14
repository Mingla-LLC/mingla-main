import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

const card = read("src/components/ari/ToolProposalCard.tsx");
const screen = read("src/screens/ari/AriChatScreen.tsx");
const confirmHook = read("src/hooks/useConfirmPendingAction.ts");

describe("#2063 shared Business brand confirmation recovery", () => {
  test("web, iOS, and Android use one proposal card with visible retry-safe failures", () => {
    expect(card).toContain("const confirmProposal = async");
    expect(card).toContain("setProposalError(outcome.error)");
    expect(card).toContain("Confirm again to retry safely.");
    expect(card).toContain('accessibilityRole="alert"');
    expect(card).toContain("void confirmProposal(editing ? editedArgs : undefined)");
    expect(card).toContain("void confirmProposal({");
  });

  test("brand hours and currency have human proposal labels on the shared card", () => {
    expect(card).toContain('case "manage_brand_hours": return "Update venue hours"');
    expect(card).toContain('case "manage_brand_discovery_currency": return "Update discovery currency"');
  });

  test("structured and thrown confirmation failures remain visible and retryable", () => {
    expect(screen).toContain("result = await confirm.confirm(");
    expect(screen).toContain("return { ok: false, error: message }");
    expect(screen).toContain("return { ok: false, error: result.message }");
    expect(screen).toMatch(/catch \(error\)[\s\S]*setLocalError\(message\)[\s\S]*return \{ ok: false, error: message \}/);
  });

  test("expiry is honest and cancel errors do not discard the proposal", () => {
    expect(screen).toContain("isExpiredActionError(result.code, result.message)");
    expect(screen).toContain("This proposal expired. Ask Ari to propose it again.");
    expect(screen).toContain('terminal: "expired"');
    expect(screen).toMatch(/const result = await confirm\.cancel[\s\S]*if \(result\.kind === "error"\)[\s\S]*setLocalError\(result\.message\)[\s\S]*return;/);
  });

  test("successful hours and currency confirmations invalidate canonical read caches", () => {
    expect(confirmHook).toContain('response.tool_name === "manage_brand_hours"');
    expect(confirmHook).toContain("brandHoursKeys.byBrand(brandId)");
    expect(confirmHook).toContain("venueAvailabilityKeys.config(brandId)");
    expect(confirmHook).toContain('response.tool_name === "manage_brand_discovery_currency"');
    expect(confirmHook).toContain("brandDiscoveryCurrencyKeys.all");
    expect(confirmHook).toContain("brandKeys.detail(brandId)");
    expect(confirmHook).toContain("creatorAccountKeys.all");
  });
});
