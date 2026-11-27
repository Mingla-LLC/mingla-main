// #4636 — Admin › Communications › Website pages: the CMS page editor
// (approved design, issue #4636). Replaces the #4452 screen at the same address.
//
// Left: Pages (staff-made pages, every page of the site from its manifest, and
// the menu and footer) or Sections (outline, drag / arrows to reorder, add).
// Middle: the REAL page at true size in /site-preview/<token>?editor=1, driven
// by the editor protocol (mingla-marketing/lib/site-pages/editor-protocol.ts):
// a click selects a section and its words; each edit is posted as editor-draft
// and redrawn without a reload. Right: the selected section's fields from the
// site's block registry, or the page / site settings.
//
// Drafts autosave 800 ms after an edit once the edit passes the same checks
// the database runs; PT409 page_draft_conflict stops saving and asks for a
// reload (the local draft is kept until then); 22023 invalid_content shows on
// the right section and field; an offline save says so with Retry. Publish
// lists the changes, then refreshes the site (admin-blog revalidate_page).
// View-only staff (forms_can_view without forms_can_edit) get the live preview
// and no edit tools; 42501 shows a plain no-access state.
//
// Pages that are not block pages keep their #4452 form / button / banner spots
// (PageSidePanel). Legal pages are locked.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, ImageIcon, Link2, Monitor, Plus, Redo2, RefreshCw, Search, Smartphone, Tablet, Undo2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { useToast } from "../context/ToastContext";
import { supabase, SUPABASE_URL } from "../lib/supabase";
import { siteCms } from "../services/siteCmsService";
import { SITE_ORIGIN, fetchManifest } from "../services/websitePagesService";
import { listForms } from "../services/formsService";
import { BUNDLED_MANIFEST, PAGE_DEFAULTS, REGISTRY, RESERVED_SEGMENTS } from "../lib/siteBlocksRegistry";
import {
  AUTOSAVE_MS, COPY, DEVICE_LABELS, FORMATS, SITE_SETTINGS_KEY, TOKEN_REMINT_MS, acceptPageMessage, blockDef, canAdd, checkSections,
  defaultSections, duplicateSection, frameUrl, insertSection, moveSection, pageRows, removeSection, sectionChanges, serverErrors,
  settingsChanges, settingsProblems, stableIds, starterBlock, toggleHidden, withIds,
} from "../lib/siteEditorModel";
import { contentChanges, emptyContent } from "../lib/sitePagesModel";
import { EditorCanvas } from "../components/website/EditorCanvas";
import { BlockPanel } from "../components/website/BlockPanel";
import { SectionList } from "../components/website/SectionList";
import { MediaLibrary } from "../components/website/MediaLibrary";
import { PageMetaPanel, SiteSettingsPanel } from "../components/website/SettingsPanels";
import { PageSidePanel } from "../components/website/PageSidePanel";
import { BlockPicker, DeletePageModal, HistoryModal, NewPageModal, PublishModal, ShareLinkModal } from "../components/website/PageModals";
import { FIELD, Note, StatusChip } from "../components/website/editorUi";

const DEVICE_ICONS = { desktop: Monitor, tablet: Tablet, phone: Smartphone };
const READY_TIMEOUT_MS = 20000;
const UNSAVED = new Set(["dirty", "saving", "error", "invalid", "conflict"]);

function initialKey() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "").get("page") || "home";
}

/** The content the editor works on, and the published baseline it compares with. */
function buildDoc(row, p) {
  const live = p.live_content || {};
  if (row.kind === "settings") {
    const pick = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k]) => k === "nav" || k === "footer"));
    return { content: pick(p.draft_content ?? live), live: pick(live) };
  }
  if (row.kind === "blocks") {
    const baseline = Array.isArray(live.sections) ? stableIds(live.sections) : row.custom ? [] : stableIds(defaultSections(PAGE_DEFAULTS, row.key));
    const draft = p.draft_content ?? { ...live, sections: baseline };
    return { content: { ...draft, sections: withIds(Array.isArray(draft.sections) ? draft.sections : baseline) }, live: { ...live, sections: baseline } };
  }
  return { content: p.draft_content ?? (live.blocks ? live : emptyContent()), live: live.blocks ? live : emptyContent() };
}

export function WebsitePagesPage() {
  const { addToast } = useToast();
  const cms = useMemo(() => siteCms(supabase), []);
  const adminOrigin = window.location.origin;
  const siteOrigin = useMemo(() => new URL(SITE_ORIGIN).origin, []);

  // ---- page list
  const [manifest, setManifest] = useState(null);
  const [state, setState] = useState(null);
  const [listError, setListError] = useState(null);
  const [noAccess, setNoAccess] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("pages");
  const [selKey, setSelKey] = useState(initialKey);
  const loadList = useCallback(async () => {
    setListError(null);
    try {
      // The live manifest lists pages the site shipped after this Admin build; the bundled list
      // (the same file, as of this build) keeps the editor working when it can't be fetched.
      const [m, s] = await Promise.all([fetchManifest(SITE_ORIGIN).catch(() => BUNDLED_MANIFEST), cms.pagesState()]);
      setManifest(m);
      setState(s || []);
    } catch (e) {
      if (e?.code === "42501" || e?.code === "not_authorized") setNoAccess(true);
      else setListError(e);
    }
  }, [cms]);
  useEffect(() => { void Promise.resolve().then(loadList); }, [loadList]);
  const allRows = useMemo(() => pageRows(manifest, state).flatMap((g) => g.items), [manifest, state]);
  const groups = useMemo(() => pageRows(manifest, state, query), [manifest, state, query]);
  const row = allRows.find((r) => r.key === selKey) || null;
  const manifestPage = manifest?.pages?.find((p) => p.key === selKey) || null;

  // ---- the open page
  const [doc, setDoc] = useState(null); // { key, kind, content, live, rev, liveVersion, canEdit, media, custom }
  const [docError, setDocError] = useState(null);
  const [save, setSave] = useState({ state: "saved" });
  const [remintTick, setRemintTick] = useState(0);
  const [srvErrs, setSrvErrs] = useState({ byIndex: {}, page: [] });
  const [sel, setSel] = useState(null);
  const [focusField, setFocusField] = useState(null);
  const [spotPanel, setSpotPanel] = useState(null);
  const [forms, setForms] = useState([]);
  const [hist, setHist] = useState({ undo: [], redo: [] });
  const lastPush = useRef(0);
  const contentRef = useRef(null);

  const loadDoc = async (r) => {
    if (!r) return;
    setDoc(null); setDocError(null); setSave({ state: "saved" }); setSrvErrs({ byIndex: {}, page: [] }); setSel(null); setFocusField(null); setSpotPanel(null);
    setHist({ undo: [], redo: [] });
    try {
      const p = await cms.getPage(r.key);
      const built = buildDoc(r, p);
      contentRef.current = built.content;
      setDoc({ key: r.key, kind: r.kind, ...built, rev: p.draft_rev ?? 0, liveVersion: p.live_version ?? 0, canEdit: Boolean(p.can_edit), media: p.media || {}, custom: p.custom || r.custom || null });
    } catch (e) {
      if (e?.code === "42501" || e?.code === "not_authorized") setNoAccess(true);
      else setDocError(e);
    }
  };
  const rowKey = row?.key;
  useEffect(() => { if (rowKey) void Promise.resolve().then(() => loadDoc(allRows.find((r) => r.key === rowKey))); }, [rowKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listForms(null).then((r) => setForms((r.rows || []).filter((f) => f.status !== "archived")), (e) => addToast({ variant: "warning", title: "Couldn't load the forms list", description: e?.message })); }, [addToast]);

  const canEdit = Boolean(doc?.canEdit) && doc?.kind !== "locked" && doc?.kind !== "pattern";
  const sections = useMemo(() => (doc?.kind === "blocks" ? doc.content.sections : []), [doc]);
  const checks = useMemo(() => (doc?.kind === "blocks" ? checkSections(REGISTRY, sections) : null), [doc, sections]);
  const settingsErrs = useMemo(() => (doc?.kind === "settings" ? settingsProblems(doc.content) : {}), [doc]);
  const errorsFor = (i) => ({ ...(checks?.blocks[i]?.fields || {}), ...(srvErrs.byIndex[i] || {}) });
  const invalidIdx = useMemo(() => new Set([...(checks?.blocks || []).map((b, i) => (b.ok ? -1 : i)), ...Object.keys(srvErrs.byIndex).map(Number)].filter((i) => i >= 0)), [checks, srvErrs]);
  const clientOk = doc?.kind === "blocks" ? checks?.ok : doc?.kind === "settings" ? Object.keys(settingsErrs).length === 0 : true;

  // ---- edits, undo / redo
  const edit = (next) => {
    if (!canEdit) return;
    const now = Date.now();
    const prev = contentRef.current;
    if (now - lastPush.current > 700) setHist((h) => ({ undo: [...h.undo, prev].slice(-60), redo: [] }));
    lastPush.current = now;
    contentRef.current = next;
    setDoc((d) => ({ ...d, content: next }));
    setSave((s) => (s.state === "conflict" ? s : { state: "dirty" }));
  };
  const editSections = (fn) => edit({ ...contentRef.current, sections: fn(contentRef.current.sections) });
  const step = (dir) => {
    const from = dir === "undo" ? hist.undo : hist.redo;
    if (!from.length) return;
    const next = from[from.length - 1];
    const cur = contentRef.current;
    setHist((h) => (dir === "undo" ? { undo: h.undo.slice(0, -1), redo: [...h.redo, cur] } : { undo: [...h.undo, cur], redo: h.redo.slice(0, -1) }));
    contentRef.current = next;
    lastPush.current = 0;
    setDoc((d) => ({ ...d, content: next }));
    setSave((s) => (s.state === "conflict" ? s : { state: "dirty" }));
    setSel(null);
  };

  // ---- saving
  const savingRef = useRef(false);
  const doSave = async () => {
    if (!doc || !canEdit || savingRef.current) return false;
    const content = contentRef.current;
    const ok = doc.kind === "blocks" ? checkSections(REGISTRY, content.sections).ok : doc.kind === "settings" ? Object.keys(settingsProblems(content)).length === 0 : true;
    if (!ok) { setSave({ state: "invalid", message: COPY.fixToSave }); return false; }
    savingRef.current = true;
    setSave({ state: "saving" });
    try {
      const r = await cms.saveDraft(doc.key, doc.rev, content);
      setDoc((d) => (d && d.key === doc.key ? { ...d, rev: r.rev } : d));
      setSrvErrs({ byIndex: {}, page: [] });
      setSave(contentRef.current === content ? { state: "saved", at: Date.now() } : { state: "dirty" });
      if (doc.rev === 0) void loadList(); // the first draft changes the page's status in the list
      else setState((list) => (list || []).map((x) => (x.page_key === doc.key ? { ...x, draft: { ...(x.draft || {}), rev: r.rev, changes: Math.max(1, x.draft?.changes ?? 0) } } : x)));
      return true;
    } catch (e) {
      if (e.code === "page_draft_conflict" || e.code === "PT409") setSave({ state: "conflict", message: COPY.conflict });
      else if (e.code === "invalid_content") { setSrvErrs(serverErrors(e.detail)); setSave({ state: "invalid", message: e.message }); }
      else if (e.code === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false)) setSave({ state: "error", message: COPY.offline });
      else setSave({ state: "error", message: `Couldn't save: ${e.message}` });
      return false;
    } finally { savingRef.current = false; }
  };
  const saveRef = useRef(doSave);
  useEffect(() => { saveRef.current = doSave; });
  useEffect(() => {
    if (save.state !== "dirty") return undefined;
    const t = setTimeout(() => { void saveRef.current().then((ok) => { if (ok && doc?.kind === "spots") setRemintTick((n) => n + 1); }); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [doc?.content, save.state, doc?.kind]);
  // Leaving the screen: a pending edit is saved now; a refresh or close asks first.
  const unsaved = UNSAVED.has(save.state);
  const unsavedRef = useRef(false);
  useEffect(() => { unsavedRef.current = unsaved; }, [unsaved]);
  useEffect(() => {
    const onUnload = (e) => { if (unsavedRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (unsavedRef.current) void saveRef.current().then((ok) => { if (!ok) addToast({ variant: "error", title: "Your last website edit wasn't saved", description: "Open Website pages again to retry." }); });
    };
  }, [addToast]);

  // ---- preview frame
  const frameRef = useRef(null);
  const [token, setToken] = useState(null);
  const [frameKey, setFrameKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [device, setDevice] = useState("desktop");
  const [zoom, setZoom] = useState("fit");
  const scrollY = useRef(0);
  const [frameY, setFrameY] = useState(0);
  const retried = useRef(false);
  const seq = useRef(0);
  const mint = async () => {
    if (!doc) return;
    setFrameY(doc.kind === "spots" ? scrollY.current : 0);
    try {
      const content = doc.kind === "blocks" && !checkSections(REGISTRY, contentRef.current.sections).ok ? doc.live : contentRef.current;
      const t = await cms.previewToken(doc.key, content);
      setToken(t.token); setReady(false); setFrameFailed(false); setFrameKey((k) => k + 1);
    } catch (e) {
      setFrameFailed(true);
      addToast({ variant: "error", title: COPY.previewFailed, description: e.message });
    }
  };
  const remintRef = useRef(mint);
  useEffect(() => { remintRef.current = mint; });
  useEffect(() => { if (remintTick) void remintRef.current(); }, [remintTick]);
  const docKey = doc?.key;
  useEffect(() => {
    if (!docKey) return undefined;
    retried.current = false;
    scrollY.current = 0;
    void remintRef.current();
    const t = setInterval(() => remintRef.current(), TOKEN_REMINT_MS);
    return () => clearInterval(t);
  }, [docKey]);
  // No answer from the page in time: re-mint once, then show "Preview couldn't load · Retry".
  useEffect(() => {
    if (!token || ready) return undefined;
    const t = setTimeout(() => {
      if (!retried.current) { retried.current = true; void remintRef.current(); } else setFrameFailed(true);
    }, READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [token, ready, frameKey]);
  const post = useCallback((msg) => { frameRef.current?.contentWindow?.postMessage(msg, siteOrigin); }, [siteOrigin]);
  // Each edit redraws the page in place (block pages and the menu / footer).
  useEffect(() => {
    // A draft that fails the checks stays out of the preview (the fields say what to fix).
    if (!ready || !doc || (doc.kind !== "blocks" && doc.kind !== "settings") || !clientOk) return undefined;
    const t = setTimeout(() => post({ type: "editor-draft", page: doc.key, seq: ++seq.current, content: contentRef.current }), 200);
    return () => clearTimeout(t);
  }, [doc?.content, ready, doc?.kind, doc?.key, post, clientOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && doc?.kind === "blocks") post({ type: "editor-select", page: doc.key, index: sel }); }, [sel, ready, doc?.kind, doc?.key, post]);
  const [previewNote, setPreviewNote] = useState(null);
  useEffect(() => {
    const on = (e) => {
      const msg = acceptPageMessage(e, siteOrigin);
      if (!msg || !doc || msg.page !== doc.key) return;
      if (msg.type === "editor-ready") { setReady(true); setFrameFailed(false); retried.current = false; }
      if (msg.type === "editor-click" && doc.kind === "blocks") { setSel(msg.index); setFocusField(msg.field || null); setTab("sections"); }
      if (msg.type === "editor-applied") setPreviewNote(msg.ok ? null : msg.errors[0] || "The preview couldn't show the last change.");
      if (msg.type === "editor-scroll") scrollY.current = msg.y;
      if (msg.type === "spot-click") setSpotPanel({ kind: "spot", spot: msg.spot });
      if (msg.type === "block-click") setSpotPanel({ kind: "block", spot: msg.spot, block: msg.block });
      if (msg.type === "hero-click") setSpotPanel({ kind: "hero" });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [doc, siteOrigin]);
  const src = token ? frameUrl(SITE_ORIGIN, token, adminOrigin, null, frameY) : null;

  // ---- section actions
  const nameOf = (s) => blockDef(REGISTRY, s?.type)?.name || s?.type;
  const select = (i, scroll = true) => { setSel(i); setFocusField(null); if (scroll && ready) post({ type: "editor-scroll-to", page: doc.key, index: i }); };
  const act = (a, i) => {
    const list = contentRef.current.sections;
    if (!list[i]) return;
    if (a === "up" && i > 0) { editSections((l) => moveSection(l, i, i - 1)); setSel(i - 1); }
    if (a === "down" && i < list.length - 1) { editSections((l) => moveSection(l, i, i + 1)); setSel(i + 1); }
    if (a === "dup") {
      if (!canAdd(REGISTRY, list, list[i].type)) { addToast({ variant: "warning", title: list.length >= 40 ? "A page has at most 40 sections." : `Only ${blockDef(REGISTRY, list[i].type)?.maxPerPage} "${nameOf(list[i])}" per page.` }); return; }
      editSections((l) => duplicateSection(l, i)); setSel(i + 1);
    }
    if (a === "hide") editSections((l) => toggleHidden(l, i));
    if (a === "del") { editSections((l) => removeSection(l, i)); setSel(null); addToast({ variant: "success", title: `Deleted "${nameOf(list[i])}". Undo brings it back.` }); }
  };
  const [pickerAt, setPickerAt] = useState(null);
  const addBlock = (type) => {
    const at = pickerAt ?? contentRef.current.sections.length;
    editSections((l) => insertSection(l, at, starterBlock(REGISTRY, PAGE_DEFAULTS, type, { formId: forms[0]?.id })));
    setPickerAt(null); setSel(at); setTab("sections");
    setTimeout(() => { if (ready) post({ type: "editor-scroll-to", page: doc.key, index: at }); }, 600);
    addToast({ variant: "success", title: "Section added. Click its words on the page or edit them on the right." });
  };

  // ---- media library
  const [mediaReq, setMediaReq] = useState(null); // { mode, accept, onPick }
  const openMedia = (accept, onPick) => setMediaReq({ mode: "pick", accept, onPick });
  const findUsage = useCallback(async (id) => {
    const ref = `m:${id}`;
    const out = [];
    for (const s of state || []) {
      if (!s.live && s.custom?.share_media_id !== id) continue;
      if (s.custom?.share_media_id === id) out.push(`${s.custom.path} (share picture)`);
      if (!s.live) continue;
      const p = await cms.getPage(s.page_key);
      if (JSON.stringify(p.live_content || {}).includes(ref)) out.push(allRows.find((r) => r.key === s.page_key)?.path || s.page_key);
    }
    return [...new Set(out)];
  }, [cms, state, allRows]);

  // ---- publish, history, share, page settings
  const [publishOpen, setPublishOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const changes = useMemo(() => {
    if (!doc) return [];
    if (doc.kind === "blocks") return sectionChanges(REGISTRY, doc.live.sections, doc.content.sections);
    if (doc.kind === "settings") return settingsChanges(doc.live, doc.content);
    return contentChanges(doc.live, doc.content);
  }, [doc]);
  const listState = state?.find((s) => s.page_key === doc?.key);
  // Something to publish: a saved draft on the server, or edits about to be saved.
  const hasDraft = Boolean(listState?.draft) || (doc?.rev ?? 0) > 0 || save.state !== "saved";
  const refresh = async (key) => {
    try { await cms.revalidate(key); setRefreshFailed(false); return true; }
    catch { setRefreshFailed(true); addToast({ variant: "warning", title: "Published, but the site didn't refresh yet.", description: "Use “Retry the refresh”." }); return false; }
  };
  const publish = async (note) => {
    setBusy("publish");
    try {
      if (unsaved && !(await doSave())) { addToast({ variant: "error", title: "Save the page before publishing", description: save.message || COPY.fixToSave }); return; }
      await cms.publish(doc.key, doc.liveVersion, note);
      setPublishOpen(false);
      if (await refresh(doc.key)) addToast({ variant: "success", title: `Published. Live on usemingla.com${row?.path === "Every page" ? "" : row?.path} within a minute.` });
      await Promise.all([loadList(), loadDoc(row)]);
    } catch (e) {
      if (e.code === "page_conflict" || e.code === "PT409") { setPublishOpen(false); setSave({ state: "conflict", message: "Someone else published this page first. Reload to see their version." }); }
      else if (e.code === "invalid_content") { setSrvErrs(serverErrors(e.detail)); setPublishOpen(false); addToast({ variant: "error", title: e.message }); }
      else addToast({ variant: "error", title: "Couldn't publish", description: e.message });
    } finally { setBusy(""); }
  };
  const [history, setHistory] = useState(undefined);
  const openHistory = async () => {
    setHistory(null);
    try { setHistory(await cms.history(doc.key)); } catch (e) { setHistory({ error: e }); }
  };
  const restore = async (v) => {
    setBusy(`restore-${v}`);
    try {
      await cms.restore(doc.key, v, doc.liveVersion);
      await refresh(doc.key);
      addToast({ variant: "success", title: `Version ${v} is live again as a new version.` });
      setHistory(undefined);
      await Promise.all([loadList(), loadDoc(row)]);
    } catch (e) { addToast({ variant: "error", title: "Couldn't restore", description: e.message }); }
    finally { setBusy(""); }
  };
  const [share, setShare] = useState(null);
  const shareLink = async () => {
    try {
      const t = await cms.previewToken(doc.key, clientOk ? contentRef.current : doc.live);
      setShare({ link: `${SITE_ORIGIN}/site-preview/${encodeURIComponent(t.token)}`, expires: t.expires_at });
    } catch (e) { addToast({ variant: "error", title: "Couldn't make a preview link", description: e.message }); }
  };
  const [metaErrors, setMetaErrors] = useState({});
  const onMeta = async (patch) => {
    setMetaErrors({});
    try {
      const custom = await cms.updatePageMeta(doc.key, patch);
      setDoc((d) => ({ ...d, custom: { ...d.custom, ...custom } }));
      await loadList();
      if (custom.ever_published) await refresh(doc.key);
      addToast({ variant: "success", title: "Page settings saved." });
    } catch (e) {
      const field = /path/.test(e.code) ? "path" : /name/.test(e.code) ? "name" : /description/.test(e.code) ? "seo_description" : "form";
      setMetaErrors({ [field]: e.message });
    }
  };
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deletePage = async (to) => {
    setBusy("delete");
    try {
      const wasLive = Boolean(doc.custom?.ever_published);
      await cms.deletePage(doc.key, to);
      if (wasLive) await refresh(doc.key);
      addToast({ variant: "success", title: wasLive ? `Deleted. Visitors to ${doc.custom.path} go to ${to}.` : "Draft page deleted." });
      setDeleteOpen(false);
      setSave({ state: "saved" });
      await loadList();
      if (!wasLive) setSelKey("home"); else await loadDoc(row);
    } catch (e) { addToast({ variant: "error", title: "Couldn't delete the page", description: e.message }); }
    finally { setBusy(""); }
  };
  const [newOpen, setNewOpen] = useState(false);
  const createPage = async ({ name, path, format, copyFrom }) => {
    let base = [];
    if (copyFrom) {
      const r = allRows.find((x) => x.key === copyFrom);
      const p = await cms.getPage(copyFrom);
      base = buildDoc(r, p).content.sections;
    } else {
      const f = FORMATS.find((x) => x.key === format);
      base = f?.from ? defaultSections(PAGE_DEFAULTS, f.from) : [];
    }
    const created = await cms.createPage(path, name, format, withIds(base.map(({ id: _id, ...s }) => { void _id; return s; })));
    setNewOpen(false);
    await loadList();
    setSelKey(created.page_key);
    addToast({ variant: "success", title: "Draft page created. Only staff see it until you publish." });
  };

  // ---- navigation between pages (with the unsaved-changes guard)
  const [leaving, setLeaving] = useState(null);
  const choose = (key) => {
    if (key === selKey) return;
    const go = () => { setSelKey(key); setToken(null); try { window.history.replaceState(null, "", `#/website-pages?page=${encodeURIComponent(key)}`); } catch { /* the address is a nicety */ } };
    if (unsaved) setLeaving(() => go); else go();
  };

  // ---- render
  if (noAccess) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Website pages" />
        <div className="grid min-h-[40vh] place-items-center rounded-2xl border border-[var(--a-line)] bg-[var(--a-panel)] p-6 text-center" data-no-access="">
          <p className="max-w-md text-sm text-[var(--a-text2)]">{COPY.noAccess}</p>
        </div>
      </div>
    );
  }
  const isBlocks = doc?.kind === "blocks";
  const selBlock = isBlocks && sel !== null ? sections[sel] : null;
  const takenPaths = allRows.map((r) => r.path).filter((p) => p.startsWith("/"));
  const saveWords = { saved: save.at ? "Saved" : "", dirty: "Unsaved changes", saving: "Saving…", error: save.message, invalid: save.message || COPY.fixToSave, conflict: save.message || COPY.conflict }[save.state];
  const reserved = RESERVED_SEGMENTS;
  const copyable = allRows.filter((r) => r.kind === "blocks");
  const liveTargets = ["/", ...allRows.filter((r) => r.path.startsWith("/") && !r.pattern && r.path !== "/" && r.status !== "draft" && r.status !== "deleted").map((r) => r.path)];

  return (
    <div className="flex flex-col gap-6">
    <PageHeader title="Website pages" description="Edit usemingla.com: click any words or picture on the page, add sections from the site's own blocks, then publish." />
    <div className="flex h-[calc(100vh-190px)] min-h-[600px] flex-col overflow-hidden rounded-2xl border border-[var(--a-line)] bg-[var(--a-panel)] shadow-[var(--a-shadow)]" data-website-pages="">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--a-line)] px-3 py-2" data-editor-top="">
        <div className="mr-auto flex min-w-0 flex-col">
          <b className="truncate text-[15px]" data-page-name="">{row ? row.title : "Website pages"}</b>
          <small className="truncate text-xs text-[var(--a-dim)]" data-save-state={save.state}>
            {row ? (row.path.startsWith("/") ? `usemingla.com${row.path}` : row.path) : "Loading pages…"}{saveWords ? ` · ${saveWords}` : ""}
          </small>
        </div>
        {row ? <StatusChip status={row.status} /> : null}
        <div role="group" aria-label="Screen size" className="inline-flex rounded-full border border-[var(--a-line)] bg-[var(--a-soft)] p-0.5">
          {Object.keys(DEVICE_LABELS).map((d) => {
            const I = DEVICE_ICONS[d];
            return <button key={d} type="button" aria-pressed={device === d} data-device={d} onClick={() => setDevice(d)} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${device === d ? "bg-[var(--a-text)] text-[var(--a-panel)]" : "text-[var(--a-text2)]"}`}><I size={12} aria-hidden="true" />{DEVICE_LABELS[d]}</button>;
          })}
        </div>
        <select aria-label="Zoom" className="h-8 rounded-full border border-[var(--a-line)] bg-[var(--a-panel)] px-2 text-xs text-[var(--color-text-primary)]" value={zoom} onChange={(e) => setZoom(e.target.value)} data-zoom-select="">
          <option value="fit">Fit</option><option value="full">100%</option>
        </select>
        {canEdit ? (
          <>
            <Button size="sm" variant="secondary" icon={Undo2} disabled={!hist.undo.length} onClick={() => step("undo")} data-undo="" aria-label="Undo">Undo</Button>
            <Button size="sm" variant="secondary" icon={Redo2} disabled={!hist.redo.length} onClick={() => step("redo")} data-redo="" aria-label="Redo">Redo</Button>
          </>
        ) : null}
        <Button size="sm" variant="secondary" icon={ImageIcon} onClick={() => setMediaReq({ mode: "manage" })} data-open-media="">Media</Button>
        {doc ? <Button size="sm" variant="secondary" icon={History} onClick={openHistory} data-open-history="">History</Button> : null}
        {doc && canEdit ? <Button size="sm" variant="secondary" icon={Link2} onClick={shareLink} data-share-preview="">Share preview</Button> : null}
        {refreshFailed ? <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => refresh(doc.key).then((ok) => ok && addToast({ variant: "success", title: "The site refreshed." }))}>Retry the refresh</Button> : null}
        {doc && canEdit ? <Button size="sm" onClick={() => setPublishOpen(true)} disabled={save.state === "conflict" || !hasDraft} data-open-publish="">Publish</Button> : null}
      </div>
      {save.state === "conflict" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-[var(--a-line)] bg-[var(--a-stop-bg)] px-3 py-2 text-sm text-[var(--a-stop-ink)]" data-conflict="">
          <span className="flex-1">{save.message} Your edits stay here until you reload.</span>
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => loadDoc(row)}>Reload</Button>
        </div>
      ) : save.state === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-[var(--a-line)] bg-[var(--color-error-50)] px-3 py-2 text-sm text-[var(--color-error-700)]" data-save-error="">
          <span className="flex-1">{save.message}</span>
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => doSave()}>Retry</Button>
        </div>
      ) : null}
      {doc && !doc.canEdit ? <div className="border-b border-[var(--a-line)] bg-[var(--a-soft)] px-3 py-2 text-sm text-[var(--a-text2)]" data-view-only="">{COPY.viewOnly}</div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* Left rail */}
        <aside className="min-h-0 overflow-auto border-b border-[var(--a-line)] p-3 lg:border-b-0 lg:border-r" aria-label="Pages and sections">
          <div className="mb-2 flex gap-1" role="tablist">
            {[["pages", "Pages"], ["sections", "Sections"]].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-tab={k}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-sm font-medium ${tab === k ? "border-[var(--a-dim)] bg-[var(--a-soft)]" : "border-[var(--a-line)]"}`}>{l}</button>
            ))}
          </div>
          {tab === "pages" ? (
            <div data-page-list="">
              {doc?.canEdit ? <Button className="mb-2 w-full" size="sm" icon={Plus} onClick={() => setNewOpen(true)} data-new-page="">New page</Button> : null}
              <div className="relative mb-2">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--a-dim)]" aria-hidden="true" />
                <input className={`${FIELD} pl-7`} placeholder="Search pages" aria-label="Search pages" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {listError ? <LoadError message={listError.message} onRetry={loadList} /> : !manifest || !state ? (
                <div className="space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={34} rounded="8px" />)}</div>
              ) : !groups.length ? <p className="rounded-xl border border-dashed border-[var(--a-line)] p-3 text-xs text-[var(--a-dim)]">No page matches that search.</p> : groups.map((g) => (
                <div key={g.label} className="mb-1">
                  <p className="mb-1 mt-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--a-dim)]">{g.label}</p>
                  {g.items.map((p) => (
                    <button key={p.key} type="button" onClick={() => choose(p.key)} aria-current={p.key === selKey ? "page" : undefined} data-page-item={p.key}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${p.key === selKey ? "bg-[var(--a-chip)]" : "hover:bg-[var(--a-soft)]"}`}>
                      <span className="min-w-0 flex-1"><b className="block truncate text-[13px] font-medium">{p.title}</b><small className="block truncate text-[11px] text-[var(--a-dim)]">{p.path}</small></span>
                      <StatusChip status={p.status} short />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : isBlocks ? (
            <SectionList sections={sections} nameOf={nameOf} selected={sel} invalid={invalidIdx} canEdit={canEdit} pageName={row?.title}
              onSelect={(i) => select(i)} onMove={(from, to) => { editSections((l) => moveSection(l, from, to)); setSel(to); }} onAdd={(at) => setPickerAt(at)} />
          ) : (
            <Note>{doc?.kind === "settings" ? "The menu and footer have no sections. Edit them on the right." : doc?.kind === "locked" ? COPY.locked : "This page keeps its designed sections. Add a form, buttons or a banner in its spots on the right."}</Note>
          )}
        </aside>

        {/* Canvas */}
        <section className="flex min-h-[420px] min-w-0 flex-col" aria-label="Page preview">
          {docError ? <div className="p-4"><LoadError message={docError.message} onRetry={() => loadDoc(row)} /></div> : (
            <>
              {previewNote ? <Note tone="warn" className="m-2">{previewNote}</Note> : null}
              {isBlocks && checks && checks.page.length ? <Note tone="bad" className="m-2">{checks.page.join(" ")}</Note> : null}
              {srvErrs.page.length ? <Note tone="bad" className="m-2">{srvErrs.page.join(" ")}</Note> : null}
              <EditorCanvas ref={frameRef} src={src} frameKey={frameKey} device={device} zoom={zoom} title={row ? `${row.title} as visitors will see it` : "Page preview"}
                failed={frameFailed} onRetry={() => { retried.current = false; void mint(); }} selIndex={isBlocks && sel !== null && selBlock ? sel : null} count={sections.length}
                selectedName={selBlock ? nameOf(selBlock) : ""} selectedHidden={Boolean(selBlock?.hidden)} canEdit={canEdit} onAction={act} onAddBelow={(at) => setPickerAt(at)} />
            </>
          )}
        </section>

        {/* Right rail */}
        <aside className="min-h-0 overflow-auto border-t border-[var(--a-line)] p-3 lg:border-l lg:border-t-0" aria-label="Edit">
          {!doc ? <Skeleton height={300} rounded="12px" /> : doc.kind === "locked" ? (
            <div><h3 className="text-sm font-semibold">Locked page</h3><Note className="mt-2">{COPY.locked}</Note></div>
          ) : doc.kind === "pattern" ? (
            <div><h3 className="text-sm font-semibold">{row.title}</h3><Note className="mt-2">This address is one template for many pages (like each city or blog post). It is shown here with a sample.</Note></div>
          ) : doc.kind === "settings" ? (
            <SiteSettingsPanel content={doc.content} onChange={edit} canEdit={canEdit} errors={settingsErrs} />
          ) : doc.kind === "spots" ? (
            manifestPage ? <PageSidePanel page={{ ...manifestPage, spots: manifestPage.spots || [] }} panel={spotPanel} setPanel={setSpotPanel} canEdit={canEdit} doc={doc} tpl={null} onEdit={(_k, content) => edit(content)} forms={forms} /> : <Skeleton height={200} />
          ) : selBlock ? (
            <BlockPanel key={`${doc.key}-${selBlock.id}`} def={blockDef(REGISTRY, selBlock.type)} block={selBlock} index={sel} count={sections.length} errors={errorsFor(sel)} canEdit={canEdit}
              focusField={focusField} onChange={(b) => editSections((l) => l.map((x, j) => (j === sel ? b : x)))} onAction={act} onAddBelow={(at) => setPickerAt(at)}
              openMedia={openMedia} media={doc.media} forms={forms} supabaseUrl={SUPABASE_URL} />
          ) : (
            <PageMetaPanel key={doc.key} page={row} custom={doc.custom} canEdit={canEdit} media={doc.media} supabaseUrl={SUPABASE_URL} onMeta={onMeta} openMedia={openMedia} onDelete={() => setDeleteOpen(true)} metaErrors={metaErrors} />
          )}
        </aside>
      </div>

      <BlockPicker open={pickerAt !== null} onClose={() => setPickerAt(null)} registry={REGISTRY} sections={sections} onPick={addBlock} />
      <NewPageModal open={newOpen} onClose={() => setNewOpen(false)} reserved={reserved} takenPaths={takenPaths} copyable={copyable} onCreate={createPage} />
      {publishOpen ? <PublishModal open onClose={() => setPublishOpen(false)} title={row?.title} path={row?.path?.startsWith("/") ? row.path : ""} changes={changes} onPublish={publish} busy={busy === "publish"} /> : null}
      <HistoryModal open={history !== undefined} onClose={() => setHistory(undefined)} title={row?.title} history={history} onRetry={openHistory} onRestore={restore} busyVersion={busy.startsWith("restore-") ? Number(busy.slice(8)) : null} canEdit={canEdit} />
      {deleteOpen ? <DeletePageModal open onClose={() => setDeleteOpen(false)} page={{ ...row, custom: doc?.custom }} liveTargets={liveTargets} onDelete={deletePage} busy={busy === "delete"} /> : null}
      <ShareLinkModal open={Boolean(share)} onClose={() => setShare(null)} link={share?.link} expires={share?.expires}
        onCopy={() => navigator.clipboard.writeText(share.link).then(() => addToast({ variant: "success", title: "Preview link copied." }), () => addToast({ variant: "error", title: "Couldn't copy. Select the link and copy it." }))} />
      {mediaReq ? (
        <MediaLibrary open onClose={() => setMediaReq(null)} cms={cms} supabaseUrl={SUPABASE_URL} mode={mediaReq.mode} accept={mediaReq.accept || ["photo", "video"]} canEdit={Boolean(doc?.canEdit)} findUsage={findUsage}
          onPick={(ref, item) => { if (item) setDoc((d) => ({ ...d, media: { ...d.media, [item.id]: item } })); mediaReq.onPick?.(ref); setMediaReq(null); }} />
      ) : null}
      {leaving ? (
        <div role="alertdialog" aria-label="Unsaved changes" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(560px,calc(100vw-32px))] flex-wrap items-center gap-3 rounded-2xl border border-[var(--a-line)] bg-[var(--a-panel)] p-3 shadow-[var(--shadow-lg)]" data-leave-guard="">
          <span className="flex-1 text-sm">{save.state === "saving" || save.state === "dirty" ? "Your last edit is still saving." : "This page has changes that aren't saved."}</span>
          <Button size="sm" variant="secondary" onClick={() => setLeaving(null)}>Keep editing</Button>
          {save.state === "dirty" || save.state === "saving" || save.state === "error" ? <Button size="sm" onClick={async () => { const go = leaving; if (await doSave()) { setLeaving(null); go(); } }}>Save and leave</Button> : null}
          <Button size="sm" variant="danger" onClick={() => { const go = leaving; setLeaving(null); setSave({ state: "saved" }); go(); }}>Leave without saving</Button>
        </div>
      ) : null}
    </div>
    </div>
  );
}
