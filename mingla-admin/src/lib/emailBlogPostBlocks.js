export const MAX_EMAIL_BLOG_POSTS = 3;

export function blogPostSnapshot(post) {
  return {
    slug: post.slug,
    title: post.title,
    summary: post.summary || "",
    categoryLabel: post.categoryLabel || "Mingla",
    readMinutes: Number(post.readMinutes || 1),
    coverUrl: post.coverUrl || null,
    coverAlt: post.coverAlt || "",
    versionId: post.versionId || "",
  };
}
export function appendEmailBlogPost(documentValue, post, id) {
  return [
    ...documentValue,
    {
      id,
      type: "blog_post",
      postId: post.postId,
      style: "card",
      buttonText: "Read on the blog",
      snapshot: blogPostSnapshot(post),
    },
    { id: `${id}-text`, type: "rich_text", html: "<p><br></p>" },
  ];
}

export function swapEmailBlogPost(documentValue, blockId, post) {
  return documentValue.map((block) => block.id === blockId
    ? { ...block, postId: post.postId, snapshot: blogPostSnapshot(post) }
    : block);
}

export function refreshEmailBlogPostSnapshots(documentValue, posts) {
  const options = new Map(posts.map((post) => [post.postId, post]));
  const unavailablePostIds = new Set();
  const document = documentValue.map((block) => {
    if (block.type !== "blog_post") return block;
    const post = options.get(block.postId);
    if (!post || !post.available) unavailablePostIds.add(block.postId);
    return post ? { ...block, snapshot: blogPostSnapshot(post) } : block;
  });
  return { document, unavailablePostIds };
}

export function emailBlogPostValidationError(documentValue, unavailablePostIds) {
  const blocks = documentValue.filter((block) => block.type === "blog_post");
  if (blocks.length > MAX_EMAIL_BLOG_POSTS) return "Use up to 3 blog posts per email";
  if (blocks.some((block) => !block.buttonText?.trim())) return "Add button text to the blog post";
  if (blocks.some((block) => block.buttonText.trim().length > 40 || /[{}\r\n]/.test(block.buttonText))) {
    return "Remove personalization tokens and line breaks from the blog post button";
  }
  if (blocks.some((block) => unavailablePostIds.has(block.postId))) {
    return "A blog post in this email isn't published";
  }
  return null;
}
