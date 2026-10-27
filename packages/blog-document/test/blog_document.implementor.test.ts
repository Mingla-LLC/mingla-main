// #4137 wave 3 — implementor happy path for the shared blog document contract.
// MINGLA-INVARIANT: I-4137-BLOG-RICH-TEXT-TOKENISED | issue #4137 | Blog rich text is tokenised and rebuilt from an allow-list; no `<` survives that this module did not emit.
// Fails on revert: without packages/blog-document the import below does not resolve.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BLOG_BLOCK_TYPES,
  BLOG_READINESS_CHECKS,
  blogCoverIsFeatureSize,
  blogDocumentReferences,
  blogDocumentWordCount,
  blogEmbedFrameSrc,
  blogReadMinutes,
  parseBlogRichText,
  sanitizeBlogRichText,
  validateBlogDocument,
  type BlogDocument,
} from "../src/index.ts";

const PLACE = "11111111-1111-4111-8111-111111111111";
const PLACE_2 = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const MEDIA = "44444444-4444-4444-8444-444444444444";
const MEDIA_2 = "55555555-5555-4555-8555-555555555555";

const everyBlock = {
  version: 1,
  blocks: [
    { id: "para01", type: "paragraph", html: `Start at <a href="https://example.com/a">the lake</a> and <a data-mingla-target="place:${PLACE}">open it</a>.` },
    { id: "head01", type: "heading", level: 2, text: "Walk the boardwalk" },
    { id: "list01", type: "list", ordered: true, items: ["One", "<strong>Two</strong>"] },
    { id: "quote1", type: "quote", html: "The best plans have one outdoor stop.", cite: "Mingla Editorial" },
    { id: "call01", type: "callout", html: "Go early.", tone: "tip" },
    { id: "image1", type: "image", mediaId: MEDIA, alt: "The lake at dusk", caption: "Lake Johnson" },
    { id: "gall01", type: "gallery", layout: "pair", items: [{ mediaId: MEDIA, alt: "Front" }, { mediaId: MEDIA_2, alt: "Inside" }] },
    { id: "video1", type: "video", provider: "youtube", videoId: "dQw4w9WgXcQ", title: "A walk around" },
    { id: "embed1", type: "embed", provider: "spotify", url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" },
    { id: "divid1", type: "divider" },
    { id: "butto1", type: "button", label: "See Raleigh", target: { kind: "page", path: "/cities/raleigh-nc" } },
    { id: "place1", type: "place", placeId: PLACE, style: "card" },
    { id: "offer1", type: "offering", eventId: EVENT, displayTitle: "Bachata social, lesson included", eyebrowCity: "Cary, NC", moodMediaId: MEDIA_2, moodAlt: "A bar lit up" },
    { id: "plan01", type: "plan", title: "A slow Saturday", stops: [PLACE, PLACE_2] },
    { id: "city01", type: "city", citySlug: "raleigh-nc" },
  ],
};

Deno.test("#4137 validator accepts every block type", () => {
  const result = validateBlogDocument(everyBlock);
  assert(result.ok, JSON.stringify(result));
  assertEquals(new Set(everyBlock.blocks.map((b) => b.type)), new Set(BLOG_BLOCK_TYPES));
});

Deno.test("#4137 validator rejects unknown types, missing alt, bad ids and too many blocks", () => {
  const bad = validateBlogDocument({
    version: 1,
    blocks: [
      { id: "x", type: "paragraph", html: "" },
      { id: "imgnoalt", type: "image", mediaId: MEDIA, alt: "  " },
      { id: "unknown1", type: "brand", brandId: "x" },
      { id: "embedbad", type: "embed", provider: "youtube", url: "https://evil.example/watch?v=dQw4w9WgXcQ" },
      { id: "buttonjs", type: "button", label: "Go", target: { kind: "url", href: "javascript:alert(1)" } },
    ],
  });
  assert(!bad.ok);
  assertEquals(bad.errors, [
    "block_0:id_invalid",
    "block_1:alt_required",
    "block_2:type_unsupported",
    "block_3:url_invalid",
    "block_4:target_url_invalid",
  ]);
  const many = validateBlogDocument({ version: 1, blocks: Array.from({ length: 301 }, (_, i) => ({ id: `block-${i}`, type: "divider" })) });
  assert(!many.ok && many.errors.includes("document:too_many_blocks"));
});

Deno.test("#4137 sanitiser keeps the inline allow-list and rebuilds it", () => {
  assertEquals(
    sanitizeBlogRichText('<p class="x"><b>Bold</b> <i>it</i> <u>u</u><br/><a href="https://usemingla.com/cities" target="_blank" onclick="x()">city</a></p>'),
    '<strong>Bold</strong> <em>it</em> <u>u</u><br><a href="https://usemingla.com/cities" target="_blank" rel="noopener noreferrer">city</a>',
  );
  assertEquals(
    sanitizeBlogRichText(`<a data-mingla-target="offering:${EVENT}" href="https://x.example">Open</a>`),
    `<a data-mingla-target="offering:${EVENT}">Open</a>`,
  );
  assertEquals(sanitizeBlogRichText('<a href="/cities/raleigh-nc">Raleigh</a>'), '<a href="/cities/raleigh-nc">Raleigh</a>');
});

Deno.test("#4137 sanitiser neutralises the unterminated-tag class (F-SEC-1) and friends", () => {
  const cases = [
    "<img src=x onerror=alert(1)",
    "<img src=x onerror=alert(1) <p>after</p>",
    '<a href="javascript:alert(1)">x</a>',
    '<a href=" javascript:alert(1)">x</a>',
    "<svg><script>alert(1)</script></svg>",
    "<p onclick=alert(1)>x</p>",
    "&lt;img src=x onerror=alert(1)&gt;",
    '<a data-mingla-target="place:../../x">x</a>',
    '<a href="https://a.example">one<a href="https://b.example">two</a></a>',
    "<scr<script>ipt>alert(1)</script>",
    "<!-- <img src=x onerror=alert(1)> -->ok",
  ];
  for (const input of cases) {
    const out = sanitizeBlogRichText(input);
    const tags = out.match(/<[^>]*>/g) ?? [];
    for (const tag of tags) {
      assert(/^<\/?(strong|em|u|br|a)(\s|>)/.test(tag), `${input} -> ${out}`);
      assert(!/\son[a-z]+=/i.test(tag) && !/javascript:/i.test(tag), `${input} -> ${out}`);
    }
    assertEquals(sanitizeBlogRichText(out), out, `idempotent for ${input}`);
  }
  assertEquals(sanitizeBlogRichText("<img src=x onerror=alert(1)"), "&lt;img src=x onerror=alert(1)");
  assertEquals(sanitizeBlogRichText("<!-- <img src=x onerror=alert(1)> -->ok"), "ok");
  assertEquals(sanitizeBlogRichText("&lt;b&gt; &amp; &copy;"), "&lt;b&gt; &amp; ©");
  const long = "a".repeat(50_000) + "<b";
  assertEquals(sanitizeBlogRichText(long).length, 50_000 + 5);
});

Deno.test("#4137 parse tree exposes app links for the device CTA", () => {
  const tree = parseBlogRichText(`Go to <strong><a data-mingla-target="place:${PLACE}">the bar</a></strong>`);
  assertEquals(tree, [
    { type: "text", text: "Go to " },
    { type: "strong", children: [{ type: "app_link", target: { kind: "place", id: PLACE }, children: [{ type: "text", text: "the bar" }] }] },
  ]);
});

Deno.test("#4137 references, word count and read minutes", () => {
  const doc = everyBlock as unknown as BlogDocument;
  const refs = blogDocumentReferences(doc);
  assertEquals(refs.placeIds.sort(), [PLACE, PLACE_2].sort());
  assertEquals(refs.eventIds, [EVENT]);
  assertEquals(refs.mediaIds.sort(), [MEDIA, MEDIA_2].sort());
  assertEquals(refs.citySlugs, ["raleigh-nc"]);
  assertEquals(refs.urls.sort(), ["https://example.com/a", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"].sort());
  assertEquals(refs.pagePaths, ["/cities/raleigh-nc"]);
  assertEquals(blogDocumentWordCount(doc), 23);
  assertEquals(blogReadMinutes(doc), 1);
  assertEquals(blogReadMinutes({ version: 1, blocks: [{ id: "para01", type: "paragraph", html: "word ".repeat(461) }] }), 3);
});

Deno.test("#4137 embeds, cover rule and readiness ids", () => {
  assertEquals(
    blogEmbedFrameSrc({ id: "e00001", type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" }),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  assertEquals(blogEmbedFrameSrc({ id: "e00002", type: "embed", provider: "instagram", url: "https://www.instagram.com/p/abc/" }), null);
  assert(blogCoverIsFeatureSize(2400, 1200));
  assert(!blogCoverIsFeatureSize(1000, 600));
  assert(!blogCoverIsFeatureSize(1600, 1200));
  assertEquals(BLOG_READINESS_CHECKS.map((c) => c.id), [
    "title", "category", "slug", "cover_present", "cover_size", "image_alt", "image_source",
    "links_live", "places_live", "offerings_public", "city_links", "seo_lengths",
  ]);
});
