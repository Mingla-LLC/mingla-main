import fs from "node:fs";
import path from "node:path";

// #3872 — the Creator and Referral programs live in ONE lazy chunk. Metro
// hoists any module two lazy chunks share into the eager `__common` chunk
// every web visitor downloads; when routes, the event page, the brand page
// and the venue page each imported program code statically, the program
// added ~61 KB to `__common` and broke the product ceiling. Outside code
// must reach the program only through `import()` of creatorProgramOwner.
const ROOT = path.resolve(__dirname, "../../../..");

const PROGRAM = [
  /^src\/components\/(programs|creators|referrals|gigs)\//,
  /^src\/components\/marketing\/Blast(ProgramTab|PromotionOverview|Redirect)\.tsx$/,
  /^src\/components\/venue\/LocalReviewsManager\.tsx$/,
  /^src\/services\/(creatorGigsService|referralService|promotionOverview|promotionOverviewService|gigHireService|creatorRosterService|promoterReferralService|promoteListingService|creatorProgramContract)\.ts$/,
  /^src\/utils\/creatorProgramFormat\.ts$/,
  /^src\/payments\/(useGigHirePay|gigHirePay)\.ts$/,
];
// Small pieces the brand page shows without the program (StatStrip and the
// layout numbers it reads), and the owner itself (import() only).
const SHARED = new Set([
  "src/components/programs/StatStrip.tsx",
  "src/components/programs/programLayout.ts",
]);
const OWNER = "src/components/programs/creatorProgramOwner.ts";

const isProgram = (rel: string): boolean =>
  !SHARED.has(rel) && PROGRAM.some((re) => re.test(rel));

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const EXTS = ["", ".tsx", ".ts", ".web.tsx", ".web.ts", "/index.tsx", "/index.ts"];
function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(ROOT, candidate).split(path.sep).join("/");
    }
  }
  return null;
}

/** Value (non-type) static imports and re-exports of a file. */
function staticImports(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gms;
  for (const m of src.matchAll(re)) {
    if (m[1]) continue;
    const target = resolve(file, m[2]);
    if (target) out.push(target);
  }
  return out;
}

const files = [
  ...walk(path.join(ROOT, "app"), []),
  ...walk(path.join(ROOT, "src"), []),
];

describe("#3872 program code loads through one lazy owner", () => {
  it("scans a real tree", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((f) => path.relative(ROOT, f))).toContain(OWNER);
  });

  it("nothing outside the program statically imports program code", () => {
    const leaks: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (isProgram(rel) || rel === OWNER || /\.native\.tsx?$/.test(rel)) continue;
      for (const target of staticImports(file)) {
        if (isProgram(target) || target === OWNER) leaks.push(`${rel} -> ${target}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("the program has no second import() boundary inside it", () => {
    const inner: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (!isProgram(rel)) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
        const target = resolve(file, m[1]);
        if (target && (isProgram(target) || target === OWNER)) {
          inner.push(`${rel} -> ${target}`);
        }
      }
    }
    expect(inner).toEqual([]);
  });

  it("the creator routes are thin lazy routes onto the owner", () => {
    for (const route of [
      "app/brand/[id]/creators/brief.tsx",
      "app/brand/[id]/creators/results.tsx",
      "app/brand/[id]/creators/roster.tsx",
      "app/brand/[id]/creators/index.tsx",
      "app/brand/[id]/creators/[gigId]/interest.tsx",
      "app/brand/[id]/creators/contract/[contractId].tsx",
      "app/brand/[id]/creators/profile/[creatorId].tsx",
      "app/brand/[id]/promote.tsx",
      "app/brand/[id]/referrals.tsx",
      "app/promoting/index.tsx",
      "app/(tabs)/marketing/creators/index.tsx",
      "app/(tabs)/marketing/referrals/index.tsx",
    ]) {
      const src = fs.readFileSync(path.join(ROOT, route), "utf8");
      expect(src).toMatch(/React\.lazy\(/);
      expect(src).toContain("components/programs/creatorProgramOwner\")");
    }
  });
});
