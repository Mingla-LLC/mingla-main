import { CalendarInput } from "@mingla/calendar-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { communicationsErrorMessage } from "../../lib/communicationsErrors";
import {
  CalendarClock,
  ChevronDown,
  FilePlus,
  FileText,
  Monitor,
  Save,
  Send,
  Smartphone,
  Users,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import minglaEmailWordmark from "../../../../packages/brand-assets/mingla-wordmark-email.png";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../ui/Badge";
import { isFullAdmin } from "../../lib/access";
import { formatRelativeTime } from "../../lib/formatters";
import { EmailBlogPostPicker } from "./EmailBlogPostPicker";
import { ADMIN_EMAIL_FROM_LABEL, ADMIN_EMAIL_REPLY_TO, ADMIN_EMAIL_SENDER } from "../../lib/adminEmailSender";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { BlogPostSnapshot } from "./BlogPostSnapshot";
import { escapeHtml, sanitizeLocalRichText } from "./richText";
import {
  APP_STATUS_OPTIONS,
  AUDIENCE_PRESETS,
  SOURCE_OPTIONS,
  groupBreakdown,
  EMPTY_FILTERS,
  audienceFor,
  audienceSummary,
  choosePreset,
  exclusionReasons,
  isPeopleMode,
  isRecipientChosen,
  leadTargetFromHash,
  leadsSendError,
  presetIsActive,
} from "../../lib/emailAudience";
import { getLead } from "../../services/leadsService";
import { PeopleAudiencePicker } from "./PeopleAudiencePicker";
import { ACTIVATION_PLAYS, peopleFilterFromHash, recipientFromHash, startingPoint } from "../../lib/peopleFilter";
import {
  DRAFT_STATUS_LABELS,
  canEditDraft,
  clearRecoveryCopy,
  composerStateFromDraft,
  draftAuthorLabel,
  draftErrorMessage,
  draftFingerprint,
  draftPayload,
  hasDraftContent,
  isDraftConflict,
  legacyDraftPayload,
  legacyDraftToMigrate,
  markLegacyDraftMigrated,
  readRecoveryCopy,
  writeRecoveryCopy,
} from "../../lib/emailDrafts";
import {
  deleteEmailDraft,
  getEmailDraft,
  listEmailDrafts,
  saveEmailDraft,
} from "../../services/emailDraftsService";
import {
  appendEmailBlogPost,
  emailBlogPostValidationError,
  refreshEmailBlogPostSnapshots,
  swapEmailBlogPost,
} from "../../lib/emailBlogPostBlocks";

const TOKENS = [
  { value: "{first_name}", label: "First name", example: "Maya" },
  { value: "{display_name}", label: "Display name", example: "Maya Okafor" },
  { value: "{username}", label: "Username", example: "mayaexplores" },
  { value: "{country}", label: "Country", example: "Nigeria" },
  { value: "{language}", label: "Language", example: "English" },
  { value: "{joined_date}", label: "Joined date", example: "15 Jan 2026" },
];

const SAMPLE_VALUES = Object.fromEntries(TOKENS.map((token) => [token.value, token.example]));
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// #4255: a saved draft autosaves this long after the last change.
const AUTOSAVE_MS = 2500;

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function blockId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function defaultDocument() {
  return [{
    id: blockId(),
    type: "rich_text",
    html: "<p>Hi {first_name},</p><p>Write your update here.</p>",
  }];
}

function replacePreviewTokens(value) {
  return Object.entries(SAMPLE_VALUES).reduce((current, [token, replacement]) => (
    current.split(token).join(replacement)
  ), value || "").split("{name}").join("Maya");
}

function plainTextFromDocument(documentValue) {
  return documentValue.map((block) => {
    if (block.type === "divider") return "────────";
    if (block.type === "image") return block.alt;
    if (block.type === "blog_post") return block.snapshot?.title || "Blog post";
    const node = document.createElement("div");
    node.innerHTML = block.html;
    return node.textContent || "";
  }).filter(Boolean).join("\n\n");
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full appearance-none rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 pr-8 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-[var(--color-text-tertiary)]" />
      </span>
    </label>
  );
}

function LocalEmailPreview({ subject, documentValue }) {
  return (
    <div className="min-h-full bg-[#f4f1ed] px-3 py-5 sm:px-5">
      <div className="mx-auto max-w-[600px] overflow-hidden rounded-2xl border border-[#e7dfd6] bg-white shadow-sm">
        <div className="flex items-center justify-center border-b border-[#efe9e2] bg-white px-6 py-6">
          <img
            src={minglaEmailWordmark}
            alt="Mingla"
            className="h-8 w-[90px] object-contain"
          />
        </div>
        <div className="px-6 py-7 text-[#2d2926]">
          <h1 className="mb-5 text-[22px] font-bold leading-tight">{replacePreviewTokens(subject) || "Your Mingla update"}</h1>
          {documentValue.map((block) => {
            if (block.type === "divider") {
              return <hr key={block.id} className="my-6 border-0 border-t border-[#e6e0d9]" />;
            }
            if (block.type === "image") {
              const image = <img src={block.url} alt={block.alt || "Image description required"} className="my-5 h-auto w-full rounded-xl" />;
              let safeLink = "";
              try {
                const parsed = new URL(block.link || "");
                if (parsed.protocol === "https:") safeLink = parsed.toString();
              } catch {
                safeLink = "";
              }
              return safeLink ? <a key={block.id} href={safeLink}>{image}</a> : <div key={block.id}>{image}</div>;
            }
            if (block.type === "blog_post") return <BlogPostSnapshot key={block.id} block={block} preview />;
            return (
              <div
                key={block.id}
                className="email-local-preview text-[15px] leading-7 [&_a]:text-[#c4471a] [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-4 [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: sanitizeLocalRichText(replacePreviewTokens(block.html)) }}
              />
            );
          })}
        </div>
        <div className="border-t border-[#efe9e2] px-6 py-5 text-xs leading-5 text-[#756e68]">
          <p>You’re receiving this email from Mingla.</p>
          <p><a className="underline" href="#unsubscribe">Unsubscribe</a> · Mingla, {ADMIN_EMAIL_SENDER.address}</p>
        </div>
      </div>
    </div>
  );
}

// #4383: `editingCampaign` ({ id, subject, document, scheduled_for, timezone })
// opens a scheduled email to change its words only. Who gets it and when are
// not editable here (the Email screen's Scheduled list changes the time; a
// new audience means cancel and write a new email). Save sends the same
// document checks as a new campaign, through update_scheduled_campaign.
// #4419: `initialDraft` (a draft-shaped { subject, document, audience }) opens a
// new email prefilled from a sent one ("Duplicate as new"). Its audience is
// read through composerStateFromDraft like any draft. Nothing else changes.
export function EmailComposer({ callEdgeFunction, providerConfigured, onSessionExpired, openTemplateManager = false, editingCampaign = null, onEditingDone = null, initialDraft = null }) {
  const { addToast } = useToast();
  const { access, session } = useAuth();
  const myUserId = session?.user?.id || null;
  const myEmail = access?.email || session?.user?.email || "";
  const isAdmin = isFullAdmin(access);
  // #4255 — the shared draft open in the composer (null: not saved yet).
  const [draft, setDraft] = useState(null);
  const [savedFingerprint, setSavedFingerprint] = useState(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState(null);
  const [draftConflict, setDraftConflict] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [pendingDraftDeleteId, setPendingDraftDeleteId] = useState("");
  const [discardPrompt, setDiscardPrompt] = useState(null);
  const draftSavingRef = useRef(false);
  // #4452 A1.5: #/email?leads=<selection> or ?lead=<lead> opens a leads audience.
  const [leadTarget, setLeadTarget] = useState(() => (editingCampaign || initialDraft ? null : leadTargetFromHash(typeof window !== "undefined" ? window.location.hash : "")));
  const [leadError, setLeadError] = useState(null);
  // #4226 Phase 2: #/email?people=<filter> (People's "Email these people")
  // opens the builder with that filter; #/email?recipient=<email> ("Email this
  // person") opens One person with the search filled in.
  const [handOff] = useState(() => {
    if (editingCampaign || initialDraft || typeof window === "undefined") return { people: null, recipient: null };
    return { people: peopleFilterFromHash(window.location.hash), recipient: recipientFromHash(window.location.hash) };
  });
  const [audienceMode, setAudienceMode] = useState(() => leadTarget?.mode || (handOff.people ? "people" : handOff.recipient ? "person" : "segment"));
  const [peopleFilter, setPeopleFilter] = useState(() => handOff.people || {});
  const [playId, setPlayId] = useState(null);
  const [recipientQuery, setRecipientQuery] = useState(() => handOff.recipient || "");
  const [recipientMatches, setRecipientMatches] = useState([]);
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [recipientSearching, setRecipientSearching] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [metadata, setMetadata] = useState({ countries: [], languages: [], cities: [], brands: [] });
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [subject, setSubject] = useState(() => editingCampaign?.subject ?? "");
  const [documentValue, setDocumentValue] = useState(() => (Array.isArray(editingCampaign?.document) && editingCampaign.document.length ? editingCampaign.document : defaultDocument()));
  const [savingEdits, setSavingEdits] = useState(false);
  const [previewMode, setPreviewMode] = useState("desktop");
  const [serverPreview, setServerPreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [scheduleMode, setScheduleMode] = useState("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [pendingTemplateDeleteId, setPendingTemplateDeleteId] = useState("");
  const [blogPickerBlockId, setBlogPickerBlockId] = useState(null);
  const [unavailableBlogPostIds, setUnavailableBlogPostIds] = useState(() => new Set());
  const subjectRef = useRef(null);
  const bodyEditorRef = useRef(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const audience = useMemo(
    () => audienceFor(audienceMode, selectedRecipient, filters, leadTarget, peopleFilter),
    [audienceMode, selectedRecipient, filters, leadTarget, peopleFilter],
  );
  const blogPostIdsKey = useMemo(() => [...new Set(documentValue.filter((block) => block.type === "blog_post").map((block) => block.postId))].sort().join(","), [documentValue]);

  // #4452: a reply's chip names the lead (read through the Leads gate).
  const replyLeadId = leadTarget?.mode === "lead_reply" ? leadTarget.leadId : null;
  useEffect(() => {
    if (!replyLeadId) return undefined;
    let cancelled = false;
    getLead(replyLeadId)
      .then((data) => { if (!cancelled) setLeadTarget((t) => (t && t.leadId === replyLeadId ? { ...t, name: data?.lead?.name || data?.lead?.email || "" } : t)); })
      .catch(() => { if (!cancelled) setLeadError({ key: "lead_not_found", message: "This lead could not be read. Go back to Leads and try again." }); });
    return () => { cancelled = true; };
  }, [replyLeadId]);

  /** Change audience: a leads audience clears back to Hosts. */
  const clearLeadAudience = useCallback(() => {
    setLeadTarget(null);
    setLeadError(null);
    const hosts = AUDIENCE_PRESETS.find((p) => p.id === "hosts");
    const next = choosePreset(hosts, EMPTY_FILTERS);
    setAudienceMode(next.audienceMode);
    setFilters(next.filters);
  }, []);

  useEffect(() => {
    if (!openTemplateManager) return undefined;
    const timer = setTimeout(() => setTemplateManagerOpen(true), 0);
    return () => clearTimeout(timer);
  }, [openTemplateManager]);

  // #4226 Phase 2: a play or a built group sets the People filter.
  const choosePeopleFilter = useCallback((next, nextPlayId) => {
    setPeopleFilter(next || {});
    setPlayId(nextPlayId || null);
  }, []);
  const editPlayFilters = useCallback((next) => {
    setPeopleFilter(next || {});
    setPlayId(null);
    setAudienceMode("people");
  }, []);
  // The group's own name and message. What this button filled in for the
  // previous group is replaced; what the person typed is kept.
  const autoStarter = useRef({ subject: "", body: "" });
  const applyPlayMessage = useCallback((play) => {
    const plainText = (block) => String(block.html || "").replace(/<[^>]*>/g, "").trim();
    // "" = nothing written yet; the one text block's text; or a marker for
    // anything richer (images, buttons, several blocks), which is never replaced.
    const onlyText = documentValue.every((block) => block.type === "rich_text");
    const bodyText = !onlyText ? "[custom body]" : documentValue.map(plainText).join("");
    const next = startingPoint(play, {
      subject,
      bodyText,
      lastAutoSubject: autoStarter.current.subject,
      lastAutoBody: autoStarter.current.body,
    });
    if (next.subject !== null) {
      setSubject(next.subject);
      autoStarter.current.subject = next.subject;
    }
    if (next.message !== null) {
      setDocumentValue([{ id: blockId(), type: "rich_text", html: `<p>${escapeHtml(next.message)}</p>` }]);
      autoStarter.current.body = next.message;
    }
  }, [documentValue, subject]);

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const currentPayload = useMemo(() => draftPayload({
    subject,
    documentValue,
    audienceMode,
    filters,
    selectedRecipient,
    status: draft?.status || "draft",
  }), [audienceMode, documentValue, draft?.status, filters, selectedRecipient, subject]);
  const currentFingerprint = useMemo(() => draftFingerprint(currentPayload), [currentPayload]);
  const draftDirty = savedFingerprint !== currentFingerprint &&
    (draft !== null || hasDraftContent({ subject, document: documentValue }));
  const draftEditable = canEditDraft(draft, { userId: myUserId, isAdmin }) === true;

  const applyComposerState = useCallback((state) => {
    setAudienceMode(state.audienceMode);
    setFilters(state.filters);
    setSelectedRecipient(state.audienceMode === "person" ? state.selectedRecipient : null);
    setRecipientQuery("");
    setSubject(state.subject || "");
    setDocumentValue(state.document?.length ? state.document : defaultDocument());
  }, []);

  // Open a stored draft in the composer. Its fingerprint is what "saved" means.
  const openDraft = useCallback((row) => {
    const state = composerStateFromDraft(row, EMPTY_FILTERS);
    applyComposerState(state);
    setDraft(row);
    setDraftConflict(false);
    setDraftError(null);
    setSavedFingerprint(draftFingerprint(draftPayload({
      subject: state.subject,
      documentValue: state.document?.length ? state.document : defaultDocument(),
      audienceMode: state.audienceMode,
      filters: state.filters,
      selectedRecipient: state.selectedRecipient,
      status: row.status,
    })));
  }, [applyComposerState]);

  const refreshDrafts = useCallback(async () => {
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      setDrafts(await listEmailDrafts());
    } catch (error) {
      setDraftsError(error.message || "Drafts could not be loaded.");
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  // First load: move this browser's old local draft to the server once, else
  // restore an unsaved crash-recovery copy, then load the team's drafts.
  useEffect(() => {
    let cancelled = false;
    const storage = browserStorage();
    async function start() {
      // #4383: editing a scheduled email never pulls in a draft or a recovery copy.
      // #4419: "Duplicate as new" opens with the sent email's words. Its
      // audience goes through the same host-default guard as every draft.
      if (initialDraft && !editingCampaign) {
        applyComposerState(composerStateFromDraft(initialDraft, EMPTY_FILTERS));
        if (!cancelled) await refreshDrafts();
        return;
      }
      if (editingCampaign) return;
      const legacy = legacyDraftToMigrate(storage);
      if (legacy) {
        try {
          const row = await saveEmailDraft({ id: null, ...legacyDraftPayload(legacy) });
          if (cancelled) return;
          markLegacyDraftMigrated(storage);
          openDraft(row);
          addToast({ variant: "success", title: "Your saved draft is now shared", description: "Find it under Drafts. Your team can read it too." });
        } catch (error) {
          if (cancelled) return;
          // Nothing is lost: the local copy stays and opens as before.
          applyComposerState(composerStateFromDraft(legacy, EMPTY_FILTERS));
          addToast({ variant: "error", title: "Your saved draft couldn't be shared yet", description: draftErrorMessage(error) });
        }
      } else {
        const recovery = readRecoveryCopy(storage);
        if (recovery) {
          applyComposerState(composerStateFromDraft(recovery, EMPTY_FILTERS));
          if (recovery.draftId) {
            try {
              const row = await getEmailDraft(recovery.draftId);
              if (cancelled) return;
              if (row) {
                setDraft(row);
                if (row.revision !== recovery.revision) setDraftConflict(true);
              }
            } catch {
              // The list load below shows the error if the server is unreachable.
            }
          }
        }
      }
      if (!cancelled) await refreshDrafts();
    }
    void start();
    return () => { cancelled = true; };
    // Runs once per composer mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Crash recovery: only an unsaved change is kept in this browser.
  useEffect(() => {
    // #4383: a scheduled email being edited is not a draft; keep no copy.
    if (editingCampaign) return undefined;
    const storage = browserStorage();
    const timer = setTimeout(() => {
      if (!draftDirty) {
        clearRecoveryCopy(storage);
        return;
      }
      writeRecoveryCopy(storage, {
        draftId: draft?.id,
        revision: draft?.revision,
        subject,
        documentValue,
        audienceMode,
        filters,
        selectedRecipient,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [audienceMode, documentValue, draft?.id, draft?.revision, draftDirty, editingCampaign, filters, selectedRecipient, subject]);

  const saveDraft = useCallback(async ({ status, asCopy = false, quiet = false } = {}) => {
    if (draftSavingRef.current) return null;
    const nextStatus = status || draft?.status || "draft";
    const payload = { ...currentPayload, status: nextStatus };
    const creating = asCopy || !draft || !draftEditable;
    draftSavingRef.current = true;
    setDraftSaving(true);
    setDraftError(null);
    try {
      const row = await saveEmailDraft({
        id: creating ? null : draft.id,
        revision: creating ? null : draft.revision,
        ...payload,
      });
      setDraft(row);
      setDraftConflict(false);
      setSavedFingerprint(draftFingerprint(payload));
      clearRecoveryCopy(browserStorage());
      setDrafts((current) => [row, ...current.filter((item) => item.id !== row.id)]);
      if (!quiet) {
        addToast({
          variant: "success",
          title: nextStatus === "ready_for_review" ? "Marked ready for review" : creating && draft ? "Saved as your copy" : "Draft saved",
        });
      }
      return row;
    } catch (error) {
      if (isDraftConflict(error)) setDraftConflict(true);
      setDraftError(draftErrorMessage(error));
      if (!quiet) addToast({ variant: "error", title: "Draft not saved", description: draftErrorMessage(error) });
      return null;
    } finally {
      draftSavingRef.current = false;
      setDraftSaving(false);
    }
  }, [addToast, currentPayload, draft, draftEditable]);

  // Autosave a draft that is already shared, a moment after the last change.
  useEffect(() => {
    if (!draft || !draftEditable || !draftDirty || draftConflict || sending) return undefined;
    const timer = setTimeout(() => { void saveDraft({ quiet: true }); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, draftConflict, draftDirty, draftEditable, saveDraft, sending]);

  function startNewEmail() {
    setDraft(null);
    setSavedFingerprint(null);
    setDraftConflict(false);
    setDraftError(null);
    setSubject("");
    setDocumentValue(defaultDocument());
    setAudienceMode("segment");
    setLeadTarget(null);
    setFilters(EMPTY_FILTERS);
    setPeopleFilter({});
    setPlayId(null);
    setSelectedRecipient(null);
    setRecipientQuery("");
    setScheduleMode("now");
    setScheduledLocal("");
    clearRecoveryCopy(browserStorage());
  }

  // Leaving unsaved work: save it when we may, otherwise ask first.
  async function leaveCurrentEmail(next) {
    if (!draftDirty) {
      next();
      return;
    }
    if (draft && draftEditable && !draftConflict) {
      const saved = await saveDraft({ quiet: true });
      if (saved) {
        next();
        return;
      }
    }
    setDiscardPrompt(() => next);
  }

  async function reloadLatestDraft() {
    if (!draft) return;
    try {
      const row = await getEmailDraft(draft.id);
      if (!row) {
        setDraft(null);
        setSavedFingerprint(null);
        setDraftConflict(false);
        setDraftError("This draft was deleted. Save yours as a new draft.");
        return;
      }
      openDraft(row);
      clearRecoveryCopy(browserStorage());
    } catch (error) {
      setDraftError(draftErrorMessage(error));
    }
  }

  async function removeDraft(row) {
    try {
      await deleteEmailDraft(row.id);
      setDrafts((current) => current.filter((item) => item.id !== row.id));
      setPendingDraftDeleteId("");
      if (draft?.id === row.id) {
        setDraft(null);
        setSavedFingerprint(null);
      }
      addToast({ variant: "success", title: "Draft deleted" });
    } catch (error) {
      addToast({ variant: "error", title: "Could not delete draft", description: draftErrorMessage(error) });
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      callEdgeFunction({ action: "metadata" }).catch(() => ({ countries: [], languages: [], cities: [], brands: [] })),
      supabase.from("email_templates").select("id,name,subject,body,body_document").order("name"),
    ]).then(([meta, templateResult]) => {
      if (cancelled) return;
      if (!meta?._noProvider) {
        setMetadata({
          countries: meta.countries || [],
          languages: meta.languages || [],
          cities: meta.cities || [],
          brands: meta.brands || [],
        });
      }
      setTemplates(templateResult.data || []);
    });
    return () => { cancelled = true; };
  }, [callEdgeFunction]);

  useEffect(() => {
    if (!blogPostIdsKey) return undefined;
    let cancelled = false;
    const ids = blogPostIdsKey.split(",");
    callEdgeFunction({ action: "blog_posts", ids })
      .then((result) => {
        if (cancelled) return;
        const posts = result.posts || [];
        const available = new Map(posts.map((post) => [post.postId, post.available]));
        setDocumentValue((current) => refreshEmailBlogPostSnapshots(current, posts).document);
        setUnavailableBlogPostIds(new Set(ids.filter((id) => available.get(id) !== true)));
      })
      .catch((error) => {
        if (error?.name === "SessionExpiredError") onSessionExpired?.();
      });
    return () => { cancelled = true; };
    // Snapshot changes do not change this key, so this runs once per restored,
    // loaded, added or swapped set of blog references.
  }, [blogPostIdsKey, callEdgeFunction, onSessionExpired]);

  useEffect(() => {
    let cancelled = false;
    if (audienceMode !== "person" || selectedRecipient || recipientQuery.trim().length < 2) {
      const timer = setTimeout(() => {
        if (!cancelled) {
          setRecipientMatches([]);
          setRecipientSearching(false);
        }
      }, 0);
      return () => { cancelled = true; clearTimeout(timer); };
    }
    const timer = setTimeout(() => {
      setRecipientSearching(true);
      callEdgeFunction({ action: "search_recipients", term: recipientQuery.trim() })
        .then((result) => {
          if (!cancelled) setRecipientMatches(result.recipients || []);
        })
        .catch((error) => {
          if (error?.name === "SessionExpiredError") onSessionExpired?.();
          if (!cancelled) setRecipientMatches([]);
        })
        .finally(() => { if (!cancelled) setRecipientSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [audienceMode, callEdgeFunction, onSessionExpired, recipientQuery, selectedRecipient]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (audienceMode === "person" && !isRecipientChosen(selectedRecipient)) {
        setEstimate(null);
        setEstimating(false);
        return;
      }
      setEstimating(true);
      callEdgeFunction({ action: "estimate", audience })
        .then((result) => {
          if (!cancelled && !result?._noProvider) setEstimate(result);
        })
        .catch((error) => {
          if (error?.name === "SessionExpiredError") onSessionExpired?.();
          if (!cancelled) {
            setEstimate(null);
            const leads = leadsSendError(error);
            if (leads) setLeadError(leads);
          }
        })
        .finally(() => { if (!cancelled) setEstimating(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [audience, audienceMode, callEdgeFunction, onSessionExpired, selectedRecipient]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewLoading(true);
      callEdgeFunction({ action: "preview", subject, document: documentValue })
        .then((result) => {
          if (!cancelled && result?.html) setServerPreview(result.html);
        })
        .catch(() => {
          if (!cancelled) setServerPreview("");
        })
        .finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [callEdgeFunction, documentValue, subject]);

  // #4452 §5.7: the body's block edits, formatting, links and body tokens live in
  // EmailBodyEditor; the subject keeps its own token menu here.
  function insertToken(token) {
    const input = subjectRef.current;
    const start = input?.selectionStart ?? subject.length;
    const end = input?.selectionEnd ?? subject.length;
    setSubject(`${subject.slice(0, start)}${token}${subject.slice(end)}`);
    requestAnimationFrame(() => input?.focus());
  }

  function chooseBlogPost(post) {
    setDocumentValue((current) => {
      if (blogPickerBlockId) return swapEmailBlogPost(current, blogPickerBlockId, post);
      if (current.filter((block) => block.type === "blog_post").length >= 3) {
        addToast({ variant: "error", title: "Use up to 3 blog posts per email" });
        return current;
      }
      return appendEmailBlogPost(current, post, blockId());
    });
    setBlogPickerBlockId(null);
  }

  async function uploadAsset(file) {
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type)) {
      addToast({ variant: "error", title: "Use PNG, JPEG, WebP, or GIF" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      addToast({ variant: "error", title: "Images must be 5 MiB or smaller" });
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your admin session expired");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${user.id}/${Date.now()}-${blockId()}-${safeName}`;
      const { error } = await supabase.storage.from("admin-email-assets").upload(path, file, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("admin-email-assets").getPublicUrl(path);
      setDocumentValue((current) => [...current, {
        id: blockId(),
        type: "image",
        url: data.publicUrl,
        alt: "",
        link: "",
      }]);
    } catch (error) {
      addToast({ variant: "error", title: "Upload failed", description: error.message });
    } finally {
      setUploading(false);
    }
  }

  function loadTemplate(templateId) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setSubject(template.subject || "");
    const templateBlocks = Array.isArray(template.body_document)
      ? template.body_document
      : template.body_document?.version === 1 && Array.isArray(template.body_document.blocks)
        ? template.body_document.blocks
        : null;
    setDocumentValue(templateBlocks?.length
      ? templateBlocks.map((block) => ({
        ...block,
        id: block.id || blockId(),
        ...(block.type === "rich_text" ? { html: sanitizeLocalRichText(block.html) } : {}),
      }))
      : [{ id: blockId(), type: "rich_text", html: `<p>${escapeHtml(String(template.body || "")).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` }]);
  }

  async function saveTemplate() {
    if (!templateName.trim()) {
      addToast({ variant: "error", title: "Add a template name" });
      return;
    }
    if (!subject.trim() || !plainTextFromDocument(documentValue).trim()) {
      addToast({ variant: "error", title: "Add a subject and email body first" });
      return;
    }
    setTemplateSaving(true);
    const payload = {
      name: templateName.trim(),
      subject: subject.trim(),
      body: plainTextFromDocument(documentValue),
      body_document: { version: 1, blocks: documentValue },
    };
    try {
      const query = editingTemplateId
        ? supabase.from("email_templates").update(payload).eq("id", editingTemplateId)
        : supabase.from("email_templates").insert(payload);
      const { data, error } = await query.select("id,name,subject,body,body_document").single();
      if (error) throw error;
      setTemplates((current) => [...current.filter((item) => item.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name)));
      setEditingTemplateId(data.id);
      addToast({ variant: "success", title: editingTemplateId ? "Template updated" : "Template saved" });
    } catch (error) {
      addToast({ variant: "error", title: "Could not save template", description: error.message });
    } finally {
      setTemplateSaving(false);
    }
  }

  async function deleteTemplate(template) {
    try {
      const { error } = await supabase.from("email_templates").delete().eq("id", template.id);
      if (error) throw error;
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (editingTemplateId === template.id) {
        setEditingTemplateId("");
        setTemplateName("");
      }
      setPendingTemplateDeleteId("");
      addToast({ variant: "success", title: "Template deleted" });
    } catch (error) {
      addToast({ variant: "error", title: "Could not delete template", description: error.message });
    }
  }

  function validationError(now, candidateDocument = documentValue, unavailableIds = unavailableBlogPostIds) {
    if (!subject.trim()) return "Add a subject line";
    if (!plainTextFromDocument(candidateDocument).trim()) return "Add email content";
    const blogError = emailBlogPostValidationError(candidateDocument, unavailableIds);
    if (blogError) return blogError;
    const allowedTokens = new Set([...TOKENS.map((token) => token.value.slice(1, -1)), "name"]);
    const tokenValues = [subject, ...candidateDocument.flatMap((block) => block.type === "rich_text" ? [block.html] : block.type === "image" ? [block.alt] : [])];
    for (const value of tokenValues) {
      for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
        if (!allowedTokens.has(match[1])) return `Remove unsupported personalization token {${match[1]}}`;
      }
    }
    if (candidateDocument.some((block) => block.type === "image" && !block.alt.trim())) return "Add alt text to every image or GIF";
    // #4383: a scheduled email's audience and time are fixed while its words are edited.
    if (editingCampaign) return null;
    if (audienceMode === "person" && !isRecipientChosen(selectedRecipient)) return "Choose an eligible Mingla recipient";
    if (scheduleMode === "later" && (!scheduledLocal || new Date(scheduledLocal).getTime() <= now)) return "Choose a future send time";
    if (!estimate || estimate.will_receive < 1) return "This audience has no eligible recipients";
    return null;
  }

  async function openReview(now) {
    let candidateDocument = bodyEditorRef.current?.flush(documentValue) ?? documentValue;
    let unavailableIds = unavailableBlogPostIds;
    const ids = [...new Set(candidateDocument.filter((block) => block.type === "blog_post").map((block) => block.postId))];
    if (ids.length) {
      try {
        const result = await callEdgeFunction({ action: "blog_posts", ids });
        const refreshed = refreshEmailBlogPostSnapshots(candidateDocument, result.posts || []);
        candidateDocument = refreshed.document;
        unavailableIds = refreshed.unavailablePostIds;
        setUnavailableBlogPostIds(unavailableIds);
      } catch (refreshError) {
        if (refreshError?.name === "SessionExpiredError") onSessionExpired?.();
        addToast({ variant: "error", title: "Blog posts couldn't be checked", description: refreshError.message });
        return;
      }
    }
    setDocumentValue(candidateDocument);
    const error = validationError(now, candidateDocument, unavailableIds);
    if (error) {
      addToast({ variant: "error", title: error });
      return;
    }
    if (editingCampaign) {
      await saveScheduledEdits(candidateDocument);
      return;
    }
    setReviewOpen(true);
  }

  // #4383: save the new words of a scheduled email (the server checks them
  // exactly as a new campaign and refuses once it has started sending).
  async function saveScheduledEdits(candidateDocument) {
    setSavingEdits(true);
    try {
      await callEdgeFunction({
        action: "update_scheduled_campaign",
        campaignId: editingCampaign.id,
        subject: subject.trim(),
        document: candidateDocument,
      });
      addToast({ variant: "success", title: "Scheduled email updated", description: "It keeps its time and its audience." });
      onEditingDone?.(true);
    } catch (error) {
      if (error?.name === "SessionExpiredError") onSessionExpired?.();
      else addToast({ variant: "error", title: "Changes were not saved", description: communicationsErrorMessage(error) });
    } finally {
      setSavingEdits(false);
    }
  }

  async function confirmCampaign() {
    setSending(true);
    try {
      const result = await callEdgeFunction({
        action: "create_campaign",
        audience,
        subject: subject.trim(),
        document: documentValue,
        scheduledFor: scheduleMode === "later" ? new Date(scheduledLocal).toISOString() : null,
        timezone,
      });
      const campaign = result.campaign;
      addToast({
        variant: "success",
        title: scheduleMode === "later" ? "Email scheduled" : "Email queued",
        description: `${campaign.will_receive.toLocaleString()} recipient${campaign.will_receive === 1 ? "" : "s"}; ${campaign.skipped_opt_out.toLocaleString()} opted out.`,
      });
      setReviewOpen(false);
      setSubject("");
      setDocumentValue(defaultDocument());
      setAudienceMode("segment");
      setLeadTarget(null);
      setFilters(EMPTY_FILTERS);
      setSelectedRecipient(null);
      setRecipientQuery("");
      setScheduleMode("now");
      setScheduledLocal("");
      // #4255: a sent email leaves the shared drafts (when we may remove it).
      const sentDraft = draft;
      setDraft(null);
      setSavedFingerprint(null);
      clearRecoveryCopy(browserStorage());
      if (sentDraft && draftEditable) {
        deleteEmailDraft(sentDraft.id)
          .then(() => setDrafts((current) => current.filter((item) => item.id !== sentDraft.id)))
          .catch((error) => addToast({ variant: "error", title: "Email sent, but its draft is still listed", description: draftErrorMessage(error) }));
      }
    } catch (error) {
      if (error?.name === "SessionExpiredError") onSessionExpired?.();
      else addToast({ variant: "error", title: "Campaign was not queued", description: leadsSendError(error)?.message || error.message });
    } finally {
      setSending(false);
    }
  }

  const audienceLabel = audienceSummary(audienceMode, filters, estimate, selectedRecipient, leadTarget);
  const leadsMode = audienceMode === "leads" || audienceMode === "lead_reply";
  const leftOut = exclusionReasons(estimate);
  const byGroup = groupBreakdown(estimate);

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,0.9fr)]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
        {!providerConfigured && (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            Preview is available, but sending is disabled until the Resend provider is configured.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gray-200)] px-4 py-3 sm:px-5" data-email-draft-bar>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <span className="truncate">{draft ? (draft.subject || "Untitled draft") : "New email"}</span>
              {draft ? <Badge variant={draft.status === "ready_for_review" ? "info" : "default"}>{DRAFT_STATUS_LABELS[draft.status] || "Draft"}</Badge> : null}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]" aria-live="polite">
              {draftSaving
                ? "Saving…"
                : draft
                  ? `${draftAuthorLabel(draft, myEmail) === "You" ? "Your draft" : `${draftAuthorLabel(draft, myEmail)}'s draft`} · ${draftDirty ? "Unsaved changes" : `Saved ${formatRelativeTime(draft.updated_at)}`}${draftEditable ? "" : " · Read only for you"}`
                  : draftDirty
                    ? "Not saved yet. Save it to share it with your team."
                    : "Drafts are shared with your team."}
            </p>
          </div>
          {editingCampaign ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">Editing a scheduled email</Badge>
              <Button variant="secondary" size="sm" onClick={() => onEditingDone?.(false)} disabled={savingEdits}>Stop editing</Button>
            </div>
          ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={FileText} onClick={() => { setDraftsOpen(true); void refreshDrafts(); }}>
              Drafts{drafts.length ? ` (${drafts.length})` : ""}
            </Button>
            <Button variant="secondary" size="sm" icon={FilePlus} onClick={() => void leaveCurrentEmail(startNewEmail)} disabled={draftSaving}>
              New email
            </Button>
            <Button variant="secondary" size="sm" icon={Save} onClick={() => void saveDraft({ status: "draft" })} loading={draftSaving} disabled={draftConflict}>
              {draft && !draftEditable ? "Save as my copy" : "Save draft"}
            </Button>
            <Button size="sm" onClick={() => void saveDraft({ status: "ready_for_review" })} disabled={draftSaving || draftConflict || (draft?.status === "ready_for_review" && !draftDirty)}>
              Ready for review
            </Button>
          </div>
          )}
          {(draftConflict || draftError) && (
            <div role="alert" className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p>{draftError || "Someone saved this draft after you opened it. Load their version, or save yours as a copy."}</p>
              {draftConflict && (
                <div className="mt-2 flex flex-wrap gap-3">
                  <button type="button" className="font-semibold underline" onClick={() => void reloadLatestDraft()}>Load their version</button>
                  <button type="button" className="font-semibold underline" onClick={() => void saveDraft({ asCopy: true })}>Save mine as a copy</button>
                </div>
              )}
            </div>
          )}
        </div>

        {editingCampaign ? (
          <div className="border-b border-[var(--gray-200)] px-4 py-4 sm:px-5" data-email-editing-audience>
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Audience</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">The audience was counted when this email was scheduled and stays the same. To change who gets it, cancel it and write a new email.</p>
          </div>
        ) : (
        <div className="border-b border-[var(--gray-200)] px-4 py-4 sm:px-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Audience</h2>
              <p className="text-xs text-[var(--color-text-tertiary)]">Hosts are the default. Explorer, ticket-buyer, host-contact and Everyone sends always require an explicit choice and count review. People without a Mingla account only get marketing email if they agreed to it (a host's import counts as agreement).</p>
            </div>
            {leadsMode ? null : (
            <div className="flex flex-wrap rounded-lg bg-[var(--gray-100)] p-1">
              {AUDIENCE_PRESETS.map((preset) => {
                const active = presetIsActive(preset, audienceMode, filters);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = choosePreset(preset, filters);
                      setAudienceMode(next.audienceMode);
                      if (next.filters !== filters) setFilters(next.filters);
                      // #4226 Phase 2: plays open on a play, never on "everyone".
                      if (preset.id === "plays" && !playId) choosePeopleFilter(ACTIVATION_PLAYS[0].filter, ACTIVATION_PLAYS[0].id);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${active ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            )}
          </div>

          {leadsMode && (
            <div className="flex flex-col gap-2" data-leads-audience={audienceMode}>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5 text-sm">
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {audienceMode === "leads" ? `${estimate?.matched ?? "…"} leads from Leads` : `Reply to ${leadTarget?.name || "this lead"}`}
                </span>
                <button type="button" onClick={clearLeadAudience} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Change audience</button>
              </div>
              {audienceMode === "lead_reply" && (
                <p className="text-xs text-[var(--color-text-secondary)]">One-to-one reply. It goes even without marketing consent; don't use it for promotions.</p>
              )}
              {leadError && (
                <p role="alert" className="text-sm text-[var(--color-error-700)]">
                  {leadError.message}{" "}
                  {leadError.key === "lead_selection_expired" && <a href="#/inbound" className="font-semibold underline">Back to Leads</a>}
                </p>
              )}
            </div>
          )}

          {isPeopleMode(audienceMode) && (
            <PeopleAudiencePicker
              mode={audienceMode}
              filter={peopleFilter}
              playId={playId}
              onChoose={choosePeopleFilter}
              onEditFilters={editPlayFilters}
              onUseMessage={applyPlayMessage}
            />
          )}
          {audienceMode === "everyone" && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
              <Users className="h-4 w-4 text-[var(--color-brand-500)]" />
              Everyone on the People list: app users, people who didn't finish sign-up, ticket buyers and host contacts. Unsubscribed, suppressed, staff and test addresses, and people without an account who didn't agree to marketing, are always left out.
            </div>
          )}
          {audienceMode === "person" && (
            <div className="relative">
              <label htmlFor="email-recipient-search" className="mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]">Mingla recipient</label>
              {selectedRecipient ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--gray-300)] bg-[var(--gray-50)] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{selectedRecipient.display_name}</p>
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">{selectedRecipient.email || selectedRecipient.exclusion} · {selectedRecipient.account_type} · {selectedRecipient.country}</p>
                  </div>
                  <button type="button" onClick={() => { setSelectedRecipient(null); setRecipientQuery(""); }} className="shrink-0 text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Change</button>
                </div>
              ) : (
                <>
                  <input
                    id="email-recipient-search"
                    value={recipientQuery}
                    onChange={(event) => setRecipientQuery(event.target.value)}
                    placeholder="Search a Mingla member or ticket buyer by name or email"
                    autoComplete="off"
                    className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
                  />
                  {(recipientSearching || recipientMatches.length > 0) && (
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-lg">
                      {recipientSearching ? (
                        <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-text-secondary)]"><Spinner size="xs" /> Searching Mingla members…</div>
                      ) : recipientMatches.map((person) => (
                        <button
                          key={person.profile_id || person.email}
                          type="button"
                          onClick={() => { setSelectedRecipient(person); setRecipientQuery(person.display_name); setRecipientMatches([]); }}
                          disabled={!person.eligible}
                          className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-[var(--gray-50)] disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <span className="min-w-0"><span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{person.display_name} <span className="font-normal text-[var(--color-text-tertiary)]">{person.username}</span></span><span className="block truncate text-xs text-[var(--color-text-secondary)]">{person.email || person.exclusion} · {person.account_type} · {person.country}</span></span>
                          <span className={`shrink-0 text-[11px] font-semibold ${person.eligible ? "text-emerald-700" : "text-amber-700"}`}>{person.eligible ? "Eligible" : person.exclusion}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {audienceMode === "segment" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <FilterSelect label="User type" value={filters.userType} onChange={(value) => setFilter("userType", value)}>
                  <option value="all">All</option><option value="host">Hosts (incl. Both)</option><option value="explorer">Explorers (incl. Both)</option><option value="ticket_buyers">Ticket buyers</option><option value="host_contacts">Host contacts</option>
                </FilterSelect>
                <FilterSelect label="Source" value={filters.source} onChange={(value) => setFilter("source", value)}>
                  <option value="all">All</option>
                  {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </FilterSelect>
                <FilterSelect label="App status" value={filters.appStatus} onChange={(value) => setFilter("appStatus", value)}>
                  <option value="all">All</option>
                  {APP_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </FilterSelect>
                <FilterSelect label="Event city" value={filters.city} onChange={(value) => setFilter("city", value)}>
                  <option value="all">All cities</option>
                  {metadata.cities.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </FilterSelect>
                <FilterSelect label="Bought tickets" value={filters.boughtTickets} onChange={(value) => setFilter("boughtTickets", value)}>
                  <option value="all">All</option><option value="yes">Yes</option><option value="no">No</option>
                </FilterSelect>
                <FilterSelect label="Brand bought from" value={filters.brandId} onChange={(value) => setFilter("brandId", value)}>
                  <option value="all">All brands</option>
                  {metadata.brands.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </FilterSelect>
                <FilterSelect label="Country" value={filters.country} onChange={(value) => setFilter("country", value)}>
                  <option value="all">All countries</option>
                  {metadata.countries.map((option) => {
                    const value = typeof option === "string" ? option : option.value;
                    const label = typeof option === "string" ? option : option.label;
                    return <option key={value} value={value}>{label}{label !== value ? ` (${value})` : ""}</option>;
                  })}
                </FilterSelect>
                <FilterSelect label="Onboarding" value={filters.onboarding} onChange={(value) => setFilter("onboarding", value)}>
                  <option value="all">All</option><option value="completed">Completed</option><option value="incomplete">Incomplete</option>
                </FilterSelect>
                <FilterSelect label="Account status" value={filters.accountStatus} onChange={(value) => setFilter("accountStatus", value)}>
                  <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
                </FilterSelect>
                <FilterSelect label="Email status" value={filters.emailStatus} onChange={(value) => setFilter("emailStatus", value)}>
                  <option value="all">All</option><option value="verified">Verified</option><option value="unverified">Unverified</option>
                </FilterSelect>
                <FilterSelect label="Language" value={filters.language} onChange={(value) => setFilter("language", value)}>
                  <option value="all">All languages</option>
                  {metadata.languages.map((option) => {
                    const value = typeof option === "string" ? option : option.value;
                    const label = typeof option === "string" ? option : option.label;
                    return <option key={value} value={value}>{label}</option>;
                  })}
                </FilterSelect>
                <FilterSelect label="Beta tester" value={filters.beta} onChange={(value) => setFilter("beta", value)}>
                  <option value="all">All</option><option value="beta">Beta only</option><option value="non_beta">Not beta</option>
                </FilterSelect>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor="email-joined-from" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Joined from</label>
                    <button type="button" onClick={() => setFilter("joinedFrom", "")} className={`text-[10px] font-semibold ${filters.joinedFrom ? "text-[var(--color-brand-700)] hover:underline" : "text-[var(--color-text-tertiary)]"}`}>All</button>
                  </div>
                  <CalendarInput id="email-joined-from" mode="date" value={filters.joinedFrom} onChange={(event) => setFilter("joinedFrom", event.target.value)} className="h-9 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)]" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor="email-joined-through" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Joined through</label>
                    <button type="button" onClick={() => setFilter("joinedTo", "")} className={`text-[10px] font-semibold ${filters.joinedTo ? "text-[var(--color-brand-700)] hover:underline" : "text-[var(--color-text-tertiary)]"}`}>All</button>
                  </div>
                  <CalendarInput id="email-joined-through" mode="date" value={filters.joinedTo} onChange={(event) => setFilter("joinedTo", event.target.value)} className="h-9 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)]" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--color-text-secondary)]">Filters combine with AND.</span>
                <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setAudienceMode("everyone"); }} className="font-semibold text-[var(--color-brand-600)] hover:underline">Clear all and send to everyone</button>
              </div>
            </div>
          )}

          <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-secondary)]" aria-live="polite">
            {estimating ? <><Spinner size="xs" /> Counting eligible recipients…</> : estimate ? (
              <><strong className="text-[var(--color-text-primary)]">{estimate.matched.toLocaleString()}</strong> matched · <strong className="text-[var(--color-text-primary)]">{estimate.will_receive.toLocaleString()}</strong> will receive{leftOut.map((reason) => <span key={reason.key}> · {reason.count.toLocaleString()} {reason.label}</span>)}</>
            ) : <span>Recipient count appears here.</span>}
          </div>
          {!estimating && byGroup.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-tertiary)]" aria-label="Will receive, by group">
              {byGroup.map((group) => <span key={group.key}>{group.label}: <strong className="tabular-nums text-[var(--color-text-secondary)]">{group.count.toLocaleString()}</strong></span>)}
            </div>
          )}
        </div>

        )}

        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">From</p>
              <p className="mt-0.5 text-sm font-medium text-[var(--color-text-primary)]">{ADMIN_EMAIL_FROM_LABEL}</p>
            </div>
            <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Replies</p>
              <p className="mt-0.5 text-sm font-medium text-[var(--color-text-primary)]">{ADMIN_EMAIL_REPLY_TO}</p>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="email-subject" className="text-sm font-medium text-[var(--color-text-primary)]">Subject</label>
              <details className="relative"><summary className="cursor-pointer list-none rounded-md border border-[var(--gray-200)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">Insert ▾</summary><div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-lg">{TOKENS.map((token) => <button key={token.value} type="button" onClick={() => insertToken(token.value)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--gray-50)]">{token.label}</button>)}</div></details>
            </div>
            <input id="email-subject" ref={subjectRef} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A clear, personal subject line" className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]" />
          </div>

          {/* #4452 §5.7: the body editor is shared with the forms automation step. */}
          <EmailBodyEditor
            ref={bodyEditorRef}
            value={documentValue}
            onChange={setDocumentValue}
            tokens={TOKENS}
            imageUpload={uploadAsset}
            uploading={uploading}
            onPickBlogPost={setBlogPickerBlockId}
            unavailableBlogPostIds={unavailableBlogPostIds}
            emptyDocument={defaultDocument}
          />

          <div className="grid gap-3 border-t border-[var(--gray-200)] pt-4 md:grid-cols-[minmax(210px,0.75fr)_minmax(220px,1fr)_auto] md:items-end">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <FilterSelect label="Template" value="" onChange={loadTemplate}>
                <option value="">Choose template…</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </FilterSelect>
              <button
                type="button"
                onClick={() => {
                  setEditingTemplateId("");
                  setTemplateName("");
                  setPendingTemplateDeleteId("");
                  setTemplateManagerOpen(true);
                }}
                className="h-9 rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-brand-300)] hover:text-[var(--color-brand-700)]"
              >
                Manage
              </button>
            </div>
            {editingCampaign ? (
              <Button icon={Save} onClick={() => openReview(Date.now())} loading={savingEdits} disabled={!providerConfigured || savingEdits}>
                Save changes
              </Button>
            ) : (<>
            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Delivery</span>
              <div className="flex min-h-9 flex-wrap items-center gap-2">
                <button type="button" aria-pressed={scheduleMode === "now"} onClick={() => setScheduleMode("now")} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${scheduleMode === "now" ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)]"}`}>Send now</button>
                <button type="button" aria-pressed={scheduleMode === "later"} onClick={() => setScheduleMode("later")} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${scheduleMode === "later" ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)]"}`}>Schedule</button>
                {scheduleMode === "later" && <CalendarInput mode="datetime" value={scheduledLocal} onChange={(event) => setScheduledLocal(event.target.value)} className="h-9 min-w-[195px] rounded-lg border border-[var(--gray-300)] px-2 text-xs" />}
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{timezone}</p>
            </div>
            <Button icon={scheduleMode === "later" ? CalendarClock : Send} onClick={() => openReview(Date.now())} disabled={!providerConfigured || sending}>
              Review {scheduleMode === "later" ? "schedule" : "send"}
            </Button>
            </>)}
          </div>
        </div>
      </section>

      <aside className="min-w-0 self-start overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] xl:sticky xl:top-4">
        <div className="flex items-center justify-between border-b border-[var(--gray-200)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Live preview</h2>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">Personalized as Maya · exact email shell</p>
          </div>
          <div className="flex rounded-lg bg-[var(--gray-100)] p-1">
            <button type="button" aria-label="Desktop preview" aria-pressed={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")} className={`rounded-md p-1.5 ${previewMode === "desktop" ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"}`}><Monitor className="h-4 w-4" /></button>
            <button type="button" aria-label="Mobile preview" aria-pressed={previewMode === "mobile"} onClick={() => setPreviewMode("mobile")} className={`rounded-md p-1.5 ${previewMode === "mobile" ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"}`}><Smartphone className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="border-b border-[var(--gray-200)] px-4 py-3 text-xs">
          <p className="truncate text-[var(--color-text-tertiary)]">To: <span className="font-medium text-[var(--color-text-primary)]">{audienceLabel}</span></p>
          <p className="truncate text-[var(--color-text-tertiary)]">Subject: <span className="font-medium text-[var(--color-text-primary)]">{replacePreviewTokens(subject) || "No subject yet"}</span></p>
        </div>
        <div className="relative flex min-h-[560px] justify-center overflow-auto bg-[var(--gray-100)] p-3">
          {previewLoading && <div className="absolute right-4 top-4 z-10 rounded-full bg-white p-2 shadow"><Spinner size="xs" /></div>}
          <div className={`overflow-hidden rounded-xl bg-white transition-all ${previewMode === "mobile" ? "w-[320px]" : "w-full"}`}>
            {serverPreview ? (
              <iframe title="Rendered email preview" sandbox="allow-popups" srcDoc={serverPreview} className="h-[720px] w-full border-0 bg-white" />
            ) : (
              <LocalEmailPreview subject={subject} documentValue={documentValue} />
            )}
          </div>
        </div>
      </aside>

      <EmailBlogPostPicker
        open={blogPickerBlockId !== null}
        onClose={() => setBlogPickerBlockId(null)}
        callEdgeFunction={callEdgeFunction}
        existingPostIds={new Set(documentValue.filter((block) => block.type === "blog_post" && block.id !== blogPickerBlockId).map((block) => block.postId))}
        onChoose={chooseBlogPost}
      />

      <Modal open={draftsOpen} onClose={() => setDraftsOpen(false)} title="Team email drafts" size="md">
        <ModalBody>
          {draftsLoading && drafts.length === 0 ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : draftsError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p>{draftsError}</p>
              <button type="button" className="mt-2 font-semibold underline" onClick={() => void refreshDrafts()}>Try again</button>
            </div>
          ) : drafts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--gray-300)] px-4 py-6 text-center text-sm text-[var(--color-text-tertiary)]">
              No drafts yet. Save an email as a draft and your whole team can open it here.
            </p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Email drafts">
              {drafts.map((row) => {
                const editable = canEditDraft(row, { userId: myUserId, isAdmin });
                return (
                  <li key={row.id} className={`rounded-lg border px-3 py-3 ${draft?.id === row.id ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)]"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{row.subject || "Untitled draft"}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                          {draftAuthorLabel(row, myEmail)} · edited {formatRelativeTime(row.updated_at)}
                        </p>
                        <div className="mt-1"><Badge variant={row.status === "ready_for_review" ? "info" : "default"}>{DRAFT_STATUS_LABELS[row.status] || "Draft"}</Badge></div>
                      </div>
                      {pendingDraftDeleteId !== row.id && (
                        <div className="flex shrink-0 items-center gap-3">
                          <button
                            type="button"
                            className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
                            onClick={() => void leaveCurrentEmail(() => { openDraft(row); setDraftsOpen(false); })}
                          >
                            Open
                          </button>
                          {editable && (
                            <button type="button" className="text-xs font-semibold text-red-600 hover:underline" onClick={() => setPendingDraftDeleteId(row.id)}>
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {pendingDraftDeleteId === row.id && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
                        <span>Delete this draft for the whole team?</span>
                        <span className="flex items-center gap-2">
                          <button type="button" onClick={() => setPendingDraftDeleteId("")} className="font-semibold hover:underline">Keep</button>
                          <button type="button" onClick={() => void removeDraft(row)} className="rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700">Delete</button>
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDraftsOpen(false)}>Done</Button>
        </ModalFooter>
      </Modal>

      <Modal open={discardPrompt !== null} onClose={() => setDiscardPrompt(null)} title="Leave this email?" size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {draft && !draftEditable
              ? "You can't save changes to someone else's draft. Save yours as a copy first, or leave without saving."
              : "This email has changes that aren't saved. Save it as a draft first, or leave without saving."}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDiscardPrompt(null)}>Stay</Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const next = discardPrompt;
              const saved = await saveDraft({ asCopy: Boolean(draft && !draftEditable) });
              if (saved) {
                setDiscardPrompt(null);
                next?.();
              }
            }}
            loading={draftSaving}
          >
            {draft && !draftEditable ? "Save as my copy" : "Save draft"}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const next = discardPrompt;
              setDiscardPrompt(null);
              clearRecoveryCopy(browserStorage());
              next?.();
            }}
          >
            Leave without saving
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={templateManagerOpen} onClose={() => !templateSaving && setTemplateManagerOpen(false)} title="Manage email templates" size="md">
        <ModalBody>
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--gray-200)] bg-[var(--gray-50)] p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Input
                  label={editingTemplateId ? "Template name" : "New template name"}
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="e.g. Monthly product update"
                />
                <Button onClick={saveTemplate} loading={templateSaving}>
                  {editingTemplateId ? "Update with current email" : "Save current email"}
                </Button>
              </div>
              {editingTemplateId && (
                <button
                  type="button"
                  onClick={() => { setEditingTemplateId(""); setTemplateName(""); }}
                  className="mt-2 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
                >
                  Save as a new template instead
                </button>
              )}
              <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Saves the current subject, formatting, links, images, GIFs, and dividers.</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Saved templates</p>
              {templates.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--gray-300)] px-4 py-6 text-center text-sm text-[var(--color-text-tertiary)]">No templates saved yet.</p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {templates.map((template) => (
                    <div key={template.id} className="rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{template.name}</p>
                          <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{template.subject || "No subject"}</p>
                        </div>
                        {pendingTemplateDeleteId !== template.id && (
                          <div className="flex shrink-0 items-center gap-2">
                            <button type="button" onClick={() => { loadTemplate(template.id); setTemplateManagerOpen(false); }} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Use</button>
                            <button type="button" onClick={() => { loadTemplate(template.id); setEditingTemplateId(template.id); setTemplateName(template.name); }} className="text-xs font-semibold text-[var(--color-text-secondary)] hover:underline">Edit</button>
                            <button type="button" onClick={() => setPendingTemplateDeleteId(template.id)} className="text-xs font-semibold text-red-600 hover:underline">Delete</button>
                          </div>
                        )}
                      </div>
                      {pendingTemplateDeleteId === template.id && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
                          <span>Delete this template permanently?</span>
                          <span className="flex items-center gap-2">
                            <button type="button" onClick={() => setPendingTemplateDeleteId("")} className="font-semibold hover:underline">Keep</button>
                            <button type="button" onClick={() => deleteTemplate(template)} className="rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700">Delete</button>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setTemplateManagerOpen(false)} disabled={templateSaving}>Done</Button>
        </ModalFooter>
      </Modal>

      <Modal open={reviewOpen} onClose={() => !sending && setReviewOpen(false)} title={scheduleMode === "later" ? "Review scheduled email" : "Review email before sending"} size="md">
        <ModalBody>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-4 sm:grid-cols-3">
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Matched</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.matched.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Recipients</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.will_receive.toLocaleString()} eligible</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Unsubscribed</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.opted_out.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">No valid email</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.no_contact.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Duplicate email</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.duplicate.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Didn't agree to marketing</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{Number(estimate?.no_consent || 0).toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Staff and test</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{Number(estimate?.internal || 0).toLocaleString()}</p></div>
              <div className="col-span-2 sm:col-span-3"><p className="text-xs text-[var(--color-text-tertiary)]">Audience</p><p className="mt-1 font-medium text-[var(--color-text-primary)]">{audienceLabel}</p></div>
              <div className="col-span-2 sm:col-span-3"><p className="text-xs text-[var(--color-text-tertiary)]">When</p><p className="mt-1 font-medium text-[var(--color-text-primary)]">{scheduleMode === "later" ? `${new Date(scheduledLocal).toLocaleString()} (${timezone})` : "As soon as the delivery worker claims it"}</p></div>
            </div>
            <div><p className="text-xs text-[var(--color-text-tertiary)]">From</p><p className="font-medium">{ADMIN_EMAIL_FROM_LABEL} · replies to {ADMIN_EMAIL_REPLY_TO}</p></div>
            <div><p className="text-xs text-[var(--color-text-tertiary)]">Subject</p><p className="font-medium">{subject}</p></div>
            <p className="text-xs text-[var(--color-text-secondary)]">Every matching recipient is snapshotted before delivery. The worker retries temporary failures without creating duplicate provider sends.</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setReviewOpen(false)} disabled={sending}>Go back</Button>
          <Button icon={scheduleMode === "later" ? CalendarClock : Send} onClick={confirmCampaign} loading={sending}>{scheduleMode === "later" ? "Schedule email" : "Queue email"}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
