// #4318 — Support › Links page: the custom strips shown on usemingla.com/links.
//
// Staff add, edit, reorder and remove strips. Strips sit in their own pinned
// group under the page's two banners, the same in every city; the page's
// filters never hide them. The list order is the order on the page, saved as
// an explicit position by admin_links_strips_reorder.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, GripVertical, MapPin, Pencil, Pin, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { AlertCard, SectionCard } from "../ui/Card";
import { LoadError } from "../ui/LoadError";
import { useToast } from "../../context/ToastContext";
import {
  LINKS_STRIP_LABELS, LINKS_STRIP_OPENS, LINKS_STRIP_TITLE_MAX, moveStrip, runOptimisticReorder,
  showsOnOptions, stripDayLabel, stripMetaLine, stripOpensSummary, stripRows, stripSaveArgs, validateStripDraft,
} from "../../lib/linksStrips";
import {
  deleteLinksStrip, linksStripsErrorField, linksStripsErrorMessage, listLinksStrips, listPublishedBlogPostsForLinks,
  reorderLinksStrips, saveLinksStrip,
} from "../../services/linksStripsService";

const FIELD = "h-10 w-full rounded-lg border bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition-all duration-150 focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]";
const FIELD_OK = "border-[var(--gray-300)]";
const FIELD_BAD = "border-[#ef4444]";
const LABEL = "mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]";

function emptyDraft(today) {
  return { id: null, showsOn: today, title: "", label: LINKS_STRIP_LABELS[0], opens: "web", url: "", blogPostId: "" };
}

function draftFromStrip(strip) {
  return {
    id: strip.id,
    showsOn: strip.shows_on,
    title: strip.title || "",
    label: strip.label,
    opens: strip.opens,
    url: strip.url || "",
    blogPostId: strip.blog_post_id || "",
  };
}

function StripPreview({ title, label, showsOn }) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-1.5 pr-2">
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-brand-500)] text-white">
        <MapPin className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{title || "Your title"}</b>
        <span className="block truncate font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">{stripMetaLine(label, showsOn)}</span>
      </span>
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-brand-500)] text-white">
        <ArrowRight className="h-4 w-4" />
      </span>
    </div>
  );
}

export function LinksPagePanel() {
  const { addToast } = useToast();
  const dayOptions = useMemo(() => showsOnOptions(), []);
  const today = dayOptions[0].value;

  const [strips, setStrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState(null);

  const [draft, setDraft] = useState(() => emptyDraft(today));
  const [titleTouched, setTitleTouched] = useState(false);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [reordering, setReordering] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const listRef = useRef(null);
  const pendingFocus = useRef(null);
  const fieldRefs = useRef({});

  // The fetchers set state only after their await, so the first load can run
  // from an effect; load / loadPosts show the busy state first (Retry, after a save).
  const fetchStrips = useCallback(async () => {
    try {
      const rows = stripRows(await listLinksStrips());
      setStrips(rows);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPosts = useCallback(async () => {
    try {
      const published = await listPublishedBlogPostsForLinks();
      setPosts(published);
      setPostsError(null);
    } catch (error) {
      setPostsError(error);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return fetchStrips();
  }, [fetchStrips]);

  const loadPosts = useCallback(() => {
    setPostsLoading(true);
    setPostsError(null);
    return fetchPosts();
  }, [fetchPosts]);

  // First load: the fetches start once the panel has mounted.
  useEffect(() => {
    const first = Promise.resolve();
    void first.then(fetchStrips);
    void first.then(fetchPosts);
  }, [fetchStrips, fetchPosts]);

  // After a keyboard move, keep focus on the strip's arrow that still works.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !listRef.current) return;
    pendingFocus.current = null;
    const buttons = [`[data-move-id="${target.id}"][data-move="${target.dir}"]`, `[data-move-id="${target.id}"]`]
      .map((selector) => listRef.current.querySelector(`${selector}:not([disabled])`));
    buttons.find(Boolean)?.focus();
  }, [strips]);

  const update = (patch) => {
    setFormError(null);
    setDraft((current) => {
      const next = { ...current, ...patch };
      // Picking a post fills the title from it, unless a title was typed.
      if (patch.blogPostId && next.opens === "blog" && !titleTouched) {
        const post = posts.find((item) => item.id === patch.blogPostId);
        if (post) next.title = String(post.title).slice(0, LINKS_STRIP_TITLE_MAX);
      }
      return next;
    });
  };

  const resetForm = () => {
    setDraft(emptyDraft(today));
    setTitleTouched(false);
    setFormError(null);
  };

  async function submit(event) {
    event.preventDefault();
    const problem = validateStripDraft(draft);
    if (problem) {
      setFormError(problem);
      fieldRefs.current[problem.field]?.focus();
      return;
    }
    setSaving(true);
    try {
      await saveLinksStrip(stripSaveArgs(draft));
      addToast({
        variant: "success",
        title: draft.id ? "Strip saved" : "Strip published",
        description: "Pinned under the banners on usemingla.com/links, in every city.",
      });
      resetForm();
      await load();
    } catch (error) {
      const field = linksStripsErrorField(error);
      setFormError({ field, message: linksStripsErrorMessage(error) });
      if (field) fieldRefs.current[field]?.focus();
      // A strip that changed or went away meanwhile: show the server's list.
      if (error?.code === "stale") await load();
    } finally {
      setSaving(false);
    }
  }

  async function move(id, to, dir) {
    if (reordering) return;
    const previous = strips;
    const next = moveStrip(previous, id, to);
    if (!next) return;
    if (dir) pendingFocus.current = { id, dir };
    setReordering(true);
    try {
      await runOptimisticReorder({ previous, next, apply: setStrips, commit: reorderLinksStrips });
    } catch (error) {
      addToast({ variant: "error", title: "The new order wasn't saved", description: linksStripsErrorMessage(error) });
      if (error?.code === "stale") await load();
    } finally {
      setReordering(false);
    }
  }

  async function remove(strip) {
    setRemovingId(strip.id);
    try {
      await deleteLinksStrip(strip.id);
      setConfirmingId(null);
      if (draft.id === strip.id) resetForm();
      addToast({ variant: "success", title: "Strip removed", description: `"${strip.title}" is off the Links page.` });
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "The strip wasn't removed", description: linksStripsErrorMessage(error) });
      if (error?.code === "stale") await load();
    } finally {
      setRemovingId(null);
    }
  }

  const startEdit = (strip) => {
    setDraft(draftFromStrip(strip));
    setTitleTouched(true);
    setFormError(null);
    fieldRefs.current.title?.focus();
  };

  if (loadError?.code === "not_ready") {
    return <AlertCard title="The Links page strips aren't switched on yet.">The database migration must be applied before staff can add strips.</AlertCard>;
  }

  const editing = Boolean(draft.id);
  const editingDayMissing = !dayOptions.some((option) => option.value === draft.showsOn);
  const fieldClass = (field) => `${FIELD} ${formError?.field === field ? FIELD_BAD : FIELD_OK}`;
  const errorFor = (field) => (formError?.field === field ? "links-strip-error" : undefined);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-links-view="strips">
      <SectionCard title={editing ? "Edit custom strip" : "Add a custom strip"} subtitle="usemingla.com/links">
        <form noValidate onSubmit={submit} className="space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Live listings fill each city on their own. Custom strips sit in their own pinned spot under the two banners,
            above the city switcher, and show first in every city. Filters never hide them. They push the listings down until 3
            are left; any more fold into &ldquo;See more from Mingla&rdquo;.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="links-strip-day" className={LABEL}>Shows on</label>
              <select
                id="links-strip-day"
                ref={(node) => { fieldRefs.current.showsOn = node; }}
                value={draft.showsOn}
                onChange={(e) => update({ showsOn: e.target.value })}
                aria-invalid={formError?.field === "showsOn" || undefined}
                aria-describedby={errorFor("showsOn")}
                className={fieldClass("showsOn")}
              >
                {editingDayMissing && draft.showsOn ? <option value={draft.showsOn}>{stripDayLabel(draft.showsOn)}</option> : null}
                {dayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="links-strip-title" className={LABEL}>Title</label>
              <input
                id="links-strip-title"
                ref={(node) => { fieldRefs.current.title = node; }}
                type="text"
                value={draft.title}
                maxLength={LINKS_STRIP_TITLE_MAX}
                onChange={(e) => { setTitleTouched(true); update({ title: e.target.value }); }}
                aria-invalid={formError?.field === "title" || undefined}
                aria-describedby={errorFor("title") || "links-strip-title-count"}
                className={fieldClass("title")}
              />
              <p id="links-strip-title-count" className="mt-1 text-xs text-[var(--color-text-tertiary)]">{draft.title.length}/{LINKS_STRIP_TITLE_MAX}</p>
            </div>
            <div>
              <label htmlFor="links-strip-label" className={LABEL}>Label</label>
              <select id="links-strip-label" ref={(node) => { fieldRefs.current.label = node; }} value={draft.label} onChange={(e) => update({ label: e.target.value })} className={fieldClass("label")}>
                {LINKS_STRIP_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className={LABEL}>Opens</legend>
              <div className="flex flex-wrap gap-2">
                {LINKS_STRIP_OPENS.map((option) => (
                  <label
                    key={option.id}
                    className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-medium ${draft.opens === option.id ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)] text-[var(--color-text-primary)]"}`}
                  >
                    <input
                      type="radio"
                      name="links-strip-opens"
                      value={option.id}
                      checked={draft.opens === option.id}
                      onChange={() => update({ opens: option.id })}
                      className="accent-[var(--color-brand-500)]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {draft.opens === "explorer" || draft.opens === "host" ? (
                <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">
                  Phones go to the right app store on their own; desktop shows a QR code. You never paste a store link.
                </p>
              ) : null}
            </fieldset>
            {draft.opens === "blog" ? (
              <div className="sm:col-span-2">
                <label htmlFor="links-strip-blog" className={LABEL}>Blog post</label>
                {postsError ? (
                  <LoadError title="Published posts didn't load" message={linksStripsErrorMessage(postsError)} onRetry={loadPosts} retrying={postsLoading} />
                ) : (
                  <select
                    id="links-strip-blog"
                    ref={(node) => { fieldRefs.current.blog = node; }}
                    value={draft.blogPostId}
                    onChange={(e) => update({ blogPostId: e.target.value })}
                    disabled={postsLoading}
                    aria-invalid={formError?.field === "blog" || undefined}
                    aria-describedby={errorFor("blog")}
                    className={fieldClass("blog")}
                  >
                    <option value="">{postsLoading ? "Loading published posts…" : posts.length ? "Choose a published post" : "No published posts yet"}</option>
                    {draft.blogPostId && !posts.some((post) => post.id === draft.blogPostId) && !postsLoading ? (
                      <option value={draft.blogPostId}>The post this strip opens (no longer published)</option>
                    ) : null}
                    {posts.map((post) => <option key={post.id} value={post.id}>{post.title}</option>)}
                  </select>
                )}
                {!postsLoading && !postsError && !posts.length ? (
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Publish a post in the Blog tab first. Drafts never show here.</p>
                ) : null}
              </div>
            ) : null}
            {draft.opens === "web" ? (
              <div className="sm:col-span-2">
                <label htmlFor="links-strip-url" className={LABEL}>Web link</label>
                <input
                  id="links-strip-url"
                  ref={(node) => { fieldRefs.current.url = node; }}
                  type="text"
                  inputMode="url"
                  placeholder="usemingla.com/host"
                  value={draft.url}
                  onChange={(e) => update({ url: e.target.value })}
                  aria-invalid={formError?.field === "url" || undefined}
                  aria-describedby={errorFor("url")}
                  className={fieldClass("url")}
                />
              </div>
            ) : null}
          </div>

          <p id="links-strip-error" role="alert" aria-live="polite" className="min-h-[1.25rem] text-sm font-semibold text-[var(--color-error-700)]">
            {formError?.message || ""}
          </p>

          <div aria-label="Preview" className="rounded-2xl bg-[var(--gray-50)] p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">Preview</p>
            <StripPreview title={draft.title.trim()} label={draft.label} showsOn={draft.showsOn} />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {editing ? <Button type="button" variant="secondary" disabled={saving} onClick={resetForm}>Cancel</Button> : null}
            <Button type="submit" icon={editing ? Pencil : Plus} loading={saving}>{editing ? "Save strip" : "Publish strip"}</Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Custom strips" subtitle={loading ? undefined : `${strips.length} on the page`}>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Drag a strip, or use the arrows, to set the order. The top of this list shows first on the page. Changes reach
          usemingla.com/links within 5 minutes.
        </p>
        {loadError ? (
          <LoadError title="Couldn't load the strips" message={linksStripsErrorMessage(loadError)} onRetry={load} retrying={loading} />
        ) : loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading strips">
            {[1, 2, 3].map((row) => <div key={row} className="h-14 animate-pulse rounded-xl bg-[var(--gray-100)]" />)}
          </div>
        ) : !strips.length ? (
          <div className="rounded-xl border border-dashed border-[var(--gray-300)] p-8 text-center">
            <Pin className="mx-auto mb-2 h-6 w-6 text-[var(--color-text-tertiary)]" />
            <p className="font-semibold">No custom strips</p>
            <p className="text-sm text-[var(--color-text-secondary)]">Publish one and it pins under the banners.</p>
          </div>
        ) : (
          <ul ref={listRef} className="space-y-2" aria-busy={reordering || undefined}>
            {strips.map((strip, index) => {
              const confirming = confirmingId === strip.id;
              return (
                <li
                  key={strip.id}
                  data-id={strip.id}
                  draggable={!reordering && !confirming}
                  onDragStart={(e) => {
                    setDragId(strip.id);
                    e.dataTransfer.setData("text/plain", strip.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onDragOver={(e) => { if (!dragId) return; e.preventDefault(); setOverId(strip.id === dragId ? null : strip.id); }}
                  onDrop={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    const from = dragId;
                    setDragId(null);
                    setOverId(null);
                    void move(from, index);
                  }}
                  className={[
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border bg-[var(--color-background-primary)] px-3 py-3",
                    overId === strip.id ? "border-[var(--color-brand-500)] shadow-[inset_0_2px_0_var(--color-brand-500)]" : "border-[var(--gray-200)]",
                    dragId === strip.id ? "opacity-50" : "",
                    draft.id === strip.id ? "ring-2 ring-[var(--color-brand-100)]" : "",
                  ].join(" ")}
                >
                  <span aria-hidden="true" className="cursor-grab text-[var(--color-text-tertiary)]"><GripVertical className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <b className="block truncate text-sm font-semibold">{strip.title}</b>
                    <small className="block truncate text-xs text-[var(--color-text-secondary)]">
                      {strip.label} · {stripDayLabel(strip.shows_on)} · {stripOpensSummary(strip)}
                    </small>
                  </div>
                  {confirming ? (
                    <span className="flex flex-wrap items-center justify-end gap-2" role="group" aria-label={`Remove ${strip.title}?`}>
                      <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Remove this strip?</span>
                      <Button size="sm" variant="secondary" disabled={removingId === strip.id} onClick={() => setConfirmingId(null)}>Keep</Button>
                      <Button size="sm" variant="danger" loading={removingId === strip.id} onClick={() => void remove(strip)}>Remove</Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Button size="sm" variant="secondary" icon={ArrowUp} data-move-id={strip.id} data-move="up" aria-label={`Move up: ${strip.title}`} disabled={index === 0 || reordering} onClick={() => void move(strip.id, index - 1, "up")} />
                      <Button size="sm" variant="secondary" icon={ArrowDown} data-move-id={strip.id} data-move="down" aria-label={`Move down: ${strip.title}`} disabled={index === strips.length - 1 || reordering} onClick={() => void move(strip.id, index + 1, "down")} />
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit: ${strip.title}`} onClick={() => startEdit(strip)} />
                      <Button size="sm" variant="secondary" onClick={() => setConfirmingId(strip.id)}>Remove</Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
