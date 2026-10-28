import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { renderGenericBody } from "../genericBody.ts";
import {
  listBlogPostOptions,
  renderBlogPostBlockText,
  resolveBlogPostBlocks,
} from "../blogPostBlock.ts";

const reference = {
  id: "b",
  type: "blog_post" as const,
  postId: "41370000-0000-4000-a000-000000000001",
  style: "card" as const,
  buttonText: "Read on the blog",
  snapshot: { title: "FAKE CLIENT TITLE" } as any,
};
function fakeClient(rows: unknown[], error: unknown = null) {
  const chain: any = {
    select: () => chain,
    in: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    lte: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    ilike: () => chain,
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: rows, error }),
  };
  return { from: () => chain };
}
const row = {
  id: reference.postId,
  slug: "real-story",
  status: "published",
  category: { label: "Going out" },
  version: {
    id: "v1",
    title: "Real server title",
    summary: "<unsafe> & escaped",
    read_minutes: 3,
    cover_alt: "Friends out",
    cover: { storage_path: "u/m.jpg", alt: "" },
  },
};

Deno.test("#4137 resolver ignores the client snapshot and resolves the public database row", async () => {
  const result = await resolveBlogPostBlocks(fakeClient([row]) as any, [
    reference,
  ], "https://project.supabase.co");
  assertEquals(result.missing, []);
  const resolved: any = result.document[0];
  assertEquals(resolved.title, "Real server title");
  assertEquals(resolved.url, "https://usemingla.com/blog/real-story");
  assertEquals(
    resolved.coverUrl,
    "https://project.supabase.co/storage/v1/object/public/blog-media/u/m.jpg",
  );
  assertEquals(
    renderBlogPostBlockText(resolved),
    "Real server title\n<unsafe> & escaped\nRead on the blog: https://usemingla.com/blog/real-story",
  );
});

Deno.test("#4137 picker options use staff title search results and expose unavailable reasons", async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const options = await listBlogPostOptions(
    fakeClient([{
      ...row,
      publish_at: future,
      take_down_at: null,
      deleted_at: null,
      published: row.version,
      draft: {
        ...row.version,
        title: "Draft title must not replace staff result",
      },
    }]) as any,
    {
      staffPosts: [{
        id: reference.postId,
        title: "Title matched by staff RPC",
        derived_state: "scheduled",
      }],
      supabaseUrl: "https://project.supabase.co",
    },
  );
  assertEquals(options[0].title, "Title matched by staff RPC");
  assertEquals(options[0].available, false);
  assertEquals(options[0].state, "scheduled");
  assertStringIncludes(options[0].reason ?? "", "Can be added once it's published.");
});

Deno.test("#4137 all three email-safe styles escape values and use safe https links", async () => {
  const resolved: any = (await resolveBlogPostBlocks(
    fakeClient([row]) as any,
    [reference],
    "https://project.supabase.co",
  )).document[0];
  for (const style of ["card", "row", "link"] as const) {
    const rendered = renderGenericBody({
      variant: "admin_compose",
      title: "News",
      paragraphs: [],
      document: [{ ...resolved, style }],
    });
    assertStringIncludes(rendered.html, "Real server title");
    assertStringIncludes(
      rendered.html,
      "https://usemingla.com/blog/real-story",
    );
    assertEquals(rendered.html.includes("<unsafe>"), false);
    assertEquals(rendered.html.includes("FAKE CLIENT TITLE"), false);
  }
});
