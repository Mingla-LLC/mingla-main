import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { brandSiteKeys } from "../../../../sites/brandSiteKeys";
import {
  addSection,
  BrandSiteContentConflict,
  editSection,
  getPageSections,
  markSectionsReviewed,
  moveSection,
  redoSiteChange,
  removeSection,
  pageSectionsKey,
  setPageEnabled,
  setSectionMedia,
  undoSiteChange,
  usePageSections,
  useReviewStatus,
  useSitePages,
  useSiteWorkspace,
  type PageSections,
  type SiteWorkspace,
  type SectionListOp,
  type WorkspacePage,
  type WorkspaceSection,
} from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { createDraftWriter, type DraftJob, type DraftWriter, type SaveState } from "../../../../sites/draftWriter";
import {
  applyFieldEdits,
  applyLayout,
  applyMedia,
  applyMove,
  applyRemove,
  applyReviewed,
  changeLabel,
} from "../../../../sites/sectionEdits";
import { PREVIEW_SCROLL_TO, PREVIEW_TEXT, previewTextSendable } from "../../../../sites/previewBridge";
import { previewFrameSource } from "../../../../sites/previewFrame";
import { unreviewedSectionCount } from "../../../../sites/setupStatus";
import type { WorkspaceDetail, WorkspaceMode, WorkspaceTarget } from "../../../../sites/workspaceRoute";
import type { WebsiteController } from "../useWebsiteController";
import type { PreviewCommands } from "./usePreviewFrames";

/*
 * #4453 — the Website workspace's one owner of state: which mode, page and
 * section are showing, the draft's sections (changed optimistically, saved
 * by the autosave writer), undo / redo, and keeping the live preview in step
 * without a flash. Components below it render and call; none of them talks
 * to the server on its own.
 */
export const CONFLICT_MESSAGE = "Someone changed this while you were editing. Showing the latest.";
/** #4572 item 11 — the "Not saved" line after a teammate saved the page first. */
export const UNSAVED_AFTER_CONFLICT = "Your words weren’t saved. Try again on the latest version.";
const PREVIEW_REFRESH_MS = 350;

/** Whether the draft preview has a page to draw for this one (as the site runtime resolves it). */
export function previewablePage(page: Pick<WorkspacePage, "enabled" | "ari_draft" | "path">): boolean {
  return (page.enabled || page.ari_draft) && typeof page.path === "string";
}

export type WorkspaceToast = { message: string; kind: "success" | "info" | "warn" | "error"; action?: { label: string; onPress: () => void } };
export type LoadState = "loading" | "error" | "ready";

export function useWorkspace(input: {
  brandId: string;
  siteId: string;
  controller: WebsiteController;
  target: WorkspaceTarget;
  targetKey: string;
  readOnlyReason: string | null;
  notify: (toast: WorkspaceToast) => void;
}) {
  const { siteId, controller, notify } = input;
  const client = useQueryClient();
  const readOnly = input.readOnlyReason !== null;

  const [mode, setMode] = useState<WorkspaceMode>(input.target.mode);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(input.target.detail);
  const [publishOpen, setPublishOpen] = useState(input.target.publish);
  const [requestId, setRequestId] = useState<string | null>(input.target.requestId);
  // The address changed (a link, the back button): land where it says.
  const seenTarget = useRef(input.targetKey);
  useEffect(() => {
    if (seenTarget.current === input.targetKey) return;
    seenTarget.current = input.targetKey;
    setMode(input.target.mode);
    setDetail(input.target.detail);
    setPublishOpen(input.target.publish);
    setRequestId(input.target.requestId);
  }, [input.target, input.targetKey]);

  /* ── Pages ─────────────────────────────────────────────────────────── */
  const workspace = useSiteWorkspace(siteId);
  const sitePages = useSitePages(siteId, workspace.isError);
  const review = useReviewStatus(siteId);
  const pages: WorkspacePage[] = useMemo(() => {
    if (workspace.data) return workspace.data.pages;
    // The workspace read is down: the page list still comes from the pages read.
    return (sitePages.data?.pages ?? []).map((row) => ({
      id: row.id, title: row.title, path: row.path, enabled: row.enabled, in_menu: row.in_menu, revision: row.revision,
      ari_draft: row.ari_draft === true, unreviewed: row.review_count ?? 0,
    }));
  }, [sitePages.data, workspace.data]);
  const pagesState: LoadState = workspace.data || sitePages.data ? "ready" : workspace.isError && (sitePages.isError || !sitePages.isFetching) ? "error" : "loading";

  const [pageId, setPageId] = useState<string | null>(null);
  const page = pages.find((entry) => entry.id === pageId) ?? pages.find((entry) => !entry.path) ?? pages[0] ?? null;
  const activePageId = page?.id ?? null;

  /* ── Sections ──────────────────────────────────────────────────────── */
  const sectionsQuery = usePageSections(siteId, activePageId);
  const sections: WorkspaceSection[] = useMemo(() => sectionsQuery.data?.sections ?? [], [sectionsQuery.data]);
  const sectionsState: LoadState = sectionsQuery.data ? "ready" : sectionsQuery.isError ? "error" : "loading";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cardFor, setCardFor] = useState<string | null>(null);
  const [ariSectionId, setAriSectionId] = useState<string | null>(null);
  const selected = sections.find((entry) => entry.id === selectedId) ?? null;

  const previewRef = useRef<PreviewCommands | null>(null);
  const shownText = useRef(new Map<string, string>());

  const sectionsKey = useCallback((id: string | null) => pageSectionsKey(siteId, id), [siteId]);
  /**
   * Each page as it was before the changes still being saved were shown on it.
   * A change that does not save is taken off the screen at once from here, even
   * when the page cannot be read again (the service that refused is down).
   */
  const beforeUnsaved = useRef(new Map<string, PageSections>());
  const patchSections = useCallback((id: string, change: (list: WorkspaceSection[]) => WorkspaceSection[]) => {
    client.setQueryData<PageSections>(sectionsKey(id), (current) => {
      if (!current) return current;
      if (!beforeUnsaved.current.has(id)) beforeUnsaved.current.set(id, current);
      return { ...current, sections: change(current.sections) };
    });
  }, [client, sectionsKey]);

  /* ── Keeping the preview in step ───────────────────────────────────── */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPreview = controller.refreshPreview;
  const schedulePreview = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      shownText.current.clear();
      refreshPreview();
    }, PREVIEW_REFRESH_MS);
  }, [refreshPreview]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const afterChange = useCallback((what: { pages?: readonly string[]; look?: boolean; menu?: boolean } = {}) => {
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "workspace") });
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "changes") });
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "validation") });
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "history") });
    // The cover is the home page's top section: any page change may have moved its revision or its photo.
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "cover") });
    void client.invalidateQueries({ queryKey: brandSiteKeys.reviewStatus(siteId) });
    for (const id of what.pages ?? []) void client.invalidateQueries({ queryKey: sectionsKey(id) });
    if (what.look) void client.invalidateQueries({ queryKey: brandSiteKeys.look(siteId) });
    if (what.menu || what.pages) void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "pages") });
    schedulePreview();
  }, [client, schedulePreview, sectionsKey, siteId]);

  /* ── Autosave ──────────────────────────────────────────────────────── */
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const live = useRef({ notify, afterChange, patchSections });
  live.current = { notify, afterChange, patchSections };
  const writerRef = useRef<DraftWriter | null>(null);
  if (writerRef.current === null) {
    const revisionOf = (id: string): string | null => client.getQueryData<PageSections>(sectionsKey(id))?.page.revision ?? null;
    const freshRevision = async (id: string): Promise<string | null> => {
      const fresh = await client.fetchQuery({ queryKey: sectionsKey(id), queryFn: () => getPageSections(siteId, id), staleTime: 0 });
      return fresh.page.revision;
    };
    const send = async (job: DraftJob, revision: string | null): Promise<string | null> => {
      if (job.kind === "reviewed") {
        // No revision is stated, so this works for a page never opened here.
        await markSectionsReviewed(siteId, job.pageId, job.sectionIds);
        // An open page's revision moved: read it again. A page never opened is read when it is.
        return client.getQueryData<PageSections>(sectionsKey(job.pageId)) ? freshRevision(job.pageId) : null;
      }
      if (revision === null) throw new Error("PAGE_NOT_LOADED");
      const base = { pageId: job.pageId, expectedRevision: revision };
      switch (job.kind) {
        case "edit": return (await editSection(siteId, { ...base, sectionId: job.sectionId, edits: job.edits })).page_revision;
        case "list":
          await editSection(siteId, { ...base, sectionId: job.sectionId, listOps: job.ops });
          // Rows moved, so every later row has a new key: read the page again.
          return freshRevision(job.pageId);
        case "layout": return (await editSection(siteId, { ...base, sectionId: job.sectionId, layout: job.layout })).page_revision;
        case "move": return (await moveSection(siteId, { ...base, sectionId: job.sectionId, toIndex: job.toIndex })).page_revision;
        case "remove": return (await removeSection(siteId, { ...base, sectionId: job.sectionId })).page_revision;
        case "media": return (await setSectionMedia(siteId, { ...base, sectionId: job.sectionId, slot: job.slot, mediaId: job.mediaId })).page_revision;
        case "add":
          await addSection(siteId, { ...base, type: job.type, afterSectionId: job.afterSectionId, mediaId: job.mediaId ?? null });
          // The new section's fields come from the server: read the page again.
          return freshRevision(job.pageId);
      }
    };
    writerRef.current = createDraftWriter({
      send,
      getRevision: revisionOf,
      setRevision: (id, revision) => {
        client.setQueryData<PageSections>(sectionsKey(id), (current) => (current ? { ...current, page: { ...current.page, revision } } : current));
        client.setQueryData<SiteWorkspace>(brandSiteKeys.siteData(siteId, "workspace"), (current) => (current
          ? { ...current, pages: current.pages.map((entry) => (entry.id === id ? { ...entry, revision } : entry)) }
          : current));
      },
      onState: setSaveState,
      // Sections are not re-read after a save: what is on screen already matches,
      // and a re-read landing mid-typing would put older words back.
      onSaved: (job) => {
        // #4572 item 11 — words that were "Not saved" are saved now.
        if (job.kind === "edit") clearUnsaved(job.pageId, job.sectionId, job.edits.map((edit) => edit.key));
        // Everything shown is saved: what is on screen is the page again.
        if (writerRef.current?.pending() === 0) beforeUnsaved.current.clear();
        live.current.afterChange();
      },
      keepsQueue: (error) => error instanceof BrandSitesError && !(error instanceof BrandSiteContentConflict),
      onError: (error, job, _dropped, kind) => {
        const reason = error instanceof BrandSiteContentConflict
          ? UNSAVED_AFTER_CONFLICT
          : error instanceof BrandSitesError ? error.message : `${job.label} didn’t save. Check your connection and try again.`;
        // #4572 item 11 — typed words are never wiped: they stay on screen,
        // marked "Not saved", with Try again (also after a teammate's change).
        if (job.kind === "edit") keepUnsaved(job.pageId, job.sectionId, job.edits, reason);
        if (kind === "refused") {
          // The draft did not move: only this job's own change is undone (a
          // typing job keeps its words above); the rest of the queue goes on.
          if (job.kind !== "edit") void client.invalidateQueries({ queryKey: sectionsKey(job.pageId) });
          live.current.notify({ message: `${reason} (${job.label} wasn’t saved.)`, kind: "error" });
          return;
        }
        // Put the page back to what the server holds: nothing optimistic survives a refusal.
        // First to the page as it was before the unsaved changes (it may not be readable right now)...
        const before = beforeUnsaved.current.get(job.pageId);
        beforeUnsaved.current.delete(job.pageId);
        if (before) {
          client.setQueryData<PageSections>(sectionsKey(job.pageId), (current) => (current ? { ...before, page: { ...before.page, revision: current.page.revision } } : before));
        }
        // ...then to whatever the server says now.
        void client.invalidateQueries({ queryKey: sectionsKey(job.pageId) });
        void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "workspace") });
        live.current.afterChange();
        if (error instanceof BrandSiteContentConflict) {
          live.current.notify({ message: CONFLICT_MESSAGE, kind: "warn" });
          return;
        }
        live.current.notify({
          message: error instanceof BrandSitesError
            ? `${error.message} (${job.label} wasn’t saved.)`
            : `${job.label} didn’t save. Check your connection and try again.`,
          kind: "error",
        });
      },
    });
  }
  function keepUnsaved(pageId: string, sectionId: string, edits: readonly { key: string; value: string }[], message: string): void {
    setUnsaved((current) => {
      const next = new Map(current);
      for (const edit of edits) next.set(`${pageId}:${sectionId}:${edit.key}`, { value: edit.value, message });
      return next;
    });
  }
  function clearUnsaved(pageId: string, sectionId: string, keys: readonly string[]): void {
    setUnsaved((current) => {
      if (!keys.some((key) => current.has(`${pageId}:${sectionId}:${key}`))) return current;
      const next = new Map(current);
      for (const key of keys) next.delete(`${pageId}:${sectionId}:${key}`);
      return next;
    });
  }
  const writer = writerRef.current;
  const writerOwners = useRef(0);

  /* ── #4572 item 11 — words that did not save ─────────────────────────── */
  // (keepUnsaved / clearUnsaved are hoisted: the writer above calls them after a save settles.)
  const [unsaved, setUnsaved] = useState<ReadonlyMap<string, { value: string; message: string }>>(() => new Map());
  const unsavedValue = useCallback((sectionId: string, key: string): string | null => {
    for (const [id, entry] of unsaved) if (id.endsWith(`:${sectionId}:${key}`)) return entry.value;
    return null;
  }, [unsaved]);
  const unsavedMessage = useCallback((sectionId: string, key: string): string | null => {
    for (const [id, entry] of unsaved) if (id.endsWith(`:${sectionId}:${key}`)) return entry.message;
    return null;
  }, [unsaved]);
  useEffect(() => {
    // The writer lives as long as this screen: if the effect is run again for the same
    // screen, the writer takes changes again (a disposed one drops them silently).
    const current = writerRef.current;
    writerOwners.current += 1;
    const owner = writerOwners.current;
    current?.resume();
    return () => {
      if (!current) return;
      void current.flush().finally(() => {
        if (writerOwners.current === owner) current.dispose();
      });
    };
  }, []);

  const guard = useCallback((): boolean => {
    if (!readOnly) return true;
    notify({ message: input.readOnlyReason ?? "You can’t change the website right now.", kind: "info" });
    return false;
  }, [input.readOnlyReason, notify, readOnly]);

  /* ── Selecting ─────────────────────────────────────────────────────── */
  const select = useCallback((id: string | null, options: { card?: boolean; expand?: boolean; scroll?: boolean } = {}) => {
    setSelectedId(id);
    setCardFor(options.card && id ? id : null);
    if (options.expand !== undefined) setExpandedId(options.expand ? id : null);
    if (id && options.scroll) previewRef.current?.post({ type: PREVIEW_SCROLL_TO, section_id: id });
  }, []);

  const selectPage = useCallback((id: string) => {
    void writer.flush();
    setPageId(id);
    setSelectedId(null);
    setExpandedId(null);
    setCardFor(null);
    shownText.current.clear();
  }, [writer]);

  /** "Show me": the page, the section, in view. */
  const showSection = useCallback((targetPageId: string, sectionId: string) => {
    if (targetPageId !== activePageId) {
      void writer.flush();
      setPageId(targetPageId);
      shownText.current.clear();
    }
    setMode("edit");
    setDetail(null);
    setSelectedId(sectionId);
    setExpandedId(sectionId);
    setCardFor(null);
    // On another page the frame that holds this section is still loading:
    // the preview remembers the request and scrolls once that frame is ready.
    previewRef.current?.post({ type: PREVIEW_SCROLL_TO, section_id: sectionId });
  }, [activePageId, writer]);

  /**
   * A section to land on without leaving the screen that is open (a team
   * request opened from its notification: the Requests list stays in front,
   * and the section is selected, open and in view when the owner goes back
   * to the page). Null `sectionId`: just that page.
   */
  const preselect = useCallback((targetPageId: string, sectionId: string | null) => {
    if (targetPageId !== activePageId) {
      void writer.flush();
      setPageId(targetPageId);
      shownText.current.clear();
    }
    setSelectedId(sectionId);
    setExpandedId(sectionId);
    setCardFor(null);
    if (sectionId) previewRef.current?.post({ type: PREVIEW_SCROLL_TO, section_id: sectionId });
  }, [activePageId, writer]);

  /* ── Changes ───────────────────────────────────────────────────────── */
  const typeField = useCallback((section: WorkspaceSection, key: string, value: string) => {
    if (!activePageId || !guard()) return;
    const field = section.fields.find((entry) => entry.key === key);
    const id = `${section.id}:${key}`;
    const from = shownText.current.get(id) ?? field?.value ?? "";
    // The page shows the new words only when the frame takes the swap: words it
    // would drop (longer than its limit) leave the page as it is until the rebuild.
    if (from && value && from !== value && previewTextSendable(from, value)) {
      previewRef.current?.post({ type: PREVIEW_TEXT, section_id: section.id, from, to: value });
      shownText.current.set(id, value);
    }
    patchSections(activePageId, (list) => applyFieldEdits(list, section.id, [{ key, value }]));
    // #4572 item 11 — the newest keystroke wins over the kept words.
    clearUnsaved(activePageId, section.id, [key]);
    writer.typeField(activePageId, section.id, key, value, changeLabel.edit(section.label));
  }, [activePageId, guard, patchSections, writer]);

  /** #4572 item 11 — Try again: send the kept words once more (they stay until that save lands). */
  const retryField = useCallback((section: WorkspaceSection, key: string) => {
    if (!activePageId || !guard()) return;
    const value = unsavedValue(section.id, key);
    if (value === null) return;
    patchSections(activePageId, (list) => applyFieldEdits(list, section.id, [{ key, value }]));
    writer.typeField(activePageId, section.id, key, value, changeLabel.edit(section.label));
    void writer.flush();
  }, [activePageId, guard, patchSections, unsavedValue, writer]);

  const setLayout = useCallback((section: WorkspaceSection, layout: string) => {
    if (!activePageId || section.layout === layout || !guard()) return;
    patchSections(activePageId, (list) => applyLayout(list, section.id, layout));
    void writer.enqueue({ kind: "layout", pageId: activePageId, sectionId: section.id, layout, label: changeLabel.layout(section.label) });
  }, [activePageId, guard, patchSections, writer]);

  const move = useCallback((section: WorkspaceSection, direction: -1 | 1) => {
    if (!activePageId || !guard()) return;
    const index = sections.findIndex((entry) => entry.id === section.id);
    const toIndex = index + direction;
    if (index < 0 || toIndex < 0 || toIndex >= sections.length) return;
    patchSections(activePageId, (list) => applyMove(list, section.id, toIndex));
    void writer.enqueue({ kind: "move", pageId: activePageId, sectionId: section.id, toIndex, label: changeLabel.move(section.label) });
  }, [activePageId, guard, patchSections, sections, writer]);

  const historyState = workspace.data?.history ?? null;
  const [undoing, setUndoing] = useState<null | "undo" | "redo">(null);
  const runHistory = useCallback(async (kind: "undo" | "redo", groupId?: string | null): Promise<boolean> => {
    if (!guard() || undoing) return false;
    setUndoing(kind);
    try {
      await writer.flush();
      const result = kind === "undo" ? await undoSiteChange(siteId, groupId) : await redoSiteChange(siteId, groupId);
      shownText.current.clear();
      afterChange({ pages: result.pages, look: result.look, menu: result.menu });
      notify({ message: `${kind === "undo" ? "Undone" : "Done again"}: ${result.label}`, kind: "success" });
      return true;
    } catch (error) {
      notify({ message: error instanceof BrandSitesError ? error.message : kind === "undo" ? "That couldn’t be undone. Try again." : "That couldn’t be redone. Try again.", kind: "error" });
      afterChange({ pages: activePageId ? [activePageId] : [] });
      return false;
    } finally {
      setUndoing(null);
    }
  }, [activePageId, afterChange, guard, notify, siteId, undoing, writer]);

  const remove = useCallback((section: WorkspaceSection) => {
    if (!activePageId || !section.can_remove || !guard()) return;
    patchSections(activePageId, (list) => applyRemove(list, section.id));
    if (selectedId === section.id) select(null);
    void writer.enqueue({ kind: "remove", pageId: activePageId, sectionId: section.id, label: changeLabel.remove(section.label) }).then((saved) => {
      if (saved) notify({ message: `Removed “${section.label}” from your draft.`, kind: "info", action: { label: "Undo", onPress: () => { void runHistory("undo"); } } });
    });
  }, [activePageId, guard, notify, patchSections, runHistory, select, selectedId, writer]);

  const add = useCallback((type: string, label: string, afterSectionId: string | null, mediaId: string | null = null) => {
    if (!activePageId || !guard()) return;
    void writer.enqueue({ kind: "add", pageId: activePageId, type, afterSectionId, mediaId, label: changeLabel.add(label) }).then((saved) => {
      // As built: a section the owner adds starts as a draft with starter words.
      if (saved) notify({ message: `Added “${label}” with starter words. Open it, make it yours, then choose Looks good.`, kind: "success" });
    });
  }, [activePageId, guard, notify, writer]);

  /** A photo for a slot; null takes the photo out. */
  const setMedia = useCallback((section: WorkspaceSection, slot: string, picked: { id: string; thumb_url: string | null } | null) => {
    if (!activePageId || !guard()) return;
    patchSections(activePageId, (list) => applyMedia(list, section.id, slot, { id: picked?.id ?? null, thumbUrl: picked?.thumb_url ?? null }));
    void writer.enqueue({ kind: "media", pageId: activePageId, sectionId: section.id, slot, mediaId: picked?.id ?? null, label: changeLabel.photo(section.label) }).then(() => {
      // A photo list grows or shrinks by a slot: read the page again.
      void client.invalidateQueries({ queryKey: sectionsKey(activePageId) });
    });
  }, [activePageId, client, guard, patchSections, sectionsKey, writer]);

  /** Add or remove a row in one of the section's lists (a question, a feature). */
  const listOp = useCallback((section: WorkspaceSection, op: SectionListOp, done: string) => {
    if (!activePageId || !guard()) return;
    shownText.current.clear();
    void writer.enqueue({ kind: "list", pageId: activePageId, sectionId: section.id, ops: [op], label: changeLabel.row(section.label) }).then((saved) => {
      if (saved) notify({ message: done, kind: "success", action: { label: "Undo", onPress: () => { void runHistory("undo"); } } });
    });
  }, [activePageId, guard, notify, runHistory, writer]);

  /** "Looks good" for sections on any page. */
  const looksGood = useCallback((targetPageId: string, sectionIds: string[] | "all") => {
    if (!guard()) return;
    patchSections(targetPageId, (list) => applyReviewed(list, sectionIds));
    client.setQueryData(brandSiteKeys.reviewStatus(siteId), (current: { total: number; pages: { id: string; count: number; blocks: { id: string }[] }[] } | undefined) => {
      if (!current) return current;
      const nextPages = current.pages.map((entry) => {
        if (entry.id !== targetPageId) return entry;
        const blocks = sectionIds === "all" ? [] : entry.blocks.filter((block) => !sectionIds.includes(block.id));
        return { ...entry, blocks, count: blocks.length };
      });
      return { ...current, pages: nextPages, total: nextPages.reduce((sum, entry) => sum + entry.count, 0) };
    });
    void writer.enqueue({ kind: "reviewed", pageId: targetPageId, sectionIds, label: "Looks good" });
  }, [client, guard, patchSections, siteId, writer]);

  const togglePage = useCallback(async (target: WorkspacePage, enabled: boolean) => {
    if (!guard()) return;
    try {
      await writer.flush();
      await setPageEnabled(siteId, { pageId: target.id, expectedRevision: target.revision, enabled });
      afterChange({ pages: [target.id], menu: true });
      notify({ message: enabled ? `“${target.title}” is back on your draft.` : `“${target.title}” is off and out of your menu. Undo puts it back.`, kind: "success", action: { label: "Undo", onPress: () => { void runHistory("undo"); } } });
    } catch (error) {
      afterChange({ pages: [target.id], menu: true });
      notify({ message: error instanceof BrandSiteContentConflict ? CONFLICT_MESSAGE : error instanceof BrandSitesError ? error.message : "That page couldn’t be changed. Try again.", kind: error instanceof BrandSiteContentConflict ? "warn" : "error" });
    }
  }, [afterChange, guard, notify, runHistory, siteId, writer]);

  /* ── Derived ───────────────────────────────────────────────────────── */
  const unread = workspace.data
    ? workspace.data.pages.reduce((sum, entry) => sum + (entry.enabled && entry.unreviewed > 0 ? entry.unreviewed : 0), 0)
    : unreviewedSectionCount(review.data);

  const grant = controller.previewGrant;
  const origin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null;
  // The draft preview draws a page only when it is on (or is a page Ari drafted) and has an
  // address; for any other page the frame would be "not found", with nothing to click.
  const pagePreviewable = page ? previewablePage(page) : false;
  const frameUrl = grant.data && page && pagePreviewable ? previewFrameSource(grant.data.preview_url, siteId, page.path ?? "", origin) : null;
  const previewState: LoadState = grant.data ? "ready" : grant.isError ? "error" : "loading";

  const retry = useCallback(() => {
    void workspace.refetch();
    void sectionsQuery.refetch();
    void grant.refetch();
    void review.refetch();
  }, [grant, review, sectionsQuery, workspace]);

  return {
    siteId,
    // #4572 item 11 — typed words a refused save kept ("Not saved").
    unsavedValue,
    unsavedMessage,
    retryField,
    readOnly,
    readOnlyReason: input.readOnlyReason,
    mode,
    setMode: (next: WorkspaceMode) => { setMode(next); setDetail(null); },
    detail,
    openDetail: (next: WorkspaceDetail) => { setDetail(next); setPublishOpen(false); setCardFor(null); },
    closeDetail: () => {
      setDetail(null);
      setRequestId(null);
      // The page was out of sight behind that screen: bring the chosen section back into view.
      if (selectedId) setTimeout(() => previewRef.current?.post({ type: PREVIEW_SCROLL_TO, section_id: selectedId }), 80);
    },
    publishOpen,
    openPublish: () => { void writer.flush(); setPublishOpen(true); setCardFor(null); },
    closePublish: () => setPublishOpen(false),
    requestId,
    workspace: workspace.data ?? null,
    workspaceDown: workspace.isError,
    pages,
    pagesState,
    page,
    selectPage,
    sections,
    sectionsState,
    sectionsError: sectionsQuery.error,
    selectedId,
    selected,
    expandedId,
    setExpandedId,
    cardFor,
    closeCard: () => setCardFor(null),
    select,
    showSection,
    preselect,
    ariSectionId,
    setAriSectionId,
    typeField,
    setLayout,
    move,
    remove,
    add,
    setMedia,
    listOp,
    looksGood,
    togglePage,
    saveState,
    flush: () => writer.flush(),
    history: historyState,
    undo: () => runHistory("undo"),
    redo: () => runHistory("redo"),
    undoGroup: (groupId: string) => runHistory("undo", groupId),
    undoing,
    unread,
    review,
    afterChange,
    previewRef,
    frameUrl,
    /** False when the page on screen is off (or has no address): there is no draft page to show for it. */
    pagePreviewable,
    previewState,
    retry,
    notify,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
