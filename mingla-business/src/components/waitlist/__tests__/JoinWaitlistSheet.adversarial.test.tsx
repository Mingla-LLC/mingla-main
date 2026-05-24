// T-WL-11 — JoinWaitlistSheet adversarial UX paths.
//
// Source assertions complement the T-WL-03 happy-path test by pinning
// negative-state behavior: opt-out re-disables submit, invalid email blocks,
// and network errors keep the sheet open while surfacing a toast.

import fs from "node:fs";
import path from "node:path";

describe("T-WL-11 JoinWaitlistSheet adversarial UX paths", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../JoinWaitlistSheet.tsx"),
    "utf8",
  );

  it("re-disables Submit when consent is unticked after being ticked", () => {
    expect(source).toContain("const [consent, setConsent]");
    expect(source).toContain("setConsent((prev) => !prev)");
    expect(source).toMatch(/const canSubmit\s*=[\s\S]*?consent[\s\S]*?!mutation\.isPending;/);
    expect(source).toContain("disabled={!canSubmit}");
  });

  it("blocks invalid email and shows an inline validation error", () => {
    expect(source).toContain("EMAIL_RE.test(cleanEmail)");
    expect(source).toMatch(/const emailValid\s*=[\s\S]*?EMAIL_RE\.test\(cleanEmail\)/);
    expect(source).toContain("!emailValid && styles.inputError");
    expect(source).toContain("Enter a valid email.");
  });

  it("keeps the sheet open and shows an error toast on network failure", () => {
    const catchStart = source.indexOf("} catch {");
    expect(catchStart).toBeGreaterThan(-1);
    const catchBlock = source.slice(catchStart, source.indexOf("}", catchStart + 9) + 1);
    expect(catchBlock).toContain("Couldn't add you to the waitlist. Try again.");
    expect(catchBlock).toContain('"error"');
    expect(catchBlock).not.toContain("onClose();");
  });
});
