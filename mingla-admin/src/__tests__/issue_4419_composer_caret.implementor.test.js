// Issue #4419 — the Admin email body editor typed backwards, and its From
// labels named the wrong sender.
//
//   C-1  typing "a","b","c" (the node's own innerHTML reported back as html)
//        never rewrites the node and keeps the order
//   C-2  different incoming html (draft, template, New email, token) IS
//        written, and sanitised
//   C-3  the rich_text block renders EditableRichBlock and no longer uses
//        dangerouslySetInnerHTML (the approach that scrambled typing)
//   C-4  From, Replies and the preview footer read lib/adminEmailSender.js,
//        which equals the admin-send-email function's constants
//
// FAILS-ON-REVERT: putting `dangerouslySetInnerHTML={{ __html: ... }}` back on
// the contentEditable reds C-3; dropping the equality guard in
// syncEditableHtml reds C-1; changing hello@campaigns.usemingla.com in either
// the function or the admin constant reds C-4.
//
// Run: node --test src/__tests__/issue_4419_composer_caret.implementor.test.js
// (from mingla-admin, after `npm ci`; nothing leaves this machine).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeLocalRichText, syncEditableHtml } from "../components/email/richText.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function fakeNode(initial) {
  const node = { writes: 0, _html: initial };
  Object.defineProperty(node, "innerHTML", {
    get() { return this._html; },
    set(value) { this._html = value; this.writes += 1; },
  });
  return node;
}

describe("#4419 composer body typing", () => {
  it("C-1 typing a, b, c never rewrites the node and keeps abc in order", () => {
    const node = fakeNode("<p>Hi </p>");
    assert.equal(syncEditableHtml(node, "<p>Hi </p>"), false);
    let typed = "";
    for (const char of "abc") {
      typed += char;
      node._html = `<p>Hi ${typed}</p>`; // the browser put the character in the DOM
      assert.equal(syncEditableHtml(node, node.innerHTML), false, "state echoes the DOM: no write");
    }
    assert.equal(node.writes, 0);
    assert.equal(node.innerHTML, "<p>Hi abc</p>");
  });

  it("C-2 different incoming html (draft, template, New email, token) is written and sanitised", () => {
    const node = fakeNode("");
    assert.equal(syncEditableHtml(node, "<p>Loaded draft</p>"), true);
    assert.equal(node.innerHTML, "<p>Loaded draft</p>");
    assert.equal(syncEditableHtml(node, "<p>New</p><script>alert(1)</script><img src=x onerror=alert(1)>"), true);
    assert.equal(node.innerHTML, "<p>New</p>");
    assert.equal(syncEditableHtml(node, "<p><br></p>"), true);
    assert.equal(node.innerHTML, "<p><br></p>");
    assert.equal(node.writes, 3);
    assert.equal(sanitizeLocalRichText("<p>x</p><script>y</script>"), "<p>x</p>");
  });

  it("C-3 the rich_text block renders EditableRichBlock and no longer uses dangerouslySetInnerHTML", () => {
    const composer = read("src/components/email/EmailComposer.jsx");
    assert.match(composer, /<EditableRichBlock/);
    assert.doesNotMatch(composer, /dangerouslySetInnerHTML=\{\{ __html: sanitizeLocalRichText\(block\.html\) \}\}/);
    const block = read("src/components/email/EditableRichBlock.jsx");
    assert.doesNotMatch(block, /dangerouslySetInnerHTML/);
    assert.match(block, /syncEditableHtml\(nodeRef\.current, html\)/);
  });

  it("C-4 From, Replies and the footer read one shared constant that equals the function's", () => {
    const composer = read("src/components/email/EmailComposer.jsx");
    assert.doesNotMatch(composer, /hello@usemingla\.com/);
    assert.equal((composer.match(/\{ADMIN_EMAIL_FROM_LABEL\}/g) || []).length, 2, "From box and send review");
    assert.equal((composer.match(/\{ADMIN_EMAIL_REPLY_TO\}/g) || []).length, 2, "Replies box and send review");
    assert.match(composer, /\{ADMIN_EMAIL_SENDER\.address\}/);
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
