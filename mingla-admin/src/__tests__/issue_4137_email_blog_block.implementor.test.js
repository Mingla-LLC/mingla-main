import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendEmailBlogPost,
  emailBlogPostValidationError,
  refreshEmailBlogPostSnapshots,
  swapEmailBlogPost,
} from "../lib/emailBlogPostBlocks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const COMPOSER = read("src/components/email/EmailComposer.jsx");
const PICKER = read("src/components/email/EmailBlogPostPicker.jsx");
const POST = {
  postId: "41370000-0000-4000-a000-000000000001",
  slug: "real-story",
  title: "Real story",
  summary: "A good night out.",
  categoryLabel: "Going out",
  readMinutes: 3,
  coverUrl: "https://example.com/cover.jpg",
  coverAlt: "Friends at dinner",
  versionId: "version-1",
  available: true,
};

describe("#4137 Admin email blog post block", () => {
  it("puts Blog post immediately after Divider and exposes the published-only picker states", () => {
    const divider = COMPOSER.indexOf('title="Add divider"');
    const blog = COMPOSER.indexOf('title="Add blog post"');
    assert.ok(divider >= 0 && blog > divider);
    assert.match(PICKER, /Published posts only/);
    assert.match(PICKER, /Search published posts/);
    assert.match(PICKER, /The blog isn't switched on yet\./);
    assert.match(PICKER, /aria-disabled=/);
  });

  it("adds defaults, swaps only the post identity, and appends a text block", () => {
    const added = appendEmailBlogPost([], POST, "block-1");
    assert.equal(added.length, 2);
    assert.deepEqual(added[0], {
      id: "block-1",
      type: "blog_post",
      postId: POST.postId,
      style: "card",
      buttonText: "Read on the blog",
      snapshot: {
        slug: POST.slug,
        title: POST.title,
        summary: POST.summary,
        categoryLabel: POST.categoryLabel,
        readMinutes: POST.readMinutes,
        coverUrl: POST.coverUrl,
        coverAlt: POST.coverAlt,
        versionId: POST.versionId,
      },
    });
    const swapped = swapEmailBlogPost([{ ...added[0], style: "row", buttonText: "See it" }], "block-1", { ...POST, postId: "41370000-0000-4000-a000-000000000002", title: "Fresh title" });
    assert.equal(swapped[0].style, "row");
    assert.equal(swapped[0].buttonText, "See it");
    assert.equal(swapped[0].snapshot.title, "Fresh title");
  });

  it("refreshes snapshots and blocks empty, unavailable, and fourth blog posts", () => {
    const documentValue = appendEmailBlogPost([], POST, "block-1");
    const refreshed = refreshEmailBlogPostSnapshots(documentValue, [{ ...POST, title: "Latest published title", available: true }]);
    assert.equal(refreshed.document[0].snapshot.title, "Latest published title");
    assert.equal(emailBlogPostValidationError(refreshed.document, refreshed.unavailablePostIds), null);
    assert.equal(emailBlogPostValidationError([{ ...refreshed.document[0], buttonText: "" }], new Set()), "Add button text to the blog post");
    assert.match(emailBlogPostValidationError([{ ...refreshed.document[0], buttonText: "Read {first_name}" }], new Set()), /personalization tokens/);
    assert.equal(emailBlogPostValidationError(refreshed.document, new Set([POST.postId])), "A blog post in this email isn't published");
    assert.equal(emailBlogPostValidationError(Array.from({ length: 4 }, (_, index) => ({ ...refreshed.document[0], id: `b${index}` })), new Set()), "Use up to 3 blog posts per email");
  });

  it("refreshes referenced posts on restore/load and again before review", () => {
    assert.match(COMPOSER, /action: "blog_posts", ids/);
    assert.match(COMPOSER, /async function openReview/);
    assert.match(COMPOSER, /refreshEmailBlogPostSnapshots\(candidateDocument/);
    assert.match(COMPOSER, /This post is no longer published\. Swap or remove it\./);
    assert.match(COMPOSER, /LocalEmailPreview/);
  });
});
