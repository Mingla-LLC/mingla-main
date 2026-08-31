import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(__dirname, "../../../../app/(tabs)/people/[personId].tsx"),
  "utf8",
);

describe("#1772 live Merge receipt ownership", () => {
  test("does not let durable recovery redirect preempt an open Merge sheet", () => {
    // [TEST-MOD-APPROVED #1772] When the other record survives, the durable
    // receipt targets a different route. The active flow must paint its local
    // receipt first; its explicit primary action owns the later navigation.
    expect(routeSource).toContain(
      "if (restoredMerge === null || mergeOpen) return;",
    );
    expect(routeSource).toContain(
      "[detail, mergeOpen, personId, restoredMerge, router]",
    );
    expect(routeSource).toContain("setMergeOpen(false);");
    expect(routeSource).toContain(
      "router.replace(`/(tabs)/people/${survivorPersonId}` as never);",
    );
  });
});
