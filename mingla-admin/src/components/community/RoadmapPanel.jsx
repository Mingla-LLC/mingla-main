import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Bell, Plus, RefreshCw, Save } from "lucide-react";
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

const LANES = [
  { id: "now", label: "Now" },
  { id: "next", label: "Next" },
  { id: "later", label: "Later" },
];

const STATUS_BADGE = {
  draft: "default",
  published: "success",
  archived: "warning",
};

export function RoadmapPanel() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyRequestKey, setNotifyRequestKey] = useState(null);
  const [notifyPreview, setNotifyPreview] = useState(null);
  const [notifyStatus, setNotifyStatus] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listRoadmapCards());
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

  const byLane = useMemo(() => {
    const map = { now: [], next: [], later: [] };
    for (const row of rows) {
      (map[row.lane] || map.later).push(row);
    }
    return map;
  }, [rows]);

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
    const allOrdered = [
      ...(row.lane === "now" ? laneRows : byLane.now),
      ...(row.lane === "next" ? laneRows : byLane.next),
      ...(row.lane === "later" ? laneRows : byLane.later),
    ];
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
        <div className="grid gap-4 lg:grid-cols-3">
          {LANES.map((lane) => (
            <SectionCard key={lane.id} title={lane.label}>
              <div className="space-y-3">
                {(byLane[lane.id] || []).length === 0 && (
                  <p className="text-sm text-[var(--color-text-tertiary)]">Empty</p>
                )}
                {(byLane[lane.id] || []).map((row, index, arr) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-[var(--color-border-primary)] p-3 space-y-2"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-sm truncate">{row.public_title}</p>
                        <Badge variant={STATUS_BADGE[row.status] || "default"}>
                          {row.status}
                        </Badge>
                      </div>
                      {row.public_body && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-3">
                          {row.public_body}
                        </p>
                      )}
                      {row.internal_note && (
                        <p className="text-xs text-[var(--color-warning-700)] mt-1">
                          Internal: {row.internal_note}
                        </p>
                      )}
                    </div>
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
