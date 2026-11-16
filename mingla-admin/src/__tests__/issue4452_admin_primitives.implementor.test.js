// #4452 §7.1 pass 2 (T-7.1b, SC-146): the shared primitives use the v13
// refresh values. Each primitive is rendered with its real source (esbuild,
// react-dom/server) and its markup is checked for the design's values:
//   Card / SectionCard / StatCard  radius 16, --a-line border, --a-shadow; the
//                                  StatCard 28 x 3 orange tick and serif 34 px value
//   Button       38 px, radius 12, 600; primary ink, hover orange with ink text (Q-10)
//   Input / Select / Textarea  44 px, radius 12, 1.5 px --a-line, ink focus + 4 px ring
//   Tabs         the active underline is --a-text
//   Table        mono 10 px uppercase headings (.12em), cells 14 px x 16 px
//   Badge        600 weight; the status pairs live / stop / sched / draft
//   Toggle       the checked track is --a-text
//   PageHeader   Instrument Serif 34 px / 1, 400, -.01em
//   Sidebar / Header  the ink pill with an orange icon, mono 10 px group labels
//                     (.14em), 36 px items radius 10; frosted header, search radius 10 on --a-soft
// Light and dark come from the same --a-* tokens (issue4452_admin_contrast).
//
// FAILS-ON-REVERT: restoring StatCard's border-l-[3px] look (no tick), a
// brand-orange Tabs underline, h-10 inputs, or the Sidebar's left accent bar
// fails the matching case.
//
// Run: node --test src/__tests__/issue4452_admin_primitives.implementor.test.js (from mingla-admin).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, readSrc } from "./support/issue4452Harness.js";

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup as r } from "react-dom/server";
import { StatCard, SectionCard, Card } from "../../components/ui/Card.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Input, Textarea, Select, Toggle } from "../../components/ui/Input.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { DataTable } from "../../components/ui/Table.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { PageHeader } from "../../components/ui/PageHeader.jsx";
export const stat = () => r(<StatCard label="Live forms" value="3" />);
export const section = () => r(<SectionCard title="Forms">x</SectionCard>);
export const card = () => r(<Card>x</Card>);
export const button = (v) => r(<Button variant={v}>Go</Button>);
export const input = () => r(<Input label="Name" />);
export const textarea = () => r(<Textarea label="Note" />);
export const select = () => r(<Select label="Unit" options={[{ value: "h", label: "hours" }]} />);
export const toggle = (checked) => r(<Toggle checked={checked} onChange={() => {}} label="On" />);
export const tabs = () => r(<Tabs tabs={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} activeTab="a" onChange={() => {}} />);
export const table = () => r(<DataTable columns={[{ key: "n", label: "Name" }]} rows={[{ id: 1, n: "Ada" }]} />);
export const badge = (v) => r(<Badge variant={v}>Live</Badge>);
export const header = () => r(<PageHeader title="Forms" subtitle="Forms on usemingla.com" />);
`, { name: "issue4452-primitives" });
});

describe("#4452 T-7.1b cards", () => {
  it("StatCard: radius 16, line border, shadow, the 28 x 3 orange tick, serif 34 px value", () => {
    const html = h.stat();
    for (const c of ["rounded-2xl", "border-[var(--a-line)]", "shadow-[var(--a-shadow)]", "p-[18px]"]) assert.ok(html.includes(c), c);
    assert.match(html, /data-stat-tick=""[^>]*class="[^"]*h-\[3px\] w-7[^"]*bg-\[#eb7825\]/);
    assert.match(html, /class="font-serif text-\[34px\] font-normal leading-\[1.05\][^"]*">3</);
    assert.doesNotMatch(html, /border-l-\[3px\]/, "the old left stripe is gone");
  });
  it("SectionCard and Card: radius 16, line border, shadow", () => {
    for (const html of [h.section(), h.card()]) {
      for (const c of ["rounded-2xl", "border-[var(--a-line)]", "shadow-[var(--a-shadow)]"]) assert.ok(html.includes(c), c);
    }
  });
});

describe("#4452 T-7.1b controls", () => {
  it("Button: 38 px, radius 12, 600; primary ink with ink-on-orange hover; secondary line border", () => {
    const p = h.button("primary");
    for (const c of ["h-[38px]", "rounded-xl", "font-semibold", "bg-[var(--a-text)]", "text-[var(--a-panel)]", "hover:bg-[var(--a-hover-bg)]", "hover:text-[var(--a-hover-ink)]"]) assert.ok(p.includes(c), c);
    assert.ok(h.button("secondary").includes("border-[var(--a-line)]"));
  });
  it("Input, Select and Textarea: 44 px, radius 12, 1.5 px line border, ink focus with the orange ring", () => {
    for (const html of [h.input(), h.select(), h.textarea()]) {
      for (const c of ["rounded-xl", "border-[1.5px]", "border-[var(--a-line)]", "focus:border-[var(--a-text)]", "focus:shadow-[0_0_0_4px_rgba(235,120,37,.16)]", "text-sm"]) assert.ok(html.includes(c), c);
      assert.match(html, /text-\[12\.5px\] font-semibold text-\[var\(--a-text2\)\]/, "the label");
    }
    assert.ok(h.input().includes("h-11") && h.select().includes("h-11"), "44 px");
  });
  it("Toggle: the checked track is ink", () => {
    assert.ok(h.toggle(true).includes("bg-[var(--a-text)]"));
    assert.ok(!h.toggle(false).includes("bg-[var(--a-text)]"));
  });
  it("Tabs: the active underline is --a-text", () => {
    const html = h.tabs();
    assert.match(html, /aria-selected="true"[^>]*class="[^"]*border-\[var\(--a-text\)\]/);
    assert.doesNotMatch(html, /border-\[var\(--color-brand-500\)\]/);
  });
  it("Table: mono 10 px uppercase headings at .12em; cells 14 x 16", () => {
    const html = h.table();
    assert.match(html, /<th[^>]*class="[^"]*font-mono text-\[10px\] font-medium uppercase tracking-\[0\.12em\]/);
    assert.match(html, /<td[^>]*class="[^"]*px-4 py-3\.5/);
  });
  it("Badge: 600 weight with the status pairs", () => {
    for (const [v, bg, ink] of [["live", "--a-live-bg", "--a-live-ink"], ["stop", "--a-stop-bg", "--a-stop-ink"], ["sched", "--a-sched-bg", "--a-sched-ink"], ["success", "--a-live-bg", "--a-live-ink"]]) {
      const html = h.badge(v);
      assert.ok(html.includes("font-semibold") && html.includes(`bg-[var(${bg})]`) && html.includes(`text-[var(${ink})]`), v);
    }
    assert.ok(h.badge("draft").includes("text-[var(--a-draft-ink)]"));
  });
  it("PageHeader: Instrument Serif 34 px / 1, 400, -.01em", () => {
    assert.match(h.header(), /font-serif text-\[34px\] font-normal leading-none tracking-\[-0\.01em\]/);
  });
});

describe("#4452 T-7.1b menu and header", () => {
  const sidebar = readSrc("components/layout/Sidebar.jsx");
  const headerSrc = readSrc("components/layout/Header.jsx");
  const css = readSrc("globals.css");
  it("Sidebar: 36 px items radius 10; the active item is an ink pill with an orange icon; mono 10 px groups", () => {
    assert.match(sidebar, /"relative flex h-9 w-full items-center gap-2\.5 rounded-\[10px\]/);
    assert.match(sidebar, /bg-\[var\(--sidebar-active-bg\)\] text-\[var\(--sidebar-active-text\)\]/);
    assert.match(sidebar, /isActive \? "text-\[var\(--sidebar-accent\)\]"/);
    assert.match(sidebar, /font-mono text-\[10px\] font-medium uppercase tracking-\[0\.14em\]/);
    assert.doesNotMatch(sidebar, /absolute -left-3 top-2 bottom-2 w-\[3px\]/, "the left accent bar is gone");
    for (const [k, v] of [["--sidebar-bg", "var(--a-bg)"], ["--sidebar-active-bg", "var(--a-active)"], ["--sidebar-active-text", "var(--a-panel)"], ["--sidebar-accent", "var(--a-accent)"], ["--sidebar-border", "var(--a-line)"]]) {
      assert.ok(new RegExp(`${k}:\\s*${v.replace(/[()]/g, "\\$&")};`).test(css), k);
    }
  });
  it("Header: frosted (82% panel, 12 px blur); search radius 10 on --a-soft", () => {
    assert.match(css, /--header-bg:\s*color-mix\(in srgb, var\(--a-panel\) 82%, transparent\);/);
    assert.match(headerSrc, /backdrop-blur-\[12px\]/);
    assert.match(headerSrc, /rounded-\[10px\] border border-transparent bg-\[var\(--a-soft\)\]/);
    assert.doesNotMatch(css, /--header-bg:\s*#0f1117/, "dark mode reads the token too");
  });
});
