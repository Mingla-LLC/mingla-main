import { useCallback, useEffect, useState } from "react";
import { CalendarClock, FileCheck2, FileText, Image, Plus, Search } from "lucide-react";
import { Button } from "../ui/Button";
import { AlertCard, StatCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { BLOG_CATEGORIES } from "../../lib/blogLinkTargets";

const FILTERS = [[null, "All"], ["draft", "Drafts"], ["in_review", "In review"], ["scheduled", "Scheduled"], ["published", "Published"]];
const STATUS = { draft: "Draft", in_review: "In review", scheduled: "Scheduled", published: "Published", taken_down: "Taken down", unpublished: "Unpublished" };
const STATUS_CLASS = { draft:"bg-[var(--gray-100)] text-[var(--color-text-secondary)]",in_review:"bg-amber-100 text-amber-800",scheduled:"bg-blue-100 text-blue-800",published:"bg-green-100 text-green-800",taken_down:"bg-[var(--gray-100)] text-[var(--color-text-secondary)]",unpublished:"bg-[var(--gray-100)] text-[var(--color-text-secondary)]" };

function relativeTime(value) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export function BlogPostList({ api, onOpen, onMedia, onCounts }) {
  const [result, setResult] = useState({ posts: [], counts: {} });
  const [filter, setFilter] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("going-out");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [data, permissions] = await Promise.all([
        api.listBlogPosts({ status: filter, query }),
        api.getBlogPermissions(),
      ]);
      setResult(data || { posts: [], counts: {} });
      onCounts?.(permissions?.can_publish ? Number(data?.counts?.in_review || 0) : 0);
    } catch (nextError) { setError(nextError); }
    finally { setLoading(false); }
  }, [api, filter, query, onCounts]);

  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);

  async function create() {
    if (!title.trim()) return;
    setCreating(true);
    try { const post = await api.createBlogPost(title.trim(), category); onOpen(post.id); }
    catch (nextError) { setError(nextError); setCreating(false); }
  }

  if (error?.code === "blog_not_ready") return <AlertCard title="The blog isn't switched on yet.">The database migration must be applied before staff can write posts.</AlertCard>;
  return (
    <div className="space-y-5" data-blog-view="posts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-[var(--gray-200)] bg-white p-1">
          <button className="rounded-lg bg-[var(--color-brand-50)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-700)]">Posts</button>
          <button onClick={onMedia} className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]">Media</button>
        </div>
        <Button icon={Plus} onClick={() => setCreateOpen(true)}>New post</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={FileCheck2} label="Published" value={result.counts?.published || 0} />
        <StatCard icon={CalendarClock} label="Scheduled" value={result.counts?.scheduled || 0} />
        <StatCard icon={FileText} label="Waiting for review" value={result.counts?.in_review || 0} />
      </div>
      <div className="rounded-xl border border-[var(--gray-200)] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[var(--gray-200)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--color-text-tertiary)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts" className="h-10 w-full rounded-lg border border-[var(--gray-300)] pl-9 pr-3 text-sm" /></div>
          <div className="flex flex-wrap gap-2">{FILTERS.map(([id, label]) => <button key={label} onClick={() => setFilter(id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === id ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"}`}>{label}</button>)}</div>
        </div>
        {error ? <div className="p-5"><AlertCard variant="error" title="Posts didn't load." action={<Button size="sm" variant="secondary" onClick={load}>Retry</Button>} /></div>
          : loading ? <div className="space-y-3 p-5">{[1,2,3].map((row) => <div key={row} className="h-12 animate-pulse rounded-lg bg-[var(--gray-100)]" />)}</div>
          : !result.posts?.length ? <div className="p-12 text-center"><Image className="mx-auto mb-3 h-8 w-8 text-[var(--color-text-tertiary)]" /><p className="font-semibold">No posts yet.</p><p className="text-sm text-[var(--color-text-secondary)]">Start one with New post.</p></div>
          : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[var(--gray-50)] text-xs uppercase text-[var(--color-text-tertiary)]"><tr><th className="px-5 py-3">Post</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Category</th><th className="px-5 py-3">Author</th><th className="px-5 py-3">Updated</th></tr></thead><tbody>{result.posts.map((post) => <tr key={post.id} className="border-t border-[var(--gray-100)] hover:bg-[var(--gray-50)]"><td className="px-5 py-4"><button className="font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-brand-600)]" onClick={() => onOpen(post.id)}>{post.title}</button></td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[post.derived_state]||STATUS_CLASS.draft}`}>{STATUS[post.derived_state] || post.derived_state}{post.derived_state==="scheduled"&&post.publish_at?` · ${new Date(post.publish_at).toLocaleString(undefined,{weekday:"short",hour:"numeric",minute:"2-digit"})}`:""}</span>{post.has_unpublished_changes ? <small className="mt-1 block text-[var(--color-brand-700)]">Unpublished changes</small> : null}</td><td className="px-5 py-4">{post.category?.label}</td><td className="px-5 py-4">{post.author?.display_name}</td><td className="px-5 py-4 text-[var(--color-text-secondary)]">{relativeTime(post.updated_at)}</td></tr>)}</tbody></table></div>}
        <p className="border-t border-[var(--gray-200)] px-5 py-3 text-xs text-[var(--color-text-tertiary)]">Who can do what: Support teammates write and send for review; Support leads publish.</p>
      </div>
      <Modal open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="New blog post">
        <ModalBody className="space-y-4"><Input label="Title" value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} /><label className="block text-sm font-medium">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--gray-300)] px-3">{BLOG_CATEGORIES.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}</select></label></ModalBody>
        <ModalFooter><Button variant="secondary" disabled={creating} onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={!title.trim()} loading={creating} onClick={create}>Create post</Button></ModalFooter>
      </Modal>
    </div>
  );
}
