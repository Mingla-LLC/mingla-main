import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";

function publishedLabel(post) {
  if (!post.publishedAt) return post.categoryLabel;
  return `${post.categoryLabel} · published ${new Date(post.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}
export function EmailBlogPostPicker({ open, onClose, callEdgeFunction, existingPostIds, onChoose }) {
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      callEdgeFunction({ action: "blog_posts", query: query.trim() })
        .then((result) => {
          if (!cancelled) setPosts(result.posts || []);
        })
        .catch((requestError) => {
          if (!cancelled) {
            const message = String(requestError?.message || requestError);
            setError(message.includes("blog_not_ready") ? "not_ready" : "failed");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [callEdgeFunction, open, query, reload]);

  return (
    <Modal open={open} onClose={onClose} title="Add a blog post" size="md">
      <ModalBody>
        <p className="-mt-2 mb-4 text-sm text-[var(--color-text-secondary)]">Published posts only</p>
        <label className="relative block">
          <span className="sr-only">Search published posts</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--color-text-tertiary)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search published posts"
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] pl-9 pr-3 text-sm outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
          />
        </label>

        <div className="mt-4 min-h-40 space-y-2" aria-live="polite">
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-5 text-sm text-[var(--color-text-secondary)]">
              <Spinner size="xs" /> Loading posts…
            </div>
          ) : error === "not_ready" ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900">The blog isn't switched on yet.</p>
          ) : error ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
              <span>Posts didn't load.</span>
              <button type="button" onClick={() => setReload((value) => value + 1)} className="font-semibold underline">Retry</button>
            </div>
          ) : posts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--gray-300)] px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">No published posts match.</p>
          ) : posts.map((post) => {
            const added = existingPostIds.has(post.postId);
            return (
              <div
                key={post.postId}
                aria-disabled={!post.available || undefined}
                className={`flex items-center justify-between gap-3 rounded-lg border border-[var(--gray-200)] px-4 py-3 ${post.available ? "" : "opacity-55"}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{post.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{post.available ? publishedLabel(post) : post.reason}</p>
                </div>
                {post.available && (
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => onChoose(post)}
                    className="shrink-0 rounded-lg border border-[var(--color-brand-300)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] disabled:cursor-not-allowed disabled:border-[var(--gray-200)] disabled:text-[var(--color-text-tertiary)]"
                  >
                    {added ? "Added" : "Add"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
}
