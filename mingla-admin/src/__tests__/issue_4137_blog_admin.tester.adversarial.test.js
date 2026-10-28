// #4137 tester: adversarial Admin paste, stale-save and Email Blog-post contracts.
import { assert, assertEquals, assertMatch, assertNotMatch, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeBlogRichText } from "../../../packages/blog-document/src/index.ts";
import { emailBlogPostValidationError } from "../lib/emailBlogPostBlocks.js";
import { validateDocument } from "../../../supabase/functions/admin-send-email/model.ts";

const read = (relative) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

Deno.test("#4137 tester: pasted HTML is rebuilt as inert inline markup", async () => {
  const attacks = [
    '<img src=x onerror=alert(1)',
    '<style>body{display:none}</style><strong>kept</strong>',
    '<script>alert(1)</script><em>safe</em>',
    '<a href=" javascript:alert(1)" onclick="alert(2)">bad</a>',
    '&lt;img src=x onerror=alert(1)&gt;',
    '<a data-mingla-target="place:../../x">bad target</a>',
  ];
  for (const attack of attacks) {
    const clean = sanitizeBlogRichText(attack);
    assertNotMatch(clean, /<(?:script|style|img|svg|iframe)\b|<[^>]+\son[a-z]+\s*=|href=["']\s*javascript:/i, clean);
  }
  assertEquals(sanitizeBlogRichText(sanitizeBlogRichText(attacks.join(""))), sanitizeBlogRichText(attacks.join("")), "sanitisation must be idempotent");
  const textBlock = await read("components/blog/BlogTextBlock.jsx");
  assertMatch(textBlock, /onPaste=\{\(event\) => \{[\s\S]*event\.preventDefault\(\)[\s\S]*sanitizeBlogRichText\(incoming\)/);
});
Deno.test("#4137 tester: unavailable Email posts have no keyboard-add control", async () => {
  const picker = await read("components/email/EmailBlogPostPicker.jsx");
  assertMatch(picker, /aria-disabled=\{!post\.available \|\| undefined\}/);
  assertMatch(picker, /\{post\.available && \([\s\S]*onClick=\{\(\) => onChoose\(post\)\}/);
  assertNotMatch(picker, /onKeyDown=.*onChoose/);
});
Deno.test("#4137 tester: personalization tokens are rejected by client and server", () => {
  const postId = "41370000-0000-4000-8000-000000000001";
  const block = { id: "blog-1", type: "blog_post", postId, style: "card", buttonText: "Hello {first_name}" };
  assertEquals(emailBlogPostValidationError([block], new Set()), "Remove personalization tokens and line breaks from the blog post button");
  assertThrows(() => validateDocument({ version: 1, blocks: [block] }), Error, "email_block_blog_post_button_invalid");
});
Deno.test("#4137 tester: stale saves surface as PT409 and never become a silent overwrite", async () => {
  const service = await read("services/blogService.js");
  const editor = await read("components/blog/BlogEditor.jsx");
  const migration = await Deno.readTextFile(new URL("../../../supabase/migrations/20280123004137_issue_4137_blog_staff_workflow.sql", import.meta.url));
  assertMatch(service, /error\?\.code === "PT409"[\s\S]*BlogServiceError\("stale"/);
  assertMatch(editor, /Someone else changed this post\. Reload/);
  assertMatch(migration, /v_post\.revision <> p_expected_revision[\s\S]*ERRCODE = 'PT409'/);
  assertNotMatch(migration, /ERRCODE\s*=\s*'40001'/);
});
