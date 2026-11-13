// Issue #4419 — the Admin email body editor typed backwards, and its From
// labels named the wrong sender.
//
//   C-1  typing "abc" one character at a time, caret at the end, keeps the
//        order and keeps the caret at the end (jsdom, a real React render)
//   C-2  the old dangerouslySetInnerHTML pattern DOES scramble the same
//        typing in this harness, so C-1 proves something
//   C-3  a loaded template or draft, "New email", and a toolbar/token change
//        that reports different HTML still replace the block content; HTML
//        from outside is sanitised
//   C-4  the composer renders the block through EditableRichBlock and no
//        longer uses dangerouslySetInnerHTML on the editable
//   C-5  From and Replies labels read lib/adminEmailSender.js, which equals
//        the admin-send-email function's ADMIN_SENDER / ADMIN_REPLY_TO
//
// FAILS-ON-REVERT: putting `dangerouslySetInnerHTML={{ __html: ... }}` back on
// the contentEditable reds C-4; making EditableRichBlock write innerHTML on
// every render reds C-1; changing hello@campaigns.usemingla.com in either the
// function or the admin constant reds C-5.
//
// Run: node --test src/__tests__/issue_4419_composer_caret.implementor.test.js
// (from mingla-admin, after `npm ci`; nothing leaves this machine).
/* eslint-disable react-hooks/immutability -- test harness hands React state to the test through a probe object */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "InputEvent", "Event", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let vite;
let React;
let act;
let createRoot;
let EditableRichBlock;

before(async () => {
  React = (await import("react")).default;
  ({ act } = await import("react"));
  ({ createRoot } = await import("react-dom/client"));
  vite = await createServer({ root: ROOT, appType: "custom", server: { middlewareMode: true }, logLevel: "silent" });
  ({ EditableRichBlock } = await vite.ssrLoadModule("/src/components/email/EditableRichBlock.jsx"));
});
after(async () => { await vite?.close(); });

function caretToEnd(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// What a browser does for one keystroke: put the character at the caret, move
// the caret after it, then fire `input`.
function typeChar(node, char) {
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  if (range.startContainer.nodeType === 3) {
    range.startContainer.insertData(range.startOffset, char);
    range.setStart(range.startContainer, range.startOffset + char.length);
  } else {
    const text = document.createTextNode(char);
    range.startContainer.insertBefore(text, range.startContainer.childNodes[range.startOffset] || null);
    range.setStart(text, char.length);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  node.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText", data: char }));
}

// Stateful host like the composer: every input writes the DOM's HTML into state.
function Host({ initial, Block, probe }) {
  const [html, setHtml] = React.useState(initial);
  probe.setHtml = setHtml;
  probe.html = html;
  return React.createElement(Block, {
    html,
    editorRef: (node) => { probe.node = node; },
    onFocus: () => {},
    onHtmlChange: setHtml,
    className: "editor",
  });
}

function OldBlock({ html, editorRef, onHtmlChange }) {
  return React.createElement("div", {
    ref: editorRef,
    contentEditable: true,
    suppressContentEditableWarning: true,
    onInput: (event) => onHtmlChange(event.currentTarget.innerHTML),
    dangerouslySetInnerHTML: { __html: html },
  });
}

async function mount(initial, Block = EditableRichBlock) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const probe = {};
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(Host, { initial, Block, probe })); });
  return { probe, root, host };
}

async function typeAll(probe, text) {
  caretToEnd(probe.node);
  for (const char of text) await act(async () => { typeChar(probe.node, char); });
}

describe("#4419 composer body typing", () => {
  it("C-1 typing abc keeps abc and keeps the caret at the end", async () => {
    const { probe, root } = await mount("<p>Hi </p>");
    probe.node.firstChild.firstChild; // the text node inside <p>
    const range = document.createRange();
    range.selectNodeContents(probe.node.querySelector("p"));
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    for (const char of "abc") await act(async () => { typeChar(probe.node, char); });
    assert.equal(probe.node.innerHTML, "<p>Hi abc</p>");
    assert.equal(probe.html, "<p>Hi abc</p>", "state follows the DOM");
    const selection = window.getSelection();
    assert.ok(probe.node.contains(selection.anchorNode), "caret is still inside the editor");
    assert.equal(selection.anchorNode.textContent.slice(selection.anchorOffset), "", "caret is at the end, not the start");
    await act(async () => root.unmount());
  });

  it("C-1b typing into an empty block also stays in order", async () => {
    const { probe, root } = await mount("");
    await typeAll(probe, "hello");
    assert.equal(probe.node.textContent, "hello");
    assert.equal(window.getSelection().anchorOffset, 5);
    await act(async () => root.unmount());
  });

  it("C-2 control: the old dangerouslySetInnerHTML pattern scrambles the same typing", async () => {
    const { probe, root } = await mount("", OldBlock);
    await typeAll(probe, "abc");
    assert.notEqual(probe.node.textContent, "abc", "harness reproduces the bug on the old pattern");
    await act(async () => root.unmount());
  });

  it("C-3 a loaded draft, New email and token/toolbar HTML replace the block; outside HTML is sanitised", async () => {
    const { probe, root } = await mount("<p>first</p>");
    await typeAll(probe, "x");
    await act(async () => { probe.setHtml("<p>Loaded draft</p>"); });
    assert.equal(probe.node.innerHTML, "<p>Loaded draft</p>");
    await act(async () => { probe.setHtml("<p>Hi {first_name}</p>"); }); // insert token / toolbar result
    assert.equal(probe.node.innerHTML, "<p>Hi {first_name}</p>");
    await act(async () => { probe.setHtml("<p>New</p><script>alert(1)</script><img src=x onerror=alert(1)>"); });
    assert.equal(probe.node.innerHTML, "<p>New</p>");
    await act(async () => { probe.setHtml("<p><br></p>"); }); // New email
    assert.equal(probe.node.innerHTML, "<p><br></p>");
    await act(async () => root.unmount());
  });

  it("C-3b a toolbar action that already changed the DOM does not rewrite it (selection survives)", async () => {
    const { probe, root } = await mount("<p>Hello world</p>");
    const textNode = probe.node.querySelector("p").firstChild;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const paragraph = probe.node.querySelector("p");
    paragraph.insertBefore(document.createElement("strong"), null); // execCommand-like DOM change
    paragraph.lastChild.textContent = "!";
    await act(async () => { probe.node.dispatchEvent(new window.InputEvent("input", { bubbles: true })); });
    assert.equal(probe.node.querySelector("p"), paragraph, "the same element is still there: no innerHTML rewrite");
    assert.equal(window.getSelection().anchorNode, textNode);
    assert.equal(window.getSelection().anchorOffset, 5);
    await act(async () => root.unmount());
  });

  it("C-4 the composer uses EditableRichBlock and no longer sets innerHTML through React", () => {
    const composer = read("src/components/email/EmailComposer.jsx");
    assert.match(composer, /<EditableRichBlock/);
    assert.doesNotMatch(composer, /dangerouslySetInnerHTML=\{\{ __html: sanitizeLocalRichText\(block\.html\) \}\}/);
    const block = read("src/components/email/EditableRichBlock.jsx");
    assert.doesNotMatch(block, /dangerouslySetInnerHTML/);
    assert.match(block, /node\.innerHTML === html/);
  });

  it("C-5 From and Replies read one shared constant that equals the function's", () => {
    const composer = read("src/components/email/EmailComposer.jsx");
    assert.doesNotMatch(composer, /Mingla &lt;hello@usemingla\.com&gt;/);
    assert.equal((composer.match(/\{ADMIN_EMAIL_FROM_LABEL\}/g) || []).length, 2, "From box and send review");
    assert.equal((composer.match(/\{ADMIN_EMAIL_REPLY_TO\}/g) || []).length, 2, "Replies box and send review");
    const fn = fs.readFileSync(path.join(ROOT, "..", "supabase/functions/admin-send-email/index.ts"), "utf8");
    const sender = fn.match(/export const ADMIN_SENDER[^=]*=\s*\{\s*name:\s*"([^"]+)",\s*address:\s*"([^"]+)"/);
    const replyTo = fn.match(/const ADMIN_REPLY_TO = "([^"]+)"/);
    assert.ok(sender && replyTo, "function constants found");
    const constants = read("src/lib/adminEmailSender.js");
    assert.ok(constants.includes(`name: "${sender[1]}"`));
    assert.ok(constants.includes(`address: "${sender[2]}"`));
    assert.ok(constants.includes(`ADMIN_EMAIL_REPLY_TO = "${replyTo[1]}"`));
    assert.equal(sender[2], "hello@campaigns.usemingla.com");
  });
});
