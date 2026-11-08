// Issue #4270 (Wave 7) — Community › Brand groups, the staff inbox. Three
// columns: the group list (who waits on Mingla and for how long), the thread,
// and the rail (Plan, Host, Media, People). Anything linked opens in a side
// panel beside the chat; nothing here navigates away (Seth, 2026-11-07). The
// panel stacks with Back and a trail; Close clears it. While it is open the
// list folds to a strip of avatars. Every column scrolls on its own.
//
// This file is the controller: loads, realtime, read marks, sending (with
// Try again), mute, files, the Product signal modal, the side panel's stack,
// Esc and focus. The columns are their own components.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { ProductSignalModal } from "./SupportWorkflowModals";
import {
  addBrandGroupReaction,
  listBrandGroupInbox,
  listBrandGroupPeople,
  listBrandGroupReactions,
  listBrandGroupReadState,
  listOfficialBrandGroups,
  listOfficialBrandGroupMessages,
  markOfficialBrandGroupRead,
  openOfficialBrandGroupFile,
  prepareOfficialBrandGroupFiles,
  finalizeOfficialBrandGroupFile,
  removeBrandGroupReaction,
  sendOfficialBrandGroupMessage,
  setOfficialBrandGroupMuted,
  uploadOfficialBrandGroupFile,
} from "../../services/communityService";
import { listProductSignals } from "../../services/supportProductWorkflowService";
import { useHashQuery } from "../../hooks/useHashQuery";
import { usePanelStack } from "../../hooks/usePanelStack";
import { useBrandGroupLive } from "../../hooks/useBrandGroupLive";
import { useBrandGroupPlanItems } from "../../hooks/useBrandGroupPlanItems";
import { useBrandHostFallback } from "../../hooks/useBrandHostFallback";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { useOnline } from "../../hooks/useCrmPipeline";
import { canOpenPage } from "../../lib/access";
import { BRAND_GROUP_SIDE_KINDS, brandGroupSearch, brandGroupView, withSide } from "../../lib/panelStack";
import { createPanelHistory } from "../../lib/brandGroupPanelHistory";
import { BRAND_ROLE_WORDS, todayIso } from "../../lib/opsModel";
import { isPlanLine } from "../../lib/brandPlan";
import {
  applyInboxFilter,
  defaultInboxFilter,
  INBOX_ERROR_WORDS,
  createAnswerGate,
  PEOPLE_ERROR_WORDS,
  focusRefreshDue,
  foldThread,
  hostCardFacts,
  inboxSummary,
  inboxSummaryWords,
  mergeInbox,
  openGroupStep,
  personName,
  staffName,
  planPrefillFromMessages,
  quickReplies,
  seenByWords,
  sendFailureWords,
  sendLanded,
  typingWords,
} from "../../lib/brandGroupInbox";
import { BrandGroupList, useMinuteClock } from "./BrandGroupList";
import { BrandGroupStrip } from "./BrandGroupStrip";
import { BrandGroupHeader, assignHostToMe } from "./BrandGroupHeader";
import { BrandGroupThread } from "./BrandGroupThread";
import { BrandGroupComposer } from "./BrandGroupComposer";
import { BrandGroupRail } from "./BrandGroupRail";
import { BrandGroupSidePanel } from "./BrandGroupSidePanel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const LIGHT_REFRESH_MS = 1_500;
const FULL_REFRESH_MS = 5 * 60_000;
// Side kinds that need Hosts and Creators; a brand needs Brands.
const HOSTS_KINDS = new Set(["card", "host", "creator", "content", "event", "expected", "drafts", "calendar"]);

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : String(name || "?").slice(0, 2)).toUpperCase();
}

/** The host avatar in a Brand group's header: opens that brand's host card. */
export function HostAvatarButton({ host, photoUrl, open, onOpen }) {
  if (!host || host.status === "none") return null;
  if (host.status === "loading") return <span data-host-avatar="loading" aria-hidden="true" className="inline-block h-9 w-9 animate-pulse rounded-full bg-[var(--gray-100)]" />;
  if (host.status === "error") {
    // N-3: the card could not be read; that is not the same as there being none.
    if (typeof host.retry !== "function") return <span data-host-avatar="error" className="text-[12px] font-semibold text-[var(--color-error-700)]">The host card can’t be shown right now</span>;
    return <button type="button" data-host-avatar="error" onClick={host.retry} className={`min-h-11 rounded-lg px-2 text-[12px] font-semibold text-[var(--color-error-700)] hover:bg-[var(--color-error-50)] ${FOCUS}`}>The host card can’t be shown right now · Try again</button>;
  }
  return (
    <button
      type="button"
      data-host-avatar={host.recordId}
      aria-label={`Open host card for ${host.name}`}
      aria-expanded={open}
      onClick={onOpen}
      className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] py-1 pl-1 pr-3 text-[12px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}
    >
      {photoUrl
        ? <img src={photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        : <span aria-hidden="true" className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-brand-100)] text-[11px] font-bold text-[var(--color-brand-700)]">{initials(host.name)}</span>}
      <span className="hidden min-w-0 truncate sm:inline">{host.name}</span>
    </button>
  );
}

/** Whether this teammate may open a side panel of this kind. */
export function sideAllowed(side, { canHosts, canBrands }) {
  if (!side) return false;
  if (side.kind === "brand") return !!canBrands;
  return HOSTS_KINDS.has(side.kind) && !!canHosts;
}

function useWideScreen(px) {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return wide;
}

export function BrandGroupsPanel({ onCounts }) {
  const { session, access } = useAuth();
  // #4270 W2: Hosts and Creators powers (host card, plan, Mine) show only to staff who can open Hosts.
  const canHosts = canOpenPage(access, "hosts");
  const canBrands = canOpenPage(access, "brands");
  const [search, setSearch] = useHashQuery("community");
  const view = useMemo(() => brandGroupView(search), [search]);
  const stack = usePanelStack(search, setSearch, { kinds: BRAND_GROUP_SIDE_KINDS });
  const { addToast } = useToast();
  const online = useOnline();
  const directory = usePeopleDirectory();
  const myUserId = session?.user?.id ?? null;
  const myEmail = String(directory.me || access?.email || "").toLowerCase();
  const myName = directory.people.find((p) => p.me)?.name || "";
  const myFirstName = myName.split(/\s+/)[0] || "";
  const nowMs = useMinuteClock();
  const xl = useWideScreen(1280);
  const lg = useWideScreen(1024);
  const mounted = useRef(true);
  const [groups, setGroups] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [signalSource, setSignalSource] = useState(null);
  const [signals, setSignals] = useState([]);
  const fileInputRef = useRef(null);
  const [uploads, setUploads] = useState([]);
  const [filePreview, setFilePreview] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [people, setPeople] = useState({ conversationId: "", rows: [], error: "" });
  const [peopleTick, setPeopleTick] = useState(0);
  // D-6: "loading" until the first inbox read answers, "ready" once one has,
  // "error" while none ever has (the read is missing or keeps failing).
  const [inboxStatus, setInboxStatus] = useState("loading");
  const [pending, setPending] = useState({});
  const [planPrefill, setPlanPrefill] = useState(null);
  const [workPrefill, setWorkPrefill] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [narrowRail, setNarrowRail] = useState(false);
  const opener = useRef(null);
  const lightTimer = useRef(null);
  const inboxErrorShown = useRef(false);
  // D-13: when the last full inbox read started (focus refreshes are throttled).
  const lastFullRead = useRef(0);
  // D-5: the group on screen, and which thread reads may still show.
  const selectedRef = useRef(null);
  const threadGate = useRef(null);
  if (threadGate.current === null) threadGate.current = createAnswerGate();
  const loadingTicket = useRef(null);
  // D-2: the side panel's own history entries (lib/brandGroupPanelHistory.js).
  const panelHistory = useRef(null);
  if (panelHistory.current === null && typeof window !== "undefined") panelHistory.current = createPanelHistory(window);

  // X-1: set on mount too, so StrictMode's mount → unmount → mount in dev does
  // not leave it false (and the page stuck on "Loading Brand groups…").
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(lightTimer.current); };
  }, []);
  useEffect(() => () => {
    if (filePreview?.objectUrl) URL.revokeObjectURL(filePreview.objectUrl);
  }, [filePreview]);

  const loadGroups = useCallback(async () => {
    try {
      const rows = await listOfficialBrandGroups();
      if (!mounted.current) return;
      setGroups(rows);
      setSelectedId((current) => current && rows.some((row) => row.conversation_id === current)
        ? current
        : rows[0]?.conversation_id ?? null);
      setLoadedOnce(true);
      setError("");
    } catch (cause) {
      if (mounted.current) setError(cause?.message || "Couldn't load Brand groups");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // The inbox facts. Full (with plans) on open, on focus, every 5 minutes and
  // after a plan change; light (no plan reads) after each message.
  const loadInbox = useCallback(async ({ withPlan = true } = {}) => {
    if (withPlan) lastFullRead.current = Date.now();
    try {
      const rows = await listBrandGroupInbox({ withPlan });
      if (!mounted.current) return;
      setInboxStatus("ready");
      // A light refresh keeps the plan the last full read found.
      setInbox((prev) => {
        if (withPlan) return rows;
        const kept = new Map(prev.map((r) => [r.conversation_id, r.host?.plan ?? null]));
        return rows.map((r) => (r.host && r.host.plan == null && kept.get(r.conversation_id)
          ? { ...r, host: { ...r.host, plan: kept.get(r.conversation_id) } }
          : r));
      });
    } catch (cause) {
      // The list still works without the inbox facts; say why once a session
      // (a refresh on every focus must not repeat it). An earlier answer stays
      // on screen; with none, the host card falls back to its own lookup (D-6).
      if (!mounted.current) return;
      setInboxStatus((prev) => (prev === "ready" ? "ready" : "error"));
      console.warn("[BrandGroup] inbox not loaded:", cause?.message || cause);
      if (withPlan && !inboxErrorShown.current) {
        inboxErrorShown.current = true;
        addToast({ variant: "error", title: "Couldn't load who is waiting", description: INBOX_ERROR_WORDS });
      }
    }
  }, [addToast]);

  const lightRefresh = useCallback(() => {
    clearTimeout(lightTimer.current);
    lightTimer.current = setTimeout(() => {
      void loadGroups();
      void loadInbox({ withPlan: false });
    }, LIGHT_REFRESH_MS);
  }, [loadGroups, loadInbox]);

  const live = useBrandGroupLive({
    conversationId: selectedId,
    viewerId: myUserId,
    viewerName: myFirstName || "Mingla",
    messageIds: useMemo(() => messages.map((m) => m.id), [messages]),
    onError: (message) => addToast({ variant: "error", title: "Couldn't update the reaction or read state", description: message }),
    api: {
      listReactions: listBrandGroupReactions,
      addReaction: addBrandGroupReaction,
      removeReaction: removeBrandGroupReaction,
      listReadState: listBrandGroupReadState,
    },
  });
  const announceRead = live.announceRead;

  // D-5: an answer is shown (and the group marked read) only while its group
  // is still the open one and no newer read of it has started; an answer for
  // another group is still returned to the caller (Try again needs it).
  const loadThread = useCallback(async (conversationId, { quiet = false } = {}) => {
    if (!conversationId) return [];
    const gate = threadGate.current;
    const ticket = gate.begin(conversationId);
    const current = () => mounted.current && gate.applies(ticket);
    if (!quiet) { loadingTicket.current = ticket; setThreadLoading(true); }
    try {
      const [rows, productSignals] = await Promise.all([
        listOfficialBrandGroupMessages(conversationId),
        listProductSignals(),
      ]);
      if (!current()) return rows;
      setMessages(rows);
      setSignals(productSignals);
      await markOfficialBrandGroupRead(conversationId);
      if (gate.isOpen(conversationId)) announceRead();
      await loadGroups();
      return rows;
    } catch (cause) {
      if (current()) addToast({ variant: "error", title: "Couldn't load the Brand group", description: cause?.message });
      return null;
    } finally {
      if (mounted.current && loadingTicket.current === ticket) { loadingTicket.current = null; setThreadLoading(false); }
    }
  }, [addToast, loadGroups, announceRead]);

  useEffect(() => { void loadGroups(); void loadInbox(); }, [loadGroups, loadInbox]);
  useEffect(() => {
    // D-13: a focus reads again only when the last full read is a minute old.
    const onFocus = () => { if (focusRefreshDue(lastFullRead.current)) void loadInbox(); };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => { void loadInbox(); }, FULL_REFRESH_MS);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(timer); };
  }, [loadInbox]);

  useEffect(() => {
    selectedRef.current = selectedId;
    threadGate.current.open(selectedId);
    setReplyTo(null);
    setSelectedMessageIds([]);
    setComposer("");
    setMessages([]);
    setPlanPrefill(null);
    setWorkPrefill(null);
    if (selectedId) void loadThread(selectedId);
  }, [loadThread, selectedId]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-brand-groups")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (event) => {
        lightRefresh();
        if (selectedId && event.new?.conversation_id === selectedId) {
          void loadThread(selectedId, { quiet: true });
          // A plan line changes the plan: the next full read shows it.
          if (isPlanLine(event.new)) void loadInbox();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_group_reads" }, () => {
        lightRefresh();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [lightRefresh, loadThread, loadInbox, selectedId]);

  // The People tab and the "info (Owner)" words.
  useEffect(() => {
    if (!selectedId) return undefined;
    let live = true;
    setPeople({ conversationId: selectedId, rows: [], error: "" });
    listBrandGroupPeople(selectedId).then(
      (rows) => { if (live) setPeople({ conversationId: selectedId, rows, error: "" }); },
      (cause) => {
        if (!live) return;
        // D-14: plain words on screen; the database's own words go to the console.
        console.warn("[BrandGroup] brand team not loaded:", cause?.message || cause);
        setPeople({ conversationId: selectedId, rows: [], error: PEOPLE_ERROR_WORDS });
      },
    );
    return () => { live = false; };
  }, [selectedId, peopleTick]);

  const rows = useMemo(() => mergeInbox(groups, inbox), [groups, inbox]);
  // Needs reply when anyone waits, else All (once, when the inbox first loads).
  useEffect(() => {
    if (filter === null && loadedOnce && inbox.length) setFilter(defaultInboxFilter(rows));
  }, [filter, loadedOnce, inbox.length, rows]);
  const activeFilter = filter || "all";
  const visibleRows = useMemo(() => applyInboxFilter(rows, activeFilter, query), [rows, activeFilter, query]);
  const summary = useMemo(() => inboxSummary(rows, nowMs), [rows, nowMs]);
  useEffect(() => { onCounts?.(summary.waiting); }, [onCounts, summary.waiting]);

  // #4270 W2: the address names the open thread (and, from a host card, the brand).
  useEffect(() => {
    if (!loadedOnce) return;
    if (view.group && groups.some((g) => g.conversation_id === view.group)) {
      setSelectedId(view.group);
    } else if (view.brand) {
      const match = groups.find((g) => g.brand_id === view.brand);
      // R-1: through the panel history, so a tagged entry keeps its tag.
      if (match) panelHistory.current.replace(() => setSearch(brandGroupSearch(search, { group: match.conversation_id, brand: null }), { replace: true }));
    }
  }, [loadedOnce, view.group, view.brand, groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedGroup = rows.find((group) => group.conversation_id === selectedId) ?? null;
  // D-6: the inbox says whether there is a host card; while it cannot (its
  // read is missing or failed), the pre-W7 lookup answers instead, so a brand
  // with a host card is never offered "Create host card".
  const needsHostFallback = canHosts && !!selectedGroup
    && hostCardFacts({ inboxStatus, group: selectedGroup, fallback: null }).needsFallback;
  const hostFallback = useBrandHostFallback(selectedGroup?.brand_id || "", needsHostFallback);
  const hostFacts = canHosts
    ? hostCardFacts({ inboxStatus, group: selectedGroup, fallback: hostFallback })
    : { status: "none", host: null };
  const host = hostFacts.status === "ready" ? hostFacts.host : null;
  // Owners are known only from the inbox; Assign to me waits for them (D-6).
  const ownersKnown = !!host && Array.isArray(host.owners);
  const isOwner = ownersKnown && host.owners.some((o) => String(o.email || "").toLowerCase() === myEmail);
  const canAssign = canHosts && ownersKnown && !isOwner && !!myEmail;

  // ── The side panel ─────────────────────────────────────────────────────
  // A side in the address that this teammate cannot open stays closed.
  const side = sideAllowed(view.side, { canHosts, canBrands }) ? view.side : null;
  const sideOpen = !!side && !!selectedGroup;
  // The panel closed (Close, the browser's Back, switching groups): forget its entries.
  useEffect(() => { if (!view.side) panelHistory.current?.reset(); }, [view.side]);

  // The side in the address right now, read by callbacks a drawer kept from an
  // earlier render (RecordDrawer's toast).
  const sideRef = useRef(view.side);
  sideRef.current = view.side;
  const rememberOpener = () => {
    if (!sideRef.current) opener.current = typeof document !== "undefined" ? document.activeElement : null;
  };
  // From outside the panel (rail, thread, header): replaces what the panel shows.
  const openFresh = useCallback((next) => {
    if (!sideAllowed(next, { canHosts, canBrands })) return;
    const history = panelHistory.current;
    if (view.side) {
      stack.setTrail([]);
      history.replace(() => setSearch(withSide(search, next, BRAND_GROUP_SIDE_KINDS), { replace: true }));
      return;
    }
    rememberOpener();
    history.begin();
    history.push(() => stack.openSide(next));
  }, [canHosts, canBrands, view.side, search, setSearch, stack]); // eslint-disable-line react-hooks/exhaustive-deps
  // From a link inside the panel: stacks, with Back.
  // A drawer's callback can outlive the panel (RecordDrawer's "Open the card"
  // toast after Close): then this opens the panel afresh, tagged, so its Close
  // walks back too.
  const openInside = useCallback((next) => {
    if (!sideAllowed(next, { canHosts, canBrands })) return;
    if (!sideRef.current) rememberOpener();
    panelHistory.current.follow(() => stack.openSide(next), { panelOpen: !!sideRef.current });
  }, [canHosts, canBrands, stack]); // eslint-disable-line react-hooks/exhaustive-deps
  // D-1: the opener every drawer in the panel gets, as (kind, id). `allows`
  // lets a link that this teammate could not open show as plain words
  // instead of a button that does nothing.
  const openSideInPanel = useMemo(() => {
    const open = (kind, id) => openInside({ kind, id });
    open.allows = (kind) => sideAllowed({ kind, id: "x" }, { canHosts, canBrands });
    return open;
  }, [openInside, canHosts, canBrands]);
  // The panel's Back and its breadcrumb rewrite the current entry: it keeps its place (D-2).
  const panelStack = useMemo(() => ({
    ...stack,
    back: () => panelHistory.current.replace(() => stack.back()),
    backTo: (index) => panelHistory.current.replace(() => stack.backTo(index)),
  }), [stack]);

  const restoreFocus = () => {
    const target = opener.current;
    opener.current = null;
    requestAnimationFrame(() => {
      if (target && document.contains(target) && typeof target.focus === "function") target.focus();
      else document.getElementById("brand-group-thread-title")?.focus?.();
    });
  };
  // #4270 W2 rework (P3-2) kept: closing never replaces history. What this page
  // pushed is walked back; a panel that arrived in the address gets a new entry.
  // D-2: the current entry's own tag says how far it is from where the panel
  // opened, even after the browser's Back or Forward, so Close lands exactly
  // there. An entry that is not the panel's (a pasted link, a reload) closes
  // with a new entry instead (W2 rework P3-2: never a replace).
  const closePanel = useCallback(() => {
    const history = panelHistory.current;
    const step = history.closeStep();
    history.reset();
    stack.setTrail([]);
    if (step.kind === "go") window.history.go(step.delta);
    else setSearch(brandGroupSearch(search, { side: null }));
    restoreFocus();
  }, [search, setSearch, stack]);

  // Esc: a field in the panel lets go first; then the panel closes. A dialog
  // on top (file preview, Product signal, a reason prompt) has its own Esc.
  useEffect(() => {
    if (!sideOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const panel = document.querySelector("[data-pane-side]");
      const active = document.activeElement;
      // D-12: a field (the composer, the search, a field in the panel) lets go
      // first; the next Esc closes the panel.
      if (active && (FIELD_TAGS.has(active.tagName) || active.isContentEditable)) {
        active.blur();
        if (panel && panel.contains(active)) (active.closest("[data-panel-focus]") || panel.querySelector("[data-panel-focus]"))?.focus?.();
        return;
      }
      e.preventDefault();
      closePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sideOpen, closePanel]);

  const openGroup = (conversationId) => {
    // D-8: below 1024px the thread shows for the address's group, so the
    // group selected by default still opens when tapped.
    if (openGroupStep(conversationId, { selectedId, viewGroup: view.group, sideOpen: !!view.side }) === "none") return;
    // Items in the panel belong to one brand: switching groups closes it.
    panelHistory.current?.reset();
    stack.setTrail([]);
    setNarrowRail(false);
    setSelectedId(conversationId);
    setSearch(brandGroupSearch(search, { group: conversationId, brand: null, side: null }));
  };
  const backToList = () => setSearch(brandGroupSearch(search, { group: null, brand: null, side: null }));
  // R-1: at 1280 px and wider the rail sits beside the open panel; a tab
  // rewrites the current entry through the panel history so its tag (and the
  // exact Close) survives.
  const setRailTab = (tab) => panelHistory.current.replace(() => setSearch(brandGroupSearch(search, { rail: tab }), { replace: true }));
  // D-11: a tab the teammate picks drops a used prefill, so the form does not
  // reopen with old words when the tab is shown again.
  const pickRailTab = (tab) => { setPlanPrefill(null); setWorkPrefill(null); setRailTab(tab); };
  const showRail = (tab) => {
    if (tab) setRailTab(tab);
    setNarrowRail(true);
    if (sideOpen && !xl) closePanel();
  };

  // ── The thread ──────────────────────────────────────────────────────────
  const refreshPlan = useCallback(() => { void loadInbox(); }, [loadInbox]);
  const planLines = useMemo(() => messages.filter(isPlanLine), [messages]);
  const planItems = useBrandGroupPlanItems(canHosts ? host?.record_id || "" : "", { brandName: selectedGroup?.brand_name || "", lines: planLines });
  const entries = useMemo(() => foldThread(messages, new Date(nowMs)), [messages, nowMs]);
  const roleByUser = useMemo(() => new Map(people.rows.map((p) => [p.user_id, BRAND_ROLE_WORDS[p.role] || "Team"])), [people.rows]);
  const roleWordsFor = (message) => (message.sender_role === "Mingla Support" ? "Mingla Support" : roleByUser.get(message.sender_id) || message.sender_role || "");
  const myNewest = useMemo(() => [...messages].reverse().find((m) => m.sender_id && m.sender_id === myUserId) || null, [messages, myUserId]);
  // D-4: a name that is an address falls back to the person's name on the People tab.
  // Staff are not on the People tab: a Mingla Support sender's name comes from staffName (an address reads as its name, "Seth").
  const nameByUser = useMemo(() => {
    const names = new Map(people.rows.map((p) => [p.user_id, p.display_name]));
    for (const m of messages) {
      if (m.sender_role === "Mingla Support" && m.sender_id && !names.has(m.sender_id)) names.set(m.sender_id, staffName(m.sender_display_name));
    }
    return names;
  }, [people.rows, messages]);
  const nameFor = useCallback((userId) => nameByUser.get(userId) || null, [nameByUser]);
  const seenText = myNewest ? seenByWords(live.reads, myNewest, nameFor) : "";
  const staffNames = useMemo(() => [...new Set(messages.filter((m) => m.sender_role === "Mingla Support" && m.sender_display_name).map((m) => staffName(m.sender_display_name)))], [messages]);
  const today = todayIso();
  const sunday = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7)); return d.toISOString().slice(0, 10); })();
  const chips = quickReplies({
    weekItems: planItems.items.filter((i) => i.on >= today && i.on <= sunday),
    nextEvent: planItems.items.find((i) => ["event", "experience", "trip"].includes(i.kind) && i.on >= today) || null,
    brandName: selectedGroup?.brand_name || "",
  });
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageIds.includes(message.id)),
    [messages, selectedMessageIds],
  );
  const groupPending = pending[selectedId] || [];
  const canPlan = canHosts && !!host;

  const setLocal = (conversationId, localId, patch) => setPending((current) => ({
    ...current,
    [conversationId]: (current[conversationId] || []).map((item) => item.localId === localId ? { ...item, ...patch } : item),
  }));
  const dropLocal = (conversationId, localId) => setPending((current) => ({
    ...current,
    [conversationId]: (current[conversationId] || []).filter((item) => item.localId !== localId),
  }));

  async function deliver(item) {
    try {
      await sendOfficialBrandGroupMessage({
        conversationId: item.conversationId,
        content: item.content,
        replyToId: item.replyToId,
        relatedMessageIds: item.related,
      });
      dropLocal(item.conversationId, item.localId);
      if (item.conversationId === selectedRef.current) await loadThread(item.conversationId, { quiet: true });
      lightRefresh();
    } catch (cause) {
      setLocal(item.conversationId, item.localId, { state: "failed", error: sendFailureWords(cause) });
    }
  }

  function send() {
    const content = composer.trim();
    if (!selectedId || !content) return;
    const item = {
      localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: selectedId,
      content,
      replyToId: replyTo?.id ?? null,
      related: selectedMessageIds.slice(),
      // D-7: what the thread held when this was sent; Try again looks for a new twin.
      knownIds: messages.map((m) => m.id),
      state: "sending",
      at: Date.now(),
      error: "",
    };
    setPending((current) => ({ ...current, [selectedId]: [...(current[selectedId] || []), item] }));
    setComposer("");
    setReplyTo(null);
    setSelectedMessageIds([]);
    live.stopTyping();
    void deliver(item);
  }

  // Try again: a send that looked lost may have landed. Read the thread first
  // and only send again when it is not there (no duplicate).
  async function retrySend(item) {
    setLocal(item.conversationId, item.localId, { state: "sending", error: "" });
    const rows = await loadThread(item.conversationId, { quiet: true });
    if (rows && sendLanded(rows, item, myUserId)) { dropLocal(item.conversationId, item.localId); return; }
    if (!rows) { setLocal(item.conversationId, item.localId, { state: "failed", error: sendFailureWords(null) }); return; }
    await deliver(item);
  }

  async function toggleMute() {
    if (!selectedGroup) return;
    try {
      const muted = await setOfficialBrandGroupMuted(selectedGroup.conversation_id, !selectedGroup.muted);
      setGroups((current) => current.map((group) => group.conversation_id === selectedGroup.conversation_id
        ? { ...group, muted }
        : group));
      addToast({ variant: "success", title: muted ? "Brand group muted" : "Brand group unmuted", description: muted ? "Unread badges stay active, but push alerts are off for this group." : "Push alerts are on for every message in this group." });
    } catch (cause) {
      addToast({ variant: "error", title: "Couldn't update notifications", description: cause?.message });
    }
  }

  async function assignToMe() {
    if (!host || !canAssign || assigning) return;
    setAssigning(true);
    try {
      await assignHostToMe(host, myEmail);
      addToast({ variant: "success", title: `You own ${host.name} now.` });
      await loadInbox();
    } catch (cause) {
      addToast({ variant: "error", title: "Couldn't assign it to you", description: cause?.message });
    } finally {
      if (mounted.current) setAssigning(false);
    }
  }

  function toggleSelected(id) {
    setSelectedMessageIds((current) => current.includes(id)
      ? current.filter((messageId) => messageId !== id)
      : [...current, id]);
  }

  function openSignal(message) {
    const evidence = [message, ...selectedMessages.filter((item) => item.id !== message.id)]
      .map((item) => `${personName(item.sender_display_name, nameFor(item.sender_id))}: ${item.content}`)
      .join("\n");
    setSignalSource({
      id: message.id,
      source_kind: "brand_group_message",
      subject: `${selectedGroup?.brand_name || "Brand group"}: ${message.content.slice(0, 120)}`,
      details: evidence,
      requester_user_id: message.sender_id,
      priority: "normal",
      next_update_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Add to plan / Make a work card from messages: the rail's form opens filled.
  function addToPlan(list) {
    const prefill = planPrefillFromMessages(list);
    setPlanPrefill({ key: `plan-${Date.now()}`, type: "post", ...prefill });
    setSelectedMessageIds([]);
    showRail("plan");
  }
  function makeWorkCard(list) {
    const prefill = planPrefillFromMessages(list);
    setWorkPrefill({ key: `work-${Date.now()}`, title: prefill.title });
    setSelectedMessageIds([]);
    showRail("host");
  }

  async function copyText(message) {
    try {
      await navigator.clipboard.writeText(String(message.content || ""));
      addToast({ variant: "success", title: "Copied" });
    } catch (cause) {
      addToast({ variant: "error", title: "Couldn't copy the text", description: cause?.message });
    }
  }

  const updateUpload = useCallback((fileId, patch) => {
    setUploads((current) => current.map((item) => item.prepared.fileId === fileId ? { ...item, ...patch } : item));
  }, []);

  const transferUpload = useCallback(async (item) => {
    const fileId = item.prepared.fileId;
    try {
      if (!item.uploaded) {
        updateUpload(fileId, { state: "uploading", error: "" });
        await uploadOfficialBrandGroupFile(item.prepared, (progress) => updateUpload(fileId, { progress }));
        updateUpload(fileId, { uploaded: true, progress: 1, state: "finalizing" });
      } else {
        updateUpload(fileId, { state: "finalizing", error: "" });
      }
      await finalizeOfficialBrandGroupFile(fileId);
      updateUpload(fileId, { uploaded: true, progress: 1, state: "complete" });
      if (selectedId) await loadThread(selectedId, { quiet: true });
    } catch (cause) {
      updateUpload(fileId, { state: "failed", error: cause?.message || "Couldn't share this file." });
    }
  }, [loadThread, selectedId, updateUpload]);

  async function chooseFiles(event) {
    const files = Array.from(event.target.files || []).slice(0, 10);
    event.target.value = "";
    if (!selectedId || files.length === 0) return;
    try {
      const prepared = await prepareOfficialBrandGroupFiles(selectedId, files);
      const next = prepared.map((file) => ({ prepared: file, progress: 0, state: "queued", uploaded: false, error: "" }));
      setUploads(next);
      for (const item of next) await transferUpload(item);
    } catch (cause) {
      addToast({ variant: "error", title: "Files not added", description: cause?.message });
    }
  }

  async function preview(message) {
    try {
      const objectUrl = await openOfficialBrandGroupFile(message.file_id);
      setFilePreview({ objectUrl, name: message.file_name, mime: message.file_mime });
    } catch (cause) {
      addToast({ variant: "error", title: "Couldn't open the file", description: cause?.message });
    }
  }

  if (error && !groups.length) return <SectionCard title="Brand groups"><div className="space-y-3 text-sm text-[var(--color-text-secondary)]"><p>{error}</p><Button variant="secondary" onClick={() => void loadGroups()}>Retry</Button></div></SectionCard>;

  // One pane at a time below 1024px: list -> thread -> rail, or the panel.
  const pane = sideOpen ? "side" : !view.group ? "list" : narrowRail ? "rail" : "thread";
  const retryHost = () => { if (hostFacts.needsFallback) void hostFallback.retry(); else void loadInbox(); };
  const hostButton = !canHosts ? null
    : host ? { status: "ready", recordId: host.record_id, name: host.name || "Host" }
      : hostFacts.status === "loading" ? { status: "loading" }
        : hostFacts.status === "unknown" ? { status: "error", retry: retryHost }
          : null;
  const summaryWords = inboxSummaryWords(summary);
  const railButton = !selectedGroup ? null
    : !lg ? { label: "Plan and host", onClick: () => showRail("") }
      : sideOpen && !xl ? { label: "Plan · Host", onClick: () => closePanel() }
        : null;
  const uploadsList = uploads.length ? (
    <div className="mb-2 space-y-2 rounded-xl border border-[var(--gray-200)] p-3">{uploads.map((item) => (
      <div key={item.prepared.fileId} className="flex items-center gap-3 text-xs">
        <div className="min-w-0 flex-1"><strong className="block truncate text-[var(--color-text-primary)]">{item.prepared.name}</strong><span className={item.state === "failed" ? "text-[var(--color-error-700)]" : "text-[var(--color-text-tertiary)]"}>{item.state === "uploading" ? `${Math.round(item.progress * 100)}% uploaded` : item.state === "finalizing" ? "Saving to Drive…" : item.state === "complete" ? "Shared" : item.error || "Waiting"}</span><div className="mt-1 h-1 overflow-hidden rounded bg-[var(--gray-200)]"><div className="h-full bg-[var(--color-brand-500)]" style={{ width: `${Math.round(item.progress * 100)}%` }} /></div></div>
        {item.state === "failed" ? <button type="button" className={`min-h-9 rounded px-2 font-semibold text-[var(--color-brand-700)] ${FOCUS}`} onClick={() => void transferUpload(item)}>Retry</button> : null}
      </div>
    ))}</div>
  ) : null;

  const column = (name) => `${pane === name ? "flex" : "hidden"} min-h-0 min-w-0 flex-col`;
  return (
    <div data-brand-groups="" data-pane={pane} data-side-open={sideOpen ? "true" : "false"} className="flex min-w-0 flex-col gap-3">
      {summaryWords && (
        <p data-inbox-summary="" role="status" className="self-start rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)]">{summaryWords}</p>
      )}
      <div
        data-brand-groups-workspace=""
        className={`grid h-[calc(100dvh-220px)] min-h-[560px] min-w-0 grid-cols-1 overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] ${sideOpen
          ? "lg:grid-cols-[72px_minmax(0,1fr)_400px] xl:grid-cols-[72px_minmax(0,1fr)_340px_400px]"
          : "lg:grid-cols-[260px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_340px]"}`}
      >
        {sideOpen ? (
          <div data-pane-strip="" className="hidden min-h-0 min-w-0 flex-col border-r border-[var(--gray-100)] lg:flex">
            <BrandGroupStrip groups={visibleRows.length ? visibleRows : rows} selectedId={selectedId} onShowList={closePanel} onOpen={openGroup} />
          </div>
        ) : (
          <div data-pane-list="" className={`${column("list")} border-r border-[var(--gray-100)] lg:flex`}>
            <BrandGroupList rows={visibleRows} all={rows} loading={loading} filter={activeFilter} onFilter={setFilter} query={query} onQuery={setQuery}
              canHosts={canHosts} selectedId={selectedId} myUserId={myUserId} onOpen={openGroup} waitingCount={summary.waiting} nowMs={nowMs} />
          </div>
        )}

        <div data-pane-thread="" className={`${column("thread")} lg:flex`}>
          <button type="button" onClick={backToList} className={`m-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] lg:hidden ${FOCUS}`}>
            <span aria-hidden="true">‹</span> Back to Brand groups
          </button>
          {!selectedGroup ? (
            <div className="flex min-h-64 flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-secondary)]">{loading ? "Loading Brand groups…" : "Select a Brand group to read and reply."}</div>
          ) : (
            <>
              <BrandGroupHeader
                group={selectedGroup}
                host={host}
                canHosts={canHosts}
                people={people.conversationId === selectedId ? people.rows : []}
                online={online}
                hostCard={<HostAvatarButton host={hostButton} photoUrl={selectedGroup.brand_photo_url} open={side?.kind === "host"} onOpen={() => hostButton?.recordId && openFresh({ kind: "host", id: hostButton.recordId })} />}
                canAssign={canAssign}
                assigning={assigning}
                onAssign={() => void assignToMe()}
                onToggleMute={() => void toggleMute()}
                onRailButton={railButton?.onClick}
                railButtonLabel={railButton?.label}
              />
              <BrandGroupThread
                group={selectedGroup}
                entries={entries}
                pending={groupPending}
                loading={threadLoading}
                myUserId={myUserId}
                roleWordsFor={roleWordsFor}
                reactions={live.reactionsByMessage}
                seenBy={myNewest && seenText ? { messageId: myNewest.id, text: seenText } : null}
                nameFor={nameFor}
                typing={typingWords(live.typingNames)}
                planItems={planItems.items}
                onOpenSide={canHosts ? openFresh : null}
                canPlan={canPlan}
                selectedIds={selectedMessageIds}
                onReact={live.toggleReaction}
                onReply={(message) => { setReplyTo(message); document.getElementById("brand-group-composer")?.focus(); }}
                onAddToPlan={(message) => addToPlan([message, ...selectedMessages.filter((m) => m.id !== message.id)])}
                onToggleSelect={toggleSelected}
                onSignal={openSignal}
                onCopy={(message) => void copyText(message)}
                onPreview={(message) => void preview(message)}
                onRetrySend={(item) => void retrySend(item)}
                onDeleteSend={(item) => dropLocal(item.conversationId, item.localId)}
              />
              <input ref={fileInputRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" accept="image/*,video/*,audio/*,.pdf,.docx,.xlsx,.txt,.csv" onChange={(event) => void chooseFiles(event)} />
              <BrandGroupComposer
                brandName={selectedGroup.brand_name}
                value={composer}
                onChange={setComposer}
                onSend={send}
                sending={false}
                chips={chips}
                onChip={(chip) => { setComposer(chip.text); document.getElementById("brand-group-composer")?.focus(); }}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(null)}
                selectedCount={selectedMessages.length}
                canPlanActions={canPlan}
                onSelectSignal={() => selectedMessages[0] && openSignal(selectedMessages[0])}
                onSelectPlan={() => addToPlan(selectedMessages)}
                onSelectWork={() => makeWorkCard(selectedMessages)}
                onSelectCancel={() => setSelectedMessageIds([])}
                onAddFiles={() => fileInputRef.current?.click()}
                filesBusy={uploads.some((item) => ["queued", "uploading", "finalizing"].includes(item.state))}
                uploads={uploadsList}
                replyingAs={myName || "you"}
                onTyping={live.notifyTyping}
                onStopTyping={live.stopTyping}
              />
            </>
          )}
        </div>

        <div data-pane-rail="" className={`${column("rail")} border-l border-[var(--gray-100)] ${sideOpen ? "xl:flex" : "lg:flex"}`}>
          <button type="button" onClick={() => setNarrowRail(false)} className={`m-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] lg:hidden ${FOCUS}`}>
            <span aria-hidden="true">‹</span> Back to the chat
          </button>
          {selectedGroup && (
            <BrandGroupRail
              group={selectedGroup}
              tab={view.rail}
              onTab={pickRailTab}
              canHosts={canHosts}
              canBrands={canBrands}
              host={host}
              hostStatus={hostFacts.status}
              onRetryHost={retryHost}
              online={online}
              openFresh={openFresh}
              planPrefill={planPrefill}
              workPrefill={workPrefill}
              canAssign={canAssign}
              assigning={assigning}
              onAssign={() => void assignToMe()}
              onChanged={() => { refreshPlan(); void planItems.reload(); }}
              onLinked={async () => { await loadInbox(); }}
              onPreview={preview}
              people={people.conversationId === selectedId ? people.rows : []}
              peopleError={people.conversationId === selectedId ? people.error : ""}
              onRetryPeople={() => setPeopleTick((n) => n + 1)}
              staff={staffNames}
            />
          )}
        </div>

        {sideOpen && (
          <div data-pane-side="" className={`${column("side")} border-l border-[var(--gray-100)] lg:flex`}>
            <BrandGroupSidePanel
              stack={panelStack}
              side={side}
              brandName={selectedGroup.brand_name}
              onClose={closePanel}
              onChanged={() => { refreshPlan(); void planItems.reload(); }}
              onOpenInside={openInside}
              onOpenSide={openSideInPanel}
              onBackToChat={closePanel}
            />
          </div>
        )}
      </div>

      <ProductSignalModal
        source={signalSource}
        signals={signals}
        onClose={() => setSignalSource(null)}
        onCreated={async () => {
          setSignals(await listProductSignals());
          setSelectedMessageIds([]);
          addToast({ variant: "success", title: "Private Product signal created" });
        }}
        onLinked={async () => {
          setSignals(await listProductSignals());
          setSelectedMessageIds([]);
          addToast({ variant: "success", title: "Brand group report linked" });
        }}
        onError={(cause) => addToast({ variant: "error", title: "Couldn't save the Product signal", description: cause?.message })}
      />
      {filePreview ? (
        <div role="dialog" aria-modal="true" aria-label={`Preview ${filePreview.name}`} className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4"
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setFilePreview(null); } }}>
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-t-xl bg-[var(--color-background-primary)] px-4 py-3"><div className="min-w-0"><strong className="block truncate text-[var(--color-text-primary)]">{filePreview.name}</strong><span className="text-xs text-[var(--color-text-tertiary)]">Secure Brand-group preview</span></div><Button variant="secondary" autoFocus onClick={() => setFilePreview(null)}>Close</Button></div>
          <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center overflow-hidden rounded-b-xl bg-black">
            {filePreview.mime?.startsWith("image/") ? <img src={filePreview.objectUrl} alt={filePreview.name} className="max-h-full max-w-full object-contain" /> : null}
            {filePreview.mime?.startsWith("video/") || filePreview.mime?.startsWith("audio/") ? <video src={filePreview.objectUrl} controls autoPlay={false} className="max-h-full max-w-full" /> : null}
            {filePreview.mime === "application/pdf" ? <iframe title={filePreview.name} src={filePreview.objectUrl} className="h-full w-full bg-white" /> : null}
            {!filePreview.mime?.startsWith("image/") && !filePreview.mime?.startsWith("video/") && !filePreview.mime?.startsWith("audio/") && filePreview.mime !== "application/pdf" ? <div className="max-w-md p-8 text-center text-white"><p className="font-semibold">{filePreview.name}</p><p className="mt-2 text-sm text-white/70">This file is stored securely. Browser preview is available for images, video, audio, and PDFs.</p></div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default BrandGroupsPanel;
