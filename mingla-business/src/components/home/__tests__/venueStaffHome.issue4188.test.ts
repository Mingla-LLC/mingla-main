import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../VenueStaffHome.tsx"),
  "utf8",
);

describe("#4188 venue-staff home shell", () => {
  it("keeps the desktop Account control while exposing no creator action", () => {
    expect(source).toContain("<TopBar");
    expect(source).not.toContain("rightSlot={null}");
    expect(source).not.toContain("extraRightSlot");
    expect(source).not.toContain("UniversalCreator");
  });
});
