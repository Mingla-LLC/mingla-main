/**
 * #4420 (c_6876753693 item 4): Ari's icon is the Ari orb everywhere, never the
 * sparkle. Guard: no Ari nav entry (BottomNav tab, desktop sidebar and rail,
 * wizard desktop nav, Help rail) may name the sparkle, and Icon's "ari" draws
 * the still HomeAriOrb (one orb implementation, no third component).
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..", "..", "..");

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(rel);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });

// An object literal that names Ari (id or label) and an icon.
const ARI_ENTRY = /\{[^{}]*\b(?:id:\s*"ari"|label:\s*"Ari")[^{}]*\bicon(?:Name)?:\s*"([a-z-]+)"[^{}]*\}/g;

describe("#4420 Ari icon is the Ari orb", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("src")];
  const entries = files.flatMap((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    return [...src.matchAll(ARI_ENTRY)].map((m) => ({ rel, icon: m[1] }));
  });

  test("the known Ari nav entries are all found", () => {
    const found = new Set(entries.map((e) => e.rel));
    for (const rel of [
      "app/(tabs)/_layout.tsx",
      "src/components/ui/DesktopSidebar.tsx",
      "app/account/support.tsx",
      "src/components/trip/TripCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/event/EventCreatorWizard.tsx",
    ]) {
      expect(found).toContain(rel);
    }
  });

  test("no Ari entry uses the sparkle; every one uses the orb", () => {
    expect(entries.filter((e) => e.icon === "sparkle")).toEqual([]);
    expect(entries.every((e) => e.icon === "ari")).toBe(true);
  });

  test('Icon draws "ari" as the still HomeAriOrb at the icon size', () => {
    const icon = fs.readFileSync(path.join(ROOT, "src/components/ui/Icon.tsx"), "utf8");
    expect(icon).toMatch(/if \(name === "ari"\) \{\s*return <HomeAriOrb size=\{size\} still/);
    const orb = fs.readFileSync(path.join(ROOT, "src/components/home/HomeAriOrb.tsx"), "utf8");
    expect(orb).toContain("export type HomeAriOrbSize = keyof typeof ORB_GEOMETRY | number;");
  });
});
