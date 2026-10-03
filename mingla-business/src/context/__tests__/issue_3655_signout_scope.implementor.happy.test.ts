/**
 * #3655 — Sign out local vs Sign out everywhere (global) wiring.
 */

import * as fs from "node:fs";
import * as path from "node:path";

describe("#3655 sign-out scope", () => {
  test("AuthContext signOut accepts local|global scope", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "AuthContext.tsx"),
      "utf8",
    );
    expect(src).toContain('scope?: "local" | "global"');
    expect(src).toContain("await supabase.auth.signOut({ scope })");
    expect(src).toContain('options?.scope ?? "local"');
    expect(src).toContain("if (error)");
    expect(src).toContain("throw error");
  });

  test("Account tab exposes Sign out and confirms Sign out everywhere", () => {
    const src = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "app",
        "(tabs)",
        "account.tsx",
      ),
      "utf8",
    );
    expect(src).toContain('label="Sign out"');
    expect(src).toContain('label="Sign out everywhere"');
    expect(src).toContain('handleSignOut("local")');
    expect(src).toContain('handleSignOut("global")');
    expect(src).toContain("account-sign-out-everywhere-confirm");
  });
});
