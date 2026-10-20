import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bell, ExternalLink, Plus, RefreshCw, Save } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Input, Textarea } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import {
  getRoadmapNotificationPreview,
  getRoadmapNotificationStatus,
  listRoadmapCards,
  notifyRoadmapChange,
  reorderRoadmap,
  upsertRoadmapCard,
} from "../../services/communityService";
import { confirmRoadmapLinks, decideRoadmapSuggestion, listRoadmapLinks, previewRoadmapLinks, setRoadmapLink } from "../../services/opsService";
import { useOpsConfig } from "../../hooks/useOpsConfig";
import { OpsChip } from "../ops/OpsChip";
import { githubChipClass, githubChipWords, isRoadmapHash, opsErrorWords, parseGithubInput, parseRoadmapLinkLines, requestKey, roadmapBackfillChip, roadmapBackfillResultWords, roadmapCardFromHash, roadmapSuggestionWords } from "../../lib/opsModel";

const LANES = [
  { id: "now", label: "Now" },
  { id: "next", label: "Next" },
  { id: "later", label: "Later" },
  { id: "shipped", label: "Recently shipped" },
];

const STATUS_BADGE = {
  draft: "default",
  published: "success",
  archived: "warning",
};

export function RoadmapPanel() {
  const { addToast } = useToast();
  // #3980 Wave 4 (P3): the owner, signed in as a person, can link many cards
  // to GitHub at once.
  const opsConfig = useOpsConfig();
  const canBackfill = !!opsConfig.data?.settings?.can_edit;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyRequestKey, setNotifyRequestKey] = useState(null);
  const [notifyPreview, setNotifyPreview] = useState(null);
  const [notifyStatus, setNotifyStatus] = useState(null);
  const [statusFilter, setStatusFilter] = useState("published");
  const [draggingId, setDraggingId] = useState(null);
  // #3980 Wave 2: each card's GitHub issue, its status chip and the lane
  // GitHub suggests. Null when the list could not be read (it is shown only
  // to an owner or admin).
  const [links, setLinks] = useState(null);
  const [linksError, setLinksError] = useState("");
  // #3980 W2 rework 2: To review's "Open the draft in Roadmap" lands here
  // with ?card=<id>; that card opens in the editor once the list is read.
  const [openCardId, setOpenCardId] = useState(() => roadmapCardFromHash(window.location.hash));
  // #3980 W2 rework 3: true once the address has left Roadmap (Back, the
  // Work board, To review) or the panel is closing; no warning then.
  const leavingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listRoadmapCards());
      try {
        const data = await listRoadmapLinks();
        setLinks(Object.fromEntries((data?.cards || []).map((c) => [c.card_id, c])));
        setLinksError("");
      } catch (err) {
        setLinks(null);
        setLinksError(opsErrorWords(err));
      }
      const [preview, status] = await Promise.all([
        getRoadmapNotificationPreview(),
        getRoadmapNotificationStatus(),
      ]);
      setNotifyPreview(preview);
      setNotifyStatus(status);
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not load roadmap",
        description: err?.message,
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    leavingRef.current = false;
    const onHash = () => {
      const hash = window.location.hash;
      leavingRef.current = !isRoadmapHash(hash);
      setOpenCardId(leavingRef.current ? null : roadmapCardFromHash(hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      leavingRef.current = true;
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (!openCardId || loading) return;
    const row = rows.find((item) => item.id === openCardId);
    setOpenCardId(null);
    if (!row) {
      if (leavingRef.current) return;
      addToast({ variant: "warning", title: "That roadmap card isn’t here any more", description: "It may have been removed. Refresh to see the latest." });
      return;
    }
    setStatusFilter(row.status);
    setEditor({
      id: row.id,
      publicTitle: row.public_title,
      publicBody: row.public_body || "",
      internalNote: row.internal_note || "",
      lane: row.lane,
      status: row.status,
    });
  }, [openCardId, loading, rows, addToast]);

  const byLane = useMemo(() => {
    const map = { now: [], next: [], later: [], shipped: [] };
    for (const row of rows.filter((item) => item.status === statusFilter)) {
      (map[row.lane] || map.later).push(row);
    }
    return map;
  }, [rows, statusFilter]);

  async function saveEditor() {
    if (!editor) return;
    const publicTitle = editor.publicTitle.trim();
    if (!publicTitle) {
      addToast({ variant: "error", title: "Public title is required" });
      return;
    }
    setBusy(true);
    try {
      await upsertRoadmapCard({
        id: editor.id,
        publicTitle,
        publicBody: editor.publicBody,
        internalNote: editor.internalNote,
        lane: editor.lane,
        status: editor.status,
      });
      addToast({ variant: "success", title: "Roadmap card saved" });
      setEditor(null);
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "Save failed", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function move(row, direction) {
    const laneRows = [...(byLane[row.lane] || [])];
    const idx = laneRows.findIndex((r) => r.id === row.id);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapWith < 0 || swapWith >= laneRows.length) return;
    const tmp = laneRows[idx];
    laneRows[idx] = laneRows[swapWith];
    laneRows[swapWith] = tmp;
    let laneIndex = 0;
    const allOrdered = rows.map((item) => (
      item.lane === row.lane && item.status === statusFilter
        ? laneRows[laneIndex++]
        : item
    ));
    setBusy(true);
    try {
      await reorderRoadmap(allOrdered.map((r) => r.id));
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "Reorder failed", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function dropOn(targetId) {
    if (!draggingId || draggingId === targetId) return;
    const ordered = rows.slice();
    const from = ordered.findIndex((item) => item.id === draggingId);
    const to = ordered.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = ordered.splice(from, 1);
    ordered.splice(to, 0, item);
    setDraggingId(null);
    setBusy(true);
    try { await reorderRoadmap(ordered.map((row) => row.id)); await load(); }
    catch (err) { addToast({ variant: "error", title: "Reorder failed", description: err?.message }); }
    finally { setBusy(false); }
  }

  async function applySuggestion(row, suggestion) {
    setBusy(true);
    try {
      const decided = await decideRoadmapSuggestion(row.id, "apply");
      // The lane is saved through the existing roadmap editor: one writer, one audit row.
      await upsertRoadmapCard({
        id: row.id,
        publicTitle: row.public_title,
        publicBody: row.public_body || "",
        internalNote: row.internal_note || "",
        lane: decided?.lane || suggestion.lane,
        status: row.status,
      });
      addToast({ variant: "success", title: `Moved to ${roadmapSuggestionWords({ lane: decided?.lane || suggestion.lane })}` });
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "Could not apply the suggestion", description: opsErrorWords(err) || err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function dismissSuggestion(row) {
    setBusy(true);
    try {
      await decideRoadmapSuggestion(row.id, "dismiss");
      addToast({ variant: "success", title: "Suggestion dismissed" });
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "Could not dismiss the suggestion", description: opsErrorWords(err) || err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveLink(row, value) {
    setBusy(true);
    try {
      await setRoadmapLink(row.id, value);
      addToast({ variant: "success", title: value ? "GitHub issue linked" : "GitHub issue removed" });
      await load();
      return true;
    } catch (err) {
      addToast({ variant: "error", title: "Could not save the GitHub issue", description: opsErrorWords(err) || err?.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function summary(value) {
    if (!value || value.length <= 140) return value;
    const clipped = value.slice(0, 140);
    return `${clipped.slice(0, clipped.lastIndexOf(" ") > 100 ? clipped.lastIndexOf(" ") : 140)}…`;
  }

  function openNotifyConfirmation() {
    setNotifyRequestKey(crypto.randomUUID());
    setNotifyOpen(true);
  }

  async function sendRoadmapNotification() {
    if (!notifyRequestKey) return;
    setNotifyBusy(true);
    try {
      const result = await notifyRoadmapChange(notifyRequestKey);
      const status = await getRoadmapNotificationStatus(result?.campaign_id ?? null);
      setNotifyStatus(status);
      setNotifyOpen(false);
      setNotifyRequestKey(null);
      addToast({
        variant: "success",
        title: result?.duplicate ? "Notification already queued" : "Notification queued",
        description: `One push and one in-app notification were queued for ${
          result?.audience_count ?? 0
        } Host user${result?.audience_count === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not queue roadmap notification",
        description: `${err?.message || "Try again."} Retrying here will not duplicate the send.`,
      });
    } finally {
      setNotifyBusy(false);
    }
  }

  async function retryRoadmapNotification() {
    if (!notifyStatus?.request_key) return;
    setNotifyBusy(true);
    try {
      const result = await notifyRoadmapChange(notifyStatus.request_key);
      setNotifyStatus(
        await getRoadmapNotificationStatus(result?.campaign_id ?? null),
      );
      addToast({
        variant: "success",
        title: "Retry queued",
        description: `${result?.requeued ?? 0} failed recipient event${
          result?.requeued === 1 ? "" : "s"
        } will resume without resending completed channels.`,
      });
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not retry roadmap notification",
        description: err?.message,
      });
    } finally {
      setNotifyBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Hosts only see published cards. Internal notes never leave this console.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()}>
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Bell}
            disabled={busy || loading || !notifyPreview?.published_count}
            onClick={openNotifyConfirmation}
          >
            {notifyPreview?.published_count
              ? "Notify roadmap change"
              : "Publish a roadmap card to notify Hosts"}
          </Button>
          <Button
            size="sm"
            icon={Plus}
            onClick={() =>
              setEditor({
                id: null,
                publicTitle: "",
                publicBody: "",
                internalNote: "",
                lane: "now",
                status: "draft",
              })
            }
          >
            New card
          </Button>
        </div>
      </div>

      {canBackfill && links && !loading ? <RoadmapLinksBackfill cards={rows} onLinked={() => void load()} /> : null}

      {linksError && !links ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">GitHub issues are not shown: {linksError}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {[["published", "Live"], ["draft", "Drafts"], ["archived", "Archived"]].map(([id, label]) => (
          <Button key={id} size="sm" variant={statusFilter === id ? "primary" : "secondary"} onClick={() => setStatusFilter(id)}>
            {label} ({rows.filter((row) => row.status === id).length})
          </Button>
        ))}
      </div>

      {notifyStatus ? (
        <SectionCard title="Last roadmap notification">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--color-text-secondary)]">
            <span>Status: {notifyStatus.state}</span>
            <span>
              Last notified: {new Date(notifyStatus.created_at).toLocaleString()}
            </span>
            <span>Audience: {notifyStatus.audience_count}</span>
            <span>Bell delivered: {notifyStatus.channels?.inapp_delivered ?? 0}</span>
            <span>Push accepted: {notifyStatus.channels?.push_accepted ?? 0}</span>
            <span>Push suppressed: {notifyStatus.channels?.push_suppressed ?? 0}</span>
            <span>Push retrying: {notifyStatus.channels?.push_retrying ?? 0}</span>
            <span>Push failed: {notifyStatus.channels?.push_failed ?? 0}</span>
            {notifyStatus.state === "partial" || notifyStatus.state === "failed" ? (
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                loading={notifyBusy}
                onClick={() => void retryRoadmapNotification()}
              >
                Retry failed deliveries
              </Button>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {LANES.map((lane) => (
            <SectionCard key={lane.id} title={lane.label}>
              <div className="space-y-3">
                {(byLane[lane.id] || []).length === 0 && (
                  <p className="text-sm text-[var(--color-text-tertiary)]">Empty</p>
                )}
                {(byLane[lane.id] || []).map((row, index, arr) => (
                  <div
                    key={row.id}
                    draggable={!busy}
                    onDragStart={() => setDraggingId(row.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void dropOn(row.id)}
                    className="rounded-lg border border-[var(--color-border-primary)] p-3 space-y-2"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="line-clamp-2 font-medium text-sm">{row.public_title}</p>
                        <Badge variant={STATUS_BADGE[row.status] || "default"}>
                          {row.status}
                        </Badge>
                        {links?.[row.id]?.from_github && <Badge variant="brand">Draft from GitHub</Badge>}
                      </div>
                      {row.public_body && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-3">
                          {summary(row.public_body)}
                        </p>
                      )}
                      {row.internal_note && (
                        <button type="button" className="mt-1 rounded-full bg-[var(--color-warning-50)] px-2 py-1 text-xs font-medium text-[var(--color-warning-700)]" onClick={() => setEditor({ id: row.id, publicTitle: row.public_title, publicBody: row.public_body || "", internalNote: row.internal_note || "", lane: row.lane, status: row.status })}>Internal note</button>
                      )}
                    </div>
                    {links && (
                      <RoadmapGithubLine
                        row={row}
                        link={links[row.id]}
                        busy={busy}
                        onSave={(value) => saveLink(row, value)}
                        onApply={(suggestion) => void applySuggestion(row, suggestion)}
                        onDismiss={() => void dismissSuggestion(row)}
                      />
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={ArrowUp}
                        disabled={busy || index === 0}
                        onClick={() => void move(row, "up")}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={ArrowDown}
                        disabled={busy || index === arr.length - 1}
                        onClick={() => void move(row, "down")}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setEditor({
                            id: row.id,
                            publicTitle: row.public_title,
                            publicBody: row.public_body || "",
                            internalNote: row.internal_note || "",
                            lane: row.lane,
                            status: row.status,
                          })
                        }
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.id ? "Edit roadmap card" : "New roadmap card"}
      >
        <ModalBody className="space-y-3">
          <Input
            label="Public title"
            value={editor?.publicTitle || ""}
            onChange={(e) => setEditor((p) => ({ ...p, publicTitle: e.target.value }))}
            maxLength={200}
          />
          <Textarea
            label="Public body"
            value={editor?.publicBody || ""}
            onChange={(e) => setEditor((p) => ({ ...p, publicBody: e.target.value }))}
            rows={4}
          />
          <Textarea
            label="Internal note (admins only)"
            value={editor?.internalNote || ""}
            onChange={(e) => setEditor((p) => ({ ...p, internalNote: e.target.value }))}
            rows={3}
          />
          <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
            Lane
            <select
              className="mt-1 w-full rounded-md border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
              value={editor?.lane || "now"}
              onChange={(e) => setEditor((p) => ({ ...p, lane: e.target.value }))}
            >
              {LANES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
            Status
            <select
              className="mt-1 w-full rounded-md border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
              value={editor?.status || "draft"}
              onChange={(e) => setEditor((p) => ({ ...p, status: e.target.value }))}
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setEditor(null)}>
            Cancel
          </Button>
          <Button icon={Save} loading={busy} onClick={() => void saveEditor()}>
            Save
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={notifyOpen}
        onClose={() => {
          if (!notifyBusy) {
            setNotifyOpen(false);
            setNotifyRequestKey(null);
          }
        }}
        title={`Send one roadmap update notification to ${
          notifyPreview?.audience_count ?? 0
        } active Hosts?`}
        size="sm"
      >
        <ModalBody className="space-y-3">
          <p className="text-sm text-[var(--color-text-primary)]">
            This sends one push and one matching in-app notification to each of{" "}
            <strong>{notifyPreview?.audience_count ?? 0} active Host users</strong>.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            All roadmap edits since the last notice are bundled into this one update.
            Hosts will land on the Roadmap section. No email is sent.
          </p>
          <div className="rounded-lg border border-[var(--color-border-primary)] p-3">
            <p className="text-sm font-semibold">Mingla roadmap updated</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              See what’s new in Now, Next and Later.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            disabled={notifyBusy}
            onClick={() => {
              setNotifyOpen(false);
              setNotifyRequestKey(null);
            }}
          >
            Cancel
          </Button>
          <Button
            icon={Bell}
            loading={notifyBusy}
            onClick={() => void sendRoadmapNotification()}
          >
            Send one notification
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// #3980 Wave 2: a roadmap card's GitHub issue. Linked: the status chip and
// Change / Remove. Not linked: an issue field and Save. When GitHub's Status
// or Horizon suggests another lane: Apply (through the roadmap editor) or
// Dismiss. Nothing here moves a card by itself.
function RoadmapGithubLine({ row, link, busy, onSave, onApply, onDismiss }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const issue = link?.issue || null;
  const suggestion = link?.suggestion || null;
  async function save(event) {
    event.preventDefault();
    const parsed = parseGithubInput(value);
    if (parsed.error) { setError(parsed.error); return; }
    if (parsed.kind === "pull") { setError("Link the issue, not a pull request."); return; }
    if (await onSave(value.trim())) { setEditing(false); setValue(""); setError(""); }
  }
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-[var(--color-text-tertiary)]">GitHub issue</span>
        {issue && !editing ? (
          <>
            <a href={issue.url} target="_blank" rel="noopener noreferrer" title={issue.title || undefined}
              className={`inline-flex min-h-8 items-center gap-1 rounded-full px-2 font-medium hover:underline ${githubChipClass(issue.label)}`}>
              <span className="break-normal [overflow-wrap:normal]">{githubChipWords(issue)}</span>
              <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="sr-only">(opens GitHub in a new tab)</span>
            </a>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(true); setValue(`#${issue.number}`); }}>Change</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onSave("")}>Remove</Button>
          </>
        ) : null}
        {!issue && !editing ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>Link issue</Button>
        ) : null}
      </div>
      {editing && (
        <form className="flex flex-wrap items-start gap-1.5" onSubmit={save}>
          <label className="min-w-[8rem] flex-1">
            <span className="sr-only">GitHub issue for {row.public_title}</span>
            <input value={value} autoFocus maxLength={120} placeholder="#123" aria-invalid={error ? "true" : undefined}
              onChange={(event) => { setValue(event.target.value); setError(""); }}
              className="min-h-9 w-full rounded-md border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] px-2 text-sm" />
            {error && <span role="alert" className="mt-1 block text-[var(--color-error-700)]">{error}</span>}
          </label>
          <Button type="submit" size="sm" disabled={busy || !value.trim()}>Save</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setValue(""); setError(""); }}>Cancel</Button>
        </form>
      )}
      {suggestion && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-[var(--color-info-50)] px-2 py-1 text-[var(--color-info-700)]">
          <span className="break-normal [overflow-wrap:normal]">GitHub suggests: {roadmapSuggestionWords(suggestion)}</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onApply(suggestion)}>Apply</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>Dismiss</Button>
        </div>
      )}
    </div>
  );
}

const BACKFILL_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

// #3980 Wave 4 (P3): "Link roadmap cards to GitHub". The owner pastes one
// "<card title or id> → #123" per line, previews (nothing is written), ticks
// the ready rows and confirms. The server checks every row again on confirm
// and links only the ready ones; the same confirm never runs twice.
export function RoadmapLinksBackfill({ cards, onLinked }) {
  const [text, setText] = useState("");
  const [problems, setProblems] = useState([]);
  const [preview, setPreview] = useState(null);
  const [sent, setSent] = useState([]);
  const [picked, setPicked] = useState([]);
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmKey, setConfirmKey] = useState(null);
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const ready = rows.map((r, i) => ({ ...r, i })).filter((r) => r.status === "ready");
  const chosen = ready.filter((r) => picked.includes(r.i));

  const runPreview = async () => {
    setError(null); setResult(null);
    const parsed = parseRoadmapLinkLines(text, cards);
    setProblems(parsed.problems);
    if (parsed.links.length === 0 || parsed.problems.some((p) => p.line === 0)) { setPreview(null); return; }
    const links = parsed.links.map(({ card_id, issue }) => ({ card_id, issue }));
    setState("loading");
    try {
      const answer = await previewRoadmapLinks(links);
      setSent(links);
      setPreview(answer);
      setPicked((answer?.rows || []).map((r, i) => (r.status === "ready" ? i : null)).filter((i) => i !== null));
      setState("preview");
    } catch (e) { setError(e); setState("idle"); }
  };

  const confirm = async () => {
    if (state !== "confirm" || chosen.length === 0) return;
    const links = chosen.map((r) => sent[r.i]);
    setState("linking"); setError(null);
    try {
      const answer = await confirmRoadmapLinks(links, confirmKey);
      setResult(answer);
      setPreview(null); setPicked([]); setConfirmKey(null);
      setState("idle");
      onLinked?.();
    } catch (e) { setError(e); setState("confirm"); }
  };

  const resultRows = Array.isArray(result?.results) ? result.results : [];
  return (
    <details className="group rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-[14px] font-semibold text-[var(--color-text-primary)] sm:px-5 ${BACKFILL_FOCUS}`}>
        <span className="min-w-0 break-normal [overflow-wrap:normal]">Link roadmap cards to GitHub</span>
        <span aria-hidden="true" className="shrink-0 text-[12px] font-medium text-[var(--color-text-tertiary)] group-open:hidden">Owner only · Open</span>
        <span aria-hidden="true" className="hidden shrink-0 text-[12px] font-medium text-[var(--color-text-tertiary)] group-open:inline">Close</span>
      </summary>
      <div className="grid min-w-0 grid-cols-1 gap-4 border-t border-[var(--gray-200)] px-4 py-4 sm:px-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="roadmap-backfill-lines" className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">One card per line</label>
          <textarea id="roadmap-backfill-lines" value={text} rows={7} disabled={state === "loading" || state === "linking"}
            placeholder={"Host payouts next day → #3801\nCalendar for hosts → #3980"}
            onChange={(e) => { setText(e.target.value); setProblems([]); }}
            aria-describedby="roadmap-backfill-help"
            className={`min-h-[9rem] w-full min-w-0 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-[13px] text-[var(--color-text-primary)] ${BACKFILL_FOCUS}`} />
          <p id="roadmap-backfill-help" className="break-normal text-[12.5px] text-[var(--color-text-tertiary)]">Write the card’s title (or its id), an arrow and the GitHub issue: #123 or its link. Up to 50 at a time. Preview changes nothing.</p>
          {problems.length > 0 && (
            <ul role="alert" className="flex min-w-0 flex-col gap-1 text-[12.5px] text-[var(--color-error-700)]">
              {problems.map((p) => <li key={`${p.line}-${p.words}`} className="break-words">{p.line ? `Line ${p.line}: ` : ""}{p.words}</li>)}
            </ul>
          )}
          <Button variant="secondary" className="min-h-11 self-start" disabled={!text.trim() || state === "loading" || state === "linking"} onClick={() => void runPreview()}>
            {state === "loading" ? "Checking…" : "Preview"}
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-2" aria-live="polite">
          {error && <p role="alert" className="break-words text-[13px] text-[var(--color-error-700)]">{opsErrorWords(error)}</p>}
          {result && (
            <>
              <p role="status" className="text-[13px] font-semibold text-[var(--color-text-primary)]">{roadmapBackfillResultWords(result)}</p>
              <BackfillRows rows={resultRows} />
            </>
          )}
          {!result && !preview && (
            <p className="break-normal text-[13px] text-[var(--color-text-secondary)]">The preview shows each card, its issue and whether it can be linked. Nothing is linked until you confirm.</p>
          )}
          {preview && (
            <>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                <OpsChip tone="success">{preview.ready || 0} ready</OpsChip>
                <OpsChip>{rows.length - (preview.ready || 0)} can’t be linked</OpsChip>
              </div>
              <BackfillRows rows={rows} picked={picked} disabled={state === "linking"}
                onToggle={(i, on) => setPicked(on ? [...picked, i] : picked.filter((x) => x !== i))} />
              {state === "confirm" || state === "linking" ? (
                <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] p-3">
                  <p className="text-[13px] text-[var(--color-warning-700)]">Link {chosen.length} {chosen.length === 1 ? "card" : "cards"} to GitHub now? Each is checked again first.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button className="min-h-11" disabled={state === "linking" || chosen.length === 0} onClick={() => void confirm()}>{state === "linking" ? "Linking…" : `Yes, link ${chosen.length}`}</Button>
                    <Button variant="ghost" className="min-h-11" disabled={state === "linking"} onClick={() => setState("preview")}>Not yet</Button>
                  </div>
                </div>
              ) : (
                <Button className="min-h-11 self-start" disabled={chosen.length === 0} onClick={() => { setConfirmKey(requestKey("roadmap_links")); setState("confirm"); }}>Link selected ({chosen.length})</Button>
              )}
            </>
          )}
        </div>
      </div>
    </details>
  );
}

function BackfillRows({ rows, picked, onToggle, disabled }) {
  return (
    <ul className="flex max-h-[420px] min-w-0 flex-col divide-y divide-[var(--gray-100)] overflow-y-auto rounded-lg border border-[var(--gray-200)]">
      {rows.map((r, i) => {
        const chip = roadmapBackfillChip(r.status);
        const can = r.status === "ready" && typeof onToggle === "function";
        return (
          <li key={`${r.card_id || "x"}-${i}`} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 px-3 py-2">
            {can ? (
              <label className="-my-2 -ml-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                <input type="checkbox" className="h-5 w-5" disabled={disabled} checked={picked.includes(i)}
                  aria-label={`Link ${r.title || "this card"} to #${r.issue_number}`} onChange={(e) => onToggle(i, e.target.checked)} />
              </label>
            ) : <span aria-hidden="true" className="h-5 w-9" />}
            <span className="min-w-0">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-normal text-[13px] font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{r.title || "Unknown card"}</span>
                <OpsChip tone={chip.tone}>{chip.label}</OpsChip>
              </span>
              <span className="block break-words text-[12px] text-[var(--color-text-secondary)]">
                {r.issue_number ? `#${r.issue_number}${r.issue_title ? ` · ${r.issue_title}` : ""}` : "No issue"}
              </span>
              {r.status !== "ready" && r.status !== "linked" && <span className="block break-words text-[12px] text-[var(--color-text-tertiary)]">{r.words}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
