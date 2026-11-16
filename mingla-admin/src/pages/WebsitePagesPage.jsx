// #4452 §7.6 — Admin › Communications › Website pages: the page editor.
//
// Left: every public page from the site's own manifest (cache: no-store).
// Middle: the REAL page in an iframe of /site-preview/<token>?editor=1, where
// the site draws "Add here" markers and posts spot / hero / block clicks to
// this origin only (both sides check the origin). Right: the side panel to add
// or edit a Form, Button row or Banner, the pop-up's settings, and the hero's
// words within their limits.
//
// Drafts autosave 800 ms after an edit (PT409 = someone else saved: reload).
// Publish refreshes the site; a PT409 page_conflict opens "<Name> published
// <path> <n> min ago." with Keep both (rebase into free spots) or Replace.
// History lists every version; Restore makes a new live version.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, History, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { LoadError } from "../components/ui/LoadError";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { formatDateTime } from "../lib/formatters";
import { ReadOnlyHint } from "../components/forms/formsUi";
import { PageSidePanel } from "../components/website/PageSidePanel";
import {
  AUTOSAVE_MS, HOST_TEMPLATE_KEY, LIST_INTRO, MANIFEST_FAILED, NO_SPOTS_COPY, TEMPLATE_NOTE, TOKEN_REMINT_MS,
  conflictLine, contentChanges, editorFrameUrl, editorMessage, emptyContent, pageList, rebaseKeepBoth,
} from "../lib/sitePagesModel";
import {
  SITE_ORIGIN, fetchManifest, getPage, pageHistory, pagesErrorWords, pagesState, previewToken, publishPage, restorePage,
  revalidatePages, savePageDraft,
} from "../services/websitePagesService";
import { listForms } from "../services/formsService";

const SIZES = { desktop: 1440, phone: 390 };

/** Own draft blocks plus the host template's blocks in spots the page leaves free (the preview shows both). */
function mergedForPreview(own, template) {
  if (!template) return own;
  const used = new Set((own.blocks || []).map((b) => b.spot));
  const shared = (template.blocks || []).filter((b) => !used.has(b.spot) && b.type !== "popup").map((b) => ({ ...b, all_host_pages: true }));
  const ownPopup = (own.blocks || []).some((b) => b.spot === "popup");
  const tplPopup = !ownPopup ? (template.blocks || []).filter((b) => b.spot === "popup").map((b) => ({ ...b, all_host_pages: true })) : [];
  return { ...own, blocks: [...(own.blocks || []), ...shared, ...tplPopup] };
}

function usePageDoc(key, enabled) {
  const [doc, setDoc] = useState(null); // { content, rev, liveVersion, live, canEdit }
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    if (!enabled) { setDoc(null); return; }
    setError(null);
    try {
      const p = await getPage(key);
      setDoc({ content: p.draft_content || p.live_content || emptyContent(), rev: p.draft_rev ?? 0, liveVersion: p.live_version, live: p.live_content || emptyContent(), base: p.live_content || emptyContent(), canEdit: Boolean(p.can_edit), dirty: false });
    } catch (e) { setError(e); }
  }, [key, enabled]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return [doc, setDoc, error, load];
}

export function WebsitePagesPage() {
  const { addToast } = useToast();
  const [manifest, setManifest] = useState(null);
  const [state, setState] = useState(null);
  const [listError, setListError] = useState(null);
  const [selKey, setSelKey] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("page") || "creators");
  const [device, setDevice] = useState("desktop");
  const [markers, setMarkers] = useState(true);
  const [panel, setPanel] = useState(null); // {kind:"spot"|"block"|"hero", spot, block}
  const [token, setToken] = useState(null);
  const [frameY, setFrameY] = useState(0);
  const [frameKey, setFrameKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState("");
  const [leaving, setLeaving] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [forms, setForms] = useState([]);
  const timer = useRef(null);
  const boxRef = useRef(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const adminOrigin = typeof window === "undefined" ? "" : window.location.origin;

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const [m, s] = await Promise.all([fetchManifest(), pagesState()]);
      setManifest(m);
      setState(s);
    } catch (e) { setListError(e); }
  }, []);
  useEffect(() => { void Promise.resolve().then(loadList); }, [loadList]);
  useEffect(() => { listForms(null).then((r) => setForms(r.rows || []), () => setForms([])); }, []);

  const groups = useMemo(() => (manifest ? pageList(manifest, state) : []), [manifest, state]);
  const page = useMemo(() => groups.flatMap((g) => g.items).find((p) => p.key === selKey) || null, [groups, selKey]);
  const isTemplatePage = page?.template === "host";
  const [doc, setDoc, docError, reloadDoc] = usePageDoc(selKey, Boolean(page));
  const [tpl, setTpl, , reloadTpl] = usePageDoc(HOST_TEMPLATE_KEY, Boolean(page && isTemplatePage));
  const canEdit = Boolean(doc?.canEdit);
  const dirty = Boolean(doc?.dirty || tpl?.dirty);

  // Mint the preview token for the draft (on open, after each save, and every 50 minutes).
  const mint = useCallback(async () => {
    if (!doc || !canEdit) return;
    try {
      const t = await previewToken(selKey, mergedForPreview(doc.content, tpl?.content));
      setToken(t.token);
      setFrameKey((k) => k + 1);
    } catch (e) { addToast({ variant: "error", title: pagesErrorWords(e) }); }
  }, [addToast, canEdit, doc, selKey, tpl]);
  const mintRef = useRef(mint);
  useEffect(() => { mintRef.current = mint; }, [mint]);
  useEffect(() => {
    if (!doc) return undefined;
    void mintRef.current();
    const t = setInterval(() => mintRef.current(), TOKEN_REMINT_MS);
    return () => clearInterval(t);
  }, [selKey, Boolean(doc)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Messages from the page in the iframe: only from the site, only well formed.
  useEffect(() => {
    const on = (e) => {
      const msg = editorMessage(e, new URL(SITE_ORIGIN).origin);
      if (!msg || msg.page !== selKey) return;
      if (msg.type === "editor-scroll") setFrameY(msg.y);
      if (msg.type === "spot-click") setPanel({ kind: "spot", spot: msg.spot });
      if (msg.type === "block-click") setPanel({ kind: "block", spot: msg.spot, block: msg.block });
      if (msg.type === "hero-click") setPanel({ kind: "hero" });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [selKey]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  // Autosave each changed document 800 ms after the last edit.
  const saveDoc = useCallback(async (key, d, set) => {
    if (!d?.dirty) return;
    try {
      const res = await savePageDraft(key, d.rev, d.content);
      set((cur) => ({ ...cur, rev: res.rev, dirty: cur.content !== d.content ? cur.dirty : false }));
      return true;
    } catch (e) {
      if (e.code === "PT409") addToast({ variant: "error", title: "Someone else changed this page's draft. Reloading theirs." });
      else addToast({ variant: "error", title: pagesErrorWords(e) });
      if (e.code === "PT409") { if (key === HOST_TEMPLATE_KEY) await reloadTpl(); else await reloadDoc(); }
      return false;
    }
  }, [addToast, reloadDoc, reloadTpl]);
  useEffect(() => {
    if (!dirty) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const a = await saveDoc(selKey, doc, setDoc);
      const b = isTemplatePage ? await saveDoc(HOST_TEMPLATE_KEY, tpl, setTpl) : true;
      if (a !== false && b !== false) void mint();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [doc, tpl, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const editDoc = (key, content) => {
    if (!canEdit) return;
    if (key === HOST_TEMPLATE_KEY) setTpl((cur) => ({ ...cur, content, dirty: true }));
    else setDoc((cur) => ({ ...cur, content, dirty: true }));
  };

  const changes = doc ? contentChanges(doc.live, doc.content).length + (tpl ? contentChanges(tpl.live, tpl.content).length : 0) : 0;
  const liveInfo = state?.find((s) => s.page_key === selKey)?.live;

  const publish = async ({ replaceOver = null } = {}) => {
    setBusy("publish");
    try {
      await saveDoc(selKey, doc, setDoc);
      if (isTemplatePage) await saveDoc(HOST_TEMPLATE_KEY, tpl, setTpl);
      if (contentChanges(doc.live, doc.content).length) await publishPage(selKey, replaceOver ?? doc.liveVersion);
      if (tpl && contentChanges(tpl.live, tpl.content).length) await publishPage(HOST_TEMPLATE_KEY, tpl.liveVersion);
      try {
        await revalidatePages();
        setRefreshFailed(false);
        addToast({ variant: "success", title: `Published. ${page.path} refreshes in under a minute.` });
      } catch {
        setRefreshFailed(true);
        addToast({ variant: "warning", title: "Saved. The page did not refresh; Retry" });
      }
      setConflict(null);
      await Promise.all([reloadDoc(), isTemplatePage ? reloadTpl() : null, loadList()]);
    } catch (e) {
      if (e.code === "PT409" && /page_conflict/.test(e.message || "")) {
        const c = conflictLine(e.detail, page.path);
        const theirs = await getPage(selKey).catch(() => null);
        setConflict({ ...c, theirs: theirs?.live_content || emptyContent(), lines: contentChanges(doc.base, theirs?.live_content || emptyContent()) });
      } else {
        addToast({ variant: "error", title: pagesErrorWords(e) });
      }
    } finally { setBusy(""); }
  };

  const keepBoth = () => {
    const { content, bumped } = rebaseKeepBoth(doc.content, conflict.theirs, doc.base);
    setDoc((cur) => ({ ...cur, content, base: conflict.theirs, liveVersion: conflict.liveVersion, live: conflict.theirs, dirty: true }));
    setConflict(null);
    if (bumped.length) addToast({ variant: "warning", title: `${bumped.length === 1 ? "That spot now has their block" : `${bumped.length} spots now have their blocks`}. Your ${bumped.length === 1 ? "block for it is" : "blocks for them are"} not published.` });
    else addToast({ variant: "success", title: "Their changes are in. Review, then publish." });
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistory(null);
    try { setHistory(await pageHistory(selKey)); } catch (e) { setHistory({ error: e }); }
  };
  const restore = async (v) => {
    setBusy(`restore-${v}`);
    try {
      await restorePage(selKey, v, doc.liveVersion);
      await revalidatePages().catch(() => {});
      addToast({ variant: "success", title: `Restored version ${v} as a new live version.` });
      setHistoryOpen(false);
      await Promise.all([reloadDoc(), loadList()]);
    } catch (e) { addToast({ variant: "error", title: pagesErrorWords(e) }); }
    finally { setBusy(""); }
  };
  const previewOnSite = async () => {
    try {
      const t = await previewToken(selKey, mergedForPreview(doc.content, tpl?.content));
      window.open(`${SITE_ORIGIN}/site-preview/${encodeURIComponent(t.token)}`, "_blank", "noopener,noreferrer");
    } catch (e) { addToast({ variant: "error", title: pagesErrorWords(e) }); }
  };
  const choose = (key) => (dirty ? setLeaving(() => () => { setSelKey(key); setPanel(null); }) : (setSelKey(key), setPanel(null)));

  const frameW = SIZES[device];
  const scale = boxWidth ? Math.min(1, boxWidth / frameW) : 0.5;
  // View-only members (no preview token) see the live page itself.
  const src = !canEdit ? (page && !page.pattern ? `${SITE_ORIGIN}${page.path}` : null)
    : !token ? null : markers ? editorFrameUrl(SITE_ORIGIN, token, adminOrigin, frameY) : `${SITE_ORIGIN}/site-preview/${encodeURIComponent(token)}`;

  return (
    <div className="flex flex-col gap-6" data-website-pages="">
      <PageHeader title="Website pages" description={LIST_INTRO} />
      {doc && !canEdit && <ReadOnlyHint />}
      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_minmax(300px,360px)]">
        <nav aria-label="Pages" className="rounded-2xl border border-[var(--a-line)] bg-[var(--color-background-primary)] p-2 shadow-[var(--a-shadow)]" data-page-list="">
          {listError ? (
            <div className="p-3 text-sm"><p>{MANIFEST_FAILED}</p><Button size="sm" variant="secondary" icon={RefreshCw} onClick={loadList}>Retry</Button></div>
          ) : !manifest ? <Skeleton height={400} /> : groups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--a-dim)]">{g.label}</p>
              <ul>
                {g.items.map((p) => (
                  <li key={p.key}>
                    <button type="button" onClick={() => choose(p.key)} aria-current={p.key === selKey ? "page" : undefined} data-page-item={p.key}
                      className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm ${p.key === selKey ? "bg-[var(--a-active)] text-[var(--a-panel)]" : "text-[var(--color-text-primary)] hover:bg-[var(--a-soft)]"}`}>
                      <span className="min-w-0 flex-1 truncate">{p.path}</span>
                      {p.changes > 0 && <span aria-label="Unpublished changes" className="h-2 w-2 shrink-0 rounded-full bg-[#eb7825]" />}
                      {p.isNew && <span className="rounded-full bg-[var(--a-chip)] px-1.5 text-[10px] font-semibold text-[var(--a-chip-ink)]">New</span>}
                      {p.popupOnly && <span className="text-[10px] opacity-75">pop-up only</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section className="min-w-0" aria-label="Page preview">
          {!page ? <Skeleton height={500} rounded="16px" /> : docError ? <LoadError message={pagesErrorWords(docError)} onRetry={reloadDoc} /> : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{page.title} <span className="font-normal text-[var(--color-text-tertiary)]">{page.path}</span></h2>
                  <p className="text-xs text-[var(--color-text-tertiary)]" data-page-status="">
                    {liveInfo ? `Published ${formatDateTime(liveInfo.published_at)} by ${liveInfo.published_by_name || "the team"}` : "Not changed from the designed page yet"} · {changes} unpublished {changes === 1 ? "change" : "changes"}
                  </p>
                  {isTemplatePage && <p className="text-xs text-[var(--color-text-tertiary)]">{TEMPLATE_NOTE}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setMarkers((m) => !m)}>{markers ? "Clean view" : "Edit"}</Button>
                  <Button variant="secondary" size="sm" icon={History} onClick={openHistory}>History</Button>
                  <Button variant="secondary" size="sm" icon={ExternalLink} onClick={previewOnSite} disabled={!canEdit}>Preview on site</Button>
                  {refreshFailed && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => revalidatePages().then(() => { setRefreshFailed(false); addToast({ variant: "success", title: `${page.path} refreshes in under a minute.` }); }, () => addToast({ variant: "error", title: "The page still did not refresh. Try again in a minute." }))}>Retry the refresh</Button>}
                  <Button size="sm" onClick={() => publish()} loading={busy === "publish"} disabled={!canEdit || changes === 0} data-page-publish="">Publish</Button>
                </div>
              </div>
              {!page.spots.length && !page.hero && (
                <p className="rounded-xl bg-[var(--a-soft)] px-3 py-2 text-sm text-[var(--a-text2)]"><b>Found automatically.</b> {NO_SPOTS_COPY}</p>
              )}
              <div className="flex items-center gap-1" role="group" aria-label="Preview size">
                <Button size="sm" variant={device === "desktop" ? "primary" : "secondary"} icon={Monitor} onClick={() => setDevice("desktop")}>Desktop</Button>
                <Button size="sm" variant={device === "phone" ? "primary" : "secondary"} icon={Smartphone} onClick={() => setDevice("phone")}>Phone</Button>
              </div>
              <div ref={boxRef} className="overflow-hidden rounded-2xl border border-[var(--a-line)] bg-[var(--a-soft)]" style={{ height: Math.round(900 * (device === "desktop" ? scale : 1)) }} data-page-frame={device}>
                {src ? (
                  <div style={{ width: frameW, height: 900, transform: `scale(${device === "desktop" ? scale : 1})`, transformOrigin: "top left", margin: device === "phone" ? "0 auto" : 0 }}>
                    <iframe key={frameKey} title={`${page.path} as it will look`} src={src} width={frameW} height={900} className="block border-0 bg-white" referrerPolicy="strict-origin" />
                  </div>
                ) : <Skeleton height={600} />}
              </div>
            </div>
          )}
        </section>

        <aside aria-label="Edit">
          {page && doc ? (
            <PageSidePanel
              page={page} panel={panel} setPanel={setPanel} canEdit={canEdit}
              doc={doc} tpl={tpl} onEdit={editDoc} forms={forms}
            />
          ) : <Skeleton height={300} rounded="16px" />}
        </aside>
      </div>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={`History · ${page?.path || ""}`} size="md">
        <ModalBody>
          {!history ? <Skeleton height={120} /> : history.error ? <LoadError message={pagesErrorWords(history.error)} onRetry={openHistory} /> : !history.length ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">Nothing published yet: the page shows as designed.</p>
          ) : (
            <ul className="divide-y divide-[var(--a-line)]" data-page-history="">
              {history.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <b className="font-semibold">Version {v.version}</b> {v.is_live && <Badge variant="live">Live</Badge>}
                    <span className="block text-xs text-[var(--color-text-tertiary)]">{formatDateTime(v.published_at)} · {v.published_by_name || "the team"}{v.restored_from ? ` · restored from v${v.restored_from}` : ""}{v.note ? ` · ${v.note}` : ""}</span>
                    <span className="block text-xs text-[var(--color-text-tertiary)]">{v.blocks.length} {v.blocks.length === 1 ? "block" : "blocks"}{v.hero ? " · hero words" : ""}</span>
                  </span>
                  {!v.is_live && <Button size="sm" variant="secondary" loading={busy === `restore-${v.version}`} disabled={!canEdit} onClick={() => restore(v.version)}>Restore</Button>}
                </li>
              ))}
            </ul>
          )}
        </ModalBody>
      </Modal>

      <Modal open={Boolean(conflict)} onClose={() => setConflict(null)} title="Someone published first" size="md">
        <ModalBody>
          <div data-page-conflict="" className="space-y-2 text-sm">
            <p className="font-semibold">{conflict?.line}</p>
            {conflict?.lines?.length ? <ul className="list-disc pl-5 text-[var(--color-text-secondary)]">{conflict.lines.map((l) => <li key={l}>{l}</li>)}</ul> : null}
            <p className="text-xs text-[var(--color-text-tertiary)]">Keep both puts your blocks in spots that are still free. Replace publishes your draft over theirs; their version stays in History.</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={keepBoth}>Keep both</Button>
          <Button variant="danger" onClick={() => publish({ replaceOver: conflict.liveVersion })} loading={busy === "publish"}>Replace</Button>
        </ModalFooter>
      </Modal>

      {leaving && (
        <div role="alertdialog" aria-label="Unsaved changes" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(560px,calc(100vw-32px))] flex-wrap items-center gap-3 rounded-2xl border border-[var(--a-line)] bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-lg)]">
          <span className="flex-1 text-sm">Your last edit is still saving.</span>
          <Button size="sm" variant="secondary" onClick={() => setLeaving(null)}>Keep editing</Button>
          <Button size="sm" variant="danger" onClick={() => { const go = leaving; setLeaving(null); go(); }}>Discard</Button>
        </div>
      )}
    </div>
  );
}
