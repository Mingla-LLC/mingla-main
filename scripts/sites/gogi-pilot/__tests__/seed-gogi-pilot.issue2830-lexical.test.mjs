// Issue #2830. The CMS rich_text block stores its words in `content`, a Lexical
// document, NOT in a `paragraphs` array.
//
// The seed wrote `paragraphs`. Payload silently drops unknown fields, and
// `draft: true` skips the `required` check on `content`, so the block saved with
// NO text and nothing anywhere said so. The artifact then published
// `paragraphs: []`, which the contract rejects, and the publish failed closed.
//
// Two silent steps in a row: an ignored field, then a skipped validation. Only
// executing a real publish surfaced it.
import assert from "node:assert/strict";
import test from "node:test";

import { SEED_PAGE_ROLES, seedDocuments } from "../seed-gogi-pilot.mjs";

const docs = () =>
  seedDocuments({
    heroMediaId: "00000000-0000-4000-8000-000000000001",
    homeId: "h", aboutId: "a", menuId: "m", galleryId: "g", contactId: "c",
    tenantId: "00000000-0000-4000-8000-000000000002",
  });

const richTextBlocks = () =>
  SEED_PAGE_ROLES.flatMap((role) => docs()[role].blocks)
    .filter((block) => block.blockType === "rich_text");

test("the seed writes rich text into the field the CMS actually has", () => {
  const blocks = richTextBlocks();
  assert.ok(blocks.length > 0, "no rich_text block to check");
  for (const block of blocks) {
    assert.equal("paragraphs" in block, false, `${block.heading} still writes paragraphs`);
    assert.ok(block.content, `${block.heading} has no content`);
  }
});

test("the content is a Lexical document Payload will accept", () => {
  for (const block of richTextBlocks()) {
    assert.equal(block.content.root.type, "root");
    assert.ok(Array.isArray(block.content.root.children));
    assert.ok(block.content.root.children.length >= 1);
    for (const paragraph of block.content.root.children) {
      assert.equal(paragraph.type, "paragraph");
      assert.equal(paragraph.children[0].type, "text");
      assert.equal(typeof paragraph.children[0].text, "string");
      assert.notEqual(paragraph.children[0].text.trim(), "");
    }
  }
});

test("every published paragraph survives extraction the way the builder does it", () => {
  /*
   * Mirrors artifactBuilder.lexicalText: walk from `root`, collect `text`,
   * break on `children`. If the seed's shape and that walk ever disagree, the
   * block publishes empty and the artifact contract rejects it.
   */
  const extract = (value) => {
    const out = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (typeof node.text === "string") out.push(node.text);
      if (Array.isArray(node.children)) {
        const before = out.length;
        node.children.forEach(walk);
        if (out.length > before) out.push("\n");
      }
    };
    walk(value?.root ?? value);
    return out.join("").split("\n").map((t) => t.trim()).filter(Boolean);
  };

  for (const block of richTextBlocks()) {
    const paragraphs = extract(block.content);
    // The contract requires at least one and at most 30.
    assert.ok(paragraphs.length >= 1, `${block.heading} extracts to nothing`);
    assert.ok(paragraphs.length <= 30);
    for (const text of paragraphs) assert.ok(text.length <= 2000);
  }
});

test("gögi's own words are the ones that survive", () => {
  const home = docs().home.blocks.find((b) => b.blockType === "rich_text");
  const first = home.content.root.children[0].children[0].text;
  assert.match(first, /show up exactly as you are/);
});
