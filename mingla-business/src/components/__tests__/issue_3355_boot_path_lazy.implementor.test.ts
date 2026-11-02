/**
 * #3355 — what this initiative added to the Host stays off the eager boot
 * chunk (#3493 shared 1,024 B `__common` movement gate).
 *
 * Metro hoists a module into `__common` when more than one chunk carries it
 * statically, or when an eager screen imports it. These on-intent modules
 * load only through `import()`: the brand switcher (opened from the brand
 * chip), the logo picker, the address map preview, the readiness "Try again"
 * and the readiness read itself. A static import of any of them outside its
 * own file and tests puts it back on every visitor's boot path.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = [...sourceFiles(path.join(ROOT, "src")), ...sourceFiles(path.join(ROOT, "app"))];

/** Value (non-type) static imports of `module` across Host source. */
function staticImporters(module: string): string[] {
  const pattern = new RegExp(
    String.raw`^import\s+(?!type\b)[^;]*?from\s+"[^"]*/${module}";`,
    "m",
  );
  return FILES.filter((file) => pattern.test(fs.readFileSync(file, "utf8"))).map(
    (file) => path.relative(ROOT, file),
  );
}

describe("#3355 on-intent modules stay off the eager boot chunk", () => {
  test.each([
    ["BrandSwitcherSheet"],
    ["BrandAvatarPickerSheet"],
    ["AddressMapPreview"],
    ["TodoReadinessRetry"],
  ])("%s has no static importer", (module) => {
    expect(staticImporters(module)).toEqual([]);
  });

  test("the readiness read loads with the first read, not at boot", () => {
    expect(staticImporters("brandReadinessService")).toEqual([]);
    const hook = fs.readFileSync(path.join(ROOT, "src/hooks/useBrandReadiness.ts"), "utf8");
    expect(hook).toMatch(/await import\(\s*"\.\.\/services\/brandReadinessService"\s*\)/);
  });

  test("Ari's upload card takes its words from the chat, not from ariFlowCards", () => {
    const card = fs.readFileSync(path.join(ROOT, "src/components/ari/AriFlowUploadCard.tsx"), "utf8");
    expect(card).toMatch(/^import type \{[^}]*\} from "\.\/ariFlowCards";$/m);
    expect(card).not.toMatch(/^import \{[^}]*\} from "\.\/ariFlowCards";$/m);
  });
});
