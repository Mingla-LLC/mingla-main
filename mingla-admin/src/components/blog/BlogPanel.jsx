import { useEffect, useMemo, useState } from "react";
import { BlogPostList } from "./BlogPostList";
import { BlogEditor } from "./BlogEditor";
import { BlogMediaLibrary } from "./BlogMediaLibrary";
import {
  checkBlogLinks, createBlogPost, createBlogPreviewToken, deleteBlogMedia, deleteBlogPost,
  getBlogPermissions, getBlogPost, getFeaturedBlogPost, listBlogMedia, listBlogPosts,
  publishBlogPost, requestBlogPostChanges, revalidateBlog, saveBlogDraft,
  searchBlogLinkTargets, setFeaturedBlogPost, submitBlogPostForReview,
  unpublishBlogPost, updateBlogMedia, uploadBlogImage,
} from "../../services/blogService";

function routeFromHash() {
  const query = window.location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const view = params.get("view");
  return view === "editor" && params.get("post") ? { view, postId: params.get("post") }
    : view === "media" ? { view } : { view: "posts" };
}

function navigate(view, postId) {
  const params = new URLSearchParams({ tab: "blog" });
  if (view !== "posts") params.set("view", view);
  if (postId) params.set("post", postId);
  window.location.hash = `#/support?${params}`;
}

export function BlogPanel({ onCounts }) {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);
  // Keep the contract honest: BlogPanel owns every service the files in this
  // directory may reach, and passes one explicit API surface downward.
  const api = useMemo(() => ({
    checkBlogLinks, createBlogPost, createBlogPreviewToken, deleteBlogMedia, deleteBlogPost,
    getBlogPermissions, getBlogPost, getFeaturedBlogPost, listBlogMedia, listBlogPosts,
    publishBlogPost, requestBlogPostChanges, revalidateBlog, saveBlogDraft,
    searchBlogLinkTargets, setFeaturedBlogPost, submitBlogPostForReview,
    unpublishBlogPost, updateBlogMedia, uploadBlogImage,
  }), []);

  if (route.view === "editor") return <BlogEditor api={api} postId={route.postId} onBack={() => navigate("posts")} />;
  if (route.view === "media") return <BlogMediaLibrary api={api} onBack={() => navigate("posts")} />;
  return <BlogPostList api={api} onOpen={(id) => navigate("editor", id)} onMedia={() => navigate("media")} onCounts={onCounts} />;
}
