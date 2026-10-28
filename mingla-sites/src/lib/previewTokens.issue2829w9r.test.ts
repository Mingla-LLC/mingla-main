import { describe, expect, it } from "vitest";
import { previewParentAllowed, previewTokenDeclarations } from "./previewTokens";

describe("#2829 W9r preview token bridge", () => {
  it("only the parents that may frame the preview can restyle it", () => {
    expect(previewParentAllowed("https://host.usemingla.com", { localMode: false })).toBe(true);
    expect(previewParentAllowed("https://mingla-business-abc123.vercel.app", { localMode: false })).toBe(true);
    expect(previewParentAllowed("http://localhost:8190", { localMode: false })).toBe(false);
    expect(previewParentAllowed("http://localhost:8190", { localMode: true })).toBe(true);
    expect(previewParentAllowed("https://evil.example", { localMode: true })).toBe(false);
  });

  it("applies only token variables with safe values", () => {
    const declarations = previewTokenDeclarations({
      type: "mingla:preview-tokens",
      declarations: [
        "--c-accent-400:#89cff0",
        "--c-canvas:#ffffff",
        "--button-radius:999px",
        "--display-case:uppercase",
        "--c-canvas:red;background:url(https://evil)",
        "--not-a-token:#000000",
        "color:#000000",
        "--c-ink-body:expression(alert(1))",
      ],
    });
    expect(declarations).toEqual([
      ["--c-accent-400", "#89cff0"],
      ["--c-canvas", "#ffffff"],
      ["--button-radius", "999px"],
      ["--display-case", "uppercase"],
    ]);
    expect(previewTokenDeclarations({ type: "other", declarations: ["--c-canvas:#000000"] })).toEqual([]);
    expect(previewTokenDeclarations("--c-canvas:#000000")).toEqual([]);
  });
});
