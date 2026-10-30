import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../VenueStaffHome.tsx"),
  "utf8",
);
const homeSource = fs.readFileSync(
  path.resolve(__dirname, "../../../../app/(tabs)/home.tsx"),
  "utf8",
);

describe("#4188 venue-staff home shell", () => {
  it("keeps the desktop Account control while exposing no creator action", () => {
    expect(source).toContain("<TopBar");
    expect(source).not.toContain("rightSlot={null}");
    expect(source).not.toContain("extraRightSlot");
    expect(source).not.toContain("UniversalCreator");
  });

  it("keeps role resolution and denial inside the venue-staff lazy boundary", () => {
    expect(homeSource).toContain("LazyVenueStaffHomeBoundary");
    expect(homeSource).toContain('return { default: mod.VenueStaffHomeBoundary }');
    expect(source).toContain('mode: "resolving" | "denied" | "staff"');
    expect(source).toContain('testID="home-role-gate"');
  });
});
