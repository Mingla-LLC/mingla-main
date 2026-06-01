/**
 * ORCH-1038 — BusinessTodoToggle source-contract test.
 *
 * The mingla-business Jest harness is node/ts-jest (no RN renderer), so this
 * locks the component's structural contract at source level (mirrors the
 * ORCH-0974 home test approach). Fails-on-revert minimum coverage:
 *   - empty list renders nothing (toggle hides entirely)
 *   - collapsible header + per-row onAction dispatch
 *   - rows are rendered from the ordered `todos` prop (not re-sorted/filtered here)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const SRC = readFileSync(
  join(__dirname, "..", "BusinessTodoToggle.tsx"),
  "utf8",
);

describe("BusinessTodoToggle contract", () => {
  test("hides entirely when there are zero todos", () => {
    expect(SRC).toContain("if (count === 0) return null;");
  });

  test("is collapsible (open state + toggle handler)", () => {
    expect(SRC).toContain("useState<boolean>(true)");
    expect(SRC).toContain("setOpen((prev) => !prev)");
    // chevron flips with open state
    expect(SRC).toContain('name={open ? "chevU" : "chevD"}');
  });

  test("renders the ordered todos prop verbatim and dispatches onAction per row", () => {
    expect(SRC).toContain("todos.map(");
    expect(SRC).toContain("onPress={() => onAction(todo)}");
    // no client-side sort/filter — ordering is owned by buildBusinessTodos
    expect(SRC).not.toContain(".sort(");
    expect(SRC).not.toContain(".filter(");
  });

  test("animates row-set changes for the vanish-when-done feel", () => {
    expect(SRC).toContain("LayoutAnimation.configureNext");
    expect(SRC).toContain("}, [count]);");
  });

  test("rows + header are accessible buttons", () => {
    expect(SRC).toContain('accessibilityRole="button"');
    expect(SRC).toContain("accessibilityLabel=");
  });
});
