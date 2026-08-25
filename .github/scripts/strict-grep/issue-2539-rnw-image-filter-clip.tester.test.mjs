// #2539 ADVERSARIAL suite for the rnw-image-filter-clip class gate.
//
// The implementor suite asks "does the gate fire on the bug?". This one asks the
// two questions that actually decide whether a green run means anything:
//
//   A. Can the defect be re-introduced in a shape the gate does NOT see?
//      (evasion — a gate with a blind spot is a licence, not a guard)
//   B. Can a legitimate shape be made to fire?
//      (over-fire — a gate that cries wolf gets disabled by the next author)
//
// A-1  indirection    the fix reverted through the `const avatarStyle = [...]`
//                     binding, i.e. style={avatarStyle} rather than an inline array
// A-2  reordering     shadow prop LAST vs FIRST in the style object
// A-3  split sources  borderRadius in one styles.X, the shadow in another
// A-4  whitespace     newline-separated props, no trailing comma, tight spacing
// A-5  filter direct  an explicit `filter:` style rather than shadow*
// A-6  blurRadius     the third filter route, as a prop and as a style
// A-7  multiline tag  the real formatting: attributes across many lines
// B-1  boxShadow      the FIX's own shape must never fire — boxShadow is not a filter
// B-2  View           the same style set on a <View> is safe and must not fire
// B-3  ImageBackground a different component must not be matched
// B-4  substring      `shadowRadiusExtra` / `myBorderRadius` must not match
// B-5  string data    a prop name inside a string literal is data
// C-1  determinism    the gate's verdict does not depend on file order or on
//                     being run twice
// C-2  message        every failure names the file, a line, and the prop, so a
//                     red run is actionable without opening the gate's source

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkSource, constBinding, stripComments } from "./issue-2539-rnw-image-filter-clip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const GATE = path.join(HERE, "issue-2539-rnw-image-filter-clip.mjs");

function run(src, rel = "fixture.tsx") {
  const failures = [];
  const res = checkSource(src, rel, failures);
  return { failures, ...res };
}
const sheet = (body) => `const styles = StyleSheet.create({\n${body}\n});`;
const fired = (src) => run(src).failures.length > 0;

// ---------------------------------------------------------------------------
// A — evasion
// ---------------------------------------------------------------------------

test("A-1 the defect reverted through a `const …Style = [...]` binding is still caught", () => {
  const src = `
    const avatarStyle = [
      styles.avatar,
      { width: size, height: size, borderRadius: size / 2, shadowColor: palette.accent },
    ];
    const el = <Image source={{ uri: brand.photo }} style={avatarStyle} resizeMode="cover" />;
    ${sheet(`  avatar: { alignItems: "center", borderWidth: 3, overflow: "hidden" },`)}
  `;
  assert.ok(fired(src), "one-hop binding resolution missed the revert");
  // and the binding resolver really is what found it
  assert.match(constBinding(stripComments(src), "avatarStyle"), /shadowColor/);
});

test("A-2 prop order inside the style object does not hide it", () => {
  const first = `<Image style={{ shadowRadius: 18, borderRadius: 20 }} />`;
  const last = `<Image style={{ borderRadius: 20, shadowRadius: 18 }} />`;
  assert.ok(fired(first), "shadow prop first was missed");
  assert.ok(fired(last), "shadow prop last was missed");
});

test("A-3 borderRadius and the shadow arriving from DIFFERENT style keys is caught", () => {
  const src = `
    const el = <Image source={s} style={[styles.round, styles.glow]} />;
    ${sheet(`  round: { width: 60, height: 60, borderRadius: 30 },\n  glow: { shadowOpacity: 0.26, shadowRadius: 18 },`)}
  `;
  assert.ok(fired(src), "cross-style-key union was missed — this is the shipped shape");
});

test("A-4 formatting variants (newlines, no trailing comma, tight spacing) do not hide it", () => {
  const variants = [
    `<Image style={{\n  borderRadius: 20,\n  shadowOpacity: 0.26\n}} />`,
    `<Image style={{borderRadius:20,shadowOpacity:0.26}} />`,
    `<Image style={{ borderRadius : 20 , shadowOpacity : 0.26 }} />`,
  ];
  for (const v of variants) assert.ok(fired(v), `formatting variant evaded the gate: ${v}`);
});

test("A-5 an explicit `filter:` style is caught, not just shadow*", () => {
  const src = `
    const el = <Image source={s} style={styles.a} />;
    ${sheet(`  a: { borderRadius: 20, filter: "drop-shadow(0 10px 18px rgba(0,0,0,.3))" },`)}
  `;
  assert.ok(fired(src));
});

test("A-6 blurRadius is caught on BOTH routes — as a style key and as an element prop", () => {
  const asStyle = `
    const el = <Image source={s} style={styles.a} />;
    ${sheet(`  a: { borderRadius: 20, blurRadius: 4 },`)}
  `;
  const asProp = `
    const el = <Image source={s} blurRadius={4} style={styles.a} />;
    ${sheet(`  a: { borderRadius: 20 },`)}
  `;
  assert.ok(fired(asStyle), "blurRadius style key missed");
  assert.ok(fired(asProp), "blurRadius element prop missed");
});

test("A-7 a realistically multi-line <Image> tag is parsed whole", () => {
  const src = `
    const el = (
      <Image
        source={{ uri: brand.photo }}
        style={avatarStyle}
        resizeMode="cover"
        accessibilityLabel={\`\${brand.displayName} avatar\`}
      />
    );
    const avatarStyle = [styles.avatar, { borderRadius: size / 2, shadowColor: accent }];
    ${sheet(`  avatar: { borderWidth: 3, overflow: "hidden" },`)}
  `;
  assert.ok(fired(src), "multi-line opening tag was not parsed through to its style");
});

// ---------------------------------------------------------------------------
// B — over-fire
// ---------------------------------------------------------------------------

test("B-1 the FIX's own shape never fires — boxShadow on a wrapper, Image unfiltered", () => {
  const src = `
    const glowStyle = {
      width: size, height: size, borderRadius: size / 2,
      boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 18, spreadDistance: 0, color: hexToRgba(palette.accent, 0.26) }],
    };
    const avatarStyle = [styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: p, borderColor: a }];
    const el = (
      <View style={glowStyle}>
        <Image source={{ uri: brand.photo }} style={avatarStyle} resizeMode="cover" />
      </View>
    );
    ${sheet(`  avatar: { alignItems: "center", justifyContent: "center", borderWidth: 3, overflow: "hidden" },`)}
  `;
  // NOTE the wrapper's boxShadow entry literally contains the key `blurRadius`.
  // A gate that scanned the wrapper, or that matched prop names anywhere in the
  // file, would fire on the fix itself and be reverted within a week.
  assert.deepEqual(run(src).failures, [], "the gate fires on its own fix");
});

test("B-2 the same style set on a <View> is safe and must not fire", () => {
  const src = `
    const el = <View style={styles.card} />;
    ${sheet(`  card: { borderRadius: 20, shadowOpacity: 0.26, shadowRadius: 18, overflow: "hidden" },`)}
  `;
  assert.deepEqual(run(src).failures, [], "a View's own box-shadow is not clipped by its own overflow");
});

test("B-3 <ImageBackground> is a different component and is not matched", () => {
  const src = `
    const el = <ImageBackground source={s} style={styles.a} />;
    ${sheet(`  a: { borderRadius: 20, shadowOpacity: 0.26 },`)}
  `;
  assert.deepEqual(run(src).failures, []);
});

test("B-4 substring look-alikes do not match", () => {
  const src = `
    const el = <Image source={s} style={styles.a} />;
    ${sheet(`  a: { myBorderRadius: 20, shadowRadiusExtra: 18 },`)}
  `;
  assert.deepEqual(run(src).failures, [], "prefix/suffix look-alikes matched as real keys");
});

test("B-5 a prop name inside a string literal is data, not a style key", () => {
  const src = `
    const note = "shadowOpacity: 0.26 was removed here";
    const el = <Image source={s} style={styles.a} accessibilityLabel={\`\${n} avatar\`} />;
    ${sheet(`  a: { borderRadius: 20 },`)}
  `;
  assert.deepEqual(run(src).failures, []);
});

// ---------------------------------------------------------------------------
// C — the gate as an instrument
// ---------------------------------------------------------------------------

test("C-1 the gate is deterministic across repeated runs of the real repo", () => {
  const a = execFileSync("node", [GATE], { cwd: REPO_ROOT, encoding: "utf8" });
  const b = execFileSync("node", [GATE], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(a, b, "two runs of the same tree disagreed");
  assert.match(a, /\d+ \.tsx files swept/);
  const swept = Number(/(\d+) \.tsx files swept/.exec(a)[1]);
  assert.ok(swept > 100, `only ${swept} files swept — the sweep has collapsed`);
});

test("C-2 every failure message names the file, a line number and the offending prop", () => {
  const src = `
    const el = <Image source={s} style={styles.a} />;
    ${sheet(`  a: { borderRadius: 20, shadowOpacity: 0.26 },`)}
  `;
  const { failures } = run(src, "packages/some/Component.tsx");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^packages\/some\/Component\.tsx:\d+:/);
  assert.match(failures[0], /shadowOpacity/);
  assert.match(failures[0], /#2539/);
});

test("C-3 the CLI exits non-zero and prints FAIL when a violation exists", () => {
  // Drive the real CLI against a temp repo root containing one planted file, so
  // the exit-code contract is proven and not assumed.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2539-gate-"));
  try {
    const dir = path.join(tmp, "packages", "brand-rendering");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "PublicBrandPage.tsx"),
      `const el = <Image source={s} style={styles.a} />;\n${sheet(`  a: { borderRadius: 20, shadowOpacity: 0.26 },`)}\n`,
    );
    // The gate resolves its repo root from its own location, so copy it in.
    const gateDir = path.join(tmp, ".github", "scripts", "strict-grep");
    fs.mkdirSync(gateDir, { recursive: true });
    fs.copyFileSync(GATE, path.join(gateDir, path.basename(GATE)));
    let code = 0;
    let out = "";
    try {
      out = execFileSync("node", [path.join(gateDir, path.basename(GATE))], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      code = e.status;
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    assert.equal(code, 1, "planted violation did not produce a non-zero exit");
    assert.match(out, /FAIL: #2539 rnw-image-filter-clip/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
