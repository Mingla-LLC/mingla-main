import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..", "..");

describe("BottomNav.web desktop rail polish", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/ui/BottomNav.web.tsx"),
    "utf8",
  );

  it("uses the official Mingla Business logo instead of a temporary letter mark", () => {
    expect(source).toContain("mingla-business-logo.png");
    expect(source).toContain("<Image");
    expect(source).not.toContain("LinearGradient");
    expect(source).not.toContain("brandMarkLetter");
  });

  it("keeps the selected rail state restrained and glass-like", () => {
    expect(source).toContain('const ACTIVE_BG = "rgba(255, 255, 255, 0.055)"');
    expect(source).toContain('const ACTIVE_BORDER = "rgba(235, 120, 37, 0.45)"');
    expect(source).toContain("shadowOpacity: 0.16");
    expect(source).toContain("shadowRadius: 10");
    expect(source).not.toContain("glassChromeActive");
  });
});
