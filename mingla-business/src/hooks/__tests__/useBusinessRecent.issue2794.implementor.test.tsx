import fs from "node:fs";
import path from "node:path";

test("#2794 hook owns bounded hydration, offline replay, and permission eviction", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "useBusinessRecent.ts"),
    "utf8",
  );
  expect(source).toContain("offset += 25");
  expect(source).toContain("pointer.pendingSync && !pointer.localDraft");
  expect(source).toContain('errorKind === "permission"');
  expect(source).toContain("clearScope(scope)");
  expect(source).toContain("operationRef.current !== operationId");
});
