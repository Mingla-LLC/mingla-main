import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(__dirname, "..");
const builder = join(packageRoot, "scripts/build-invite-critical-entry.mjs");

type ScriptKind = "runtime" | "common" | "index" | "extra";

function scriptTag(kind: ScriptKind): string {
  return `<script nonce="nonce-${kind}" data-order="${kind}" src="/_expo/static/js/web/${kind}-922.js?v=independent" defer crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
}

function makeExport(order: ScriptKind[] = ["runtime", "common", "index"]): string {
  const dir = mkdtempSync(join(tmpdir(), "issue922-adversarial-"));
  const jsDir = join(dir, "_expo/static/js/web");
  mkdirSync(jsDir, { recursive: true });
  for (const kind of new Set(order)) writeFileSync(join(jsDir, `${kind}-922.js`), `/* ${kind} */`);
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body><div id="root"></div>${order.map(scriptTag).join("")}<span id="tail"></span></body></html>`,
  );
  return dir;
}

function build(dir: string): void {
  execFileSync(process.execPath, [builder, "--build-dir", dir], {
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "pipe",
  });
}

describe("issue #922 independent critical-entry attacks", () => {
  test.each([
    ["missing", ["runtime", "common"]],
    ["duplicate", ["runtime", "common", "index", "index"]],
    ["additional", ["runtime", "common", "index", "extra"]],
  ] as const)("fails closed for %s eager-script topology", (_label, order) => {
    const dir = makeExport([...order]);
    expect(() => build(dir)).toThrow(/expected exactly 3 eager Expo scripts/);
  });

  test("fails closed when the three eager scripts are reordered", () => {
    const dir = makeExport(["common", "runtime", "index"]);
    expect(() => build(dir)).toThrow(/order|topology/i);
  });

  test("preserves execution and security attributes in source order without eager markup", () => {
    const dir = makeExport();
    build(dir);
    const source = readFileSync(join(dir, "index.html"), "utf8");
    const entry = readFileSync(join(dir, "accept-brand-invitation-entry.html"), "utf8");
    expect(source.indexOf('data-order="runtime"')).toBeLessThan(source.indexOf('data-order="common"'));
    expect(source.indexOf('data-order="common"')).toBeLessThan(source.indexOf('data-order="index"'));
    expect(entry).not.toMatch(/<script[^>]+src=/i);
    for (const kind of ["runtime", "common", "index"] as const) {
      for (const pin of [
        `nonce-${kind}`,
        `data-order\",\"value\":\"${kind}`,
        "crossorigin",
        "referrerpolicy",
        "no-referrer",
      ]) expect(entry).toContain(pin);
    }
    expect(entry.indexOf('value\":\"runtime')).toBeLessThan(entry.indexOf('value\":\"common'));
    expect(entry.indexOf('value\":\"common')).toBeLessThan(entry.indexOf('value\":\"index'));
  });

  test("keeps the auth-key check strict and the token out of generated trusted markup", () => {
    const dir = makeExport();
    build(dir);
    const entry = readFileSync(join(dir, "accept-brand-invitation-entry.html"), "utf8");
    expect(entry).toContain('/^sb-.+-auth-token$/.test(key)');
    expect(entry).toContain('new URLSearchParams(window.location.search)');
    expect(entry).toContain('encodeURIComponent("/accept-brand-invitation?token="+token)');
    expect(entry).not.toContain("document.write");
    expect(entry).not.toContain("token+\"</");
  });
});
