import { useCallback, useEffect, useState } from "react";
import { Archive, Pencil, Plus, RefreshCw, Send } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Input, Textarea } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../lib/formatters";
import {
  archiveAnnouncement,
  listAnnouncements,
  publishAnnouncement,
  upsertAnnouncement,
} from "../../services/communityService";

const STATUS_BADGE = {
  draft: "default",
  published: "success",
  archived: "warning",
};

export function AnnouncementsPanel() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAnnouncements());
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not load announcements",
        description: err?.message,
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEditor() {
    if (!editor) return;
    const title = editor.title.trim();
    const bodyMd = editor.bodyMd.trim();
    if (!title || !bodyMd) {
      addToast({ variant: "error", title: "Title and body are required" });
      return;
    }
    setBusyId(editor.id || "new");
    try {
      await upsertAnnouncement({ id: editor.id, title, bodyMd });
      addToast({
        variant: "success",
        title: editor.id ? "Draft saved" : "Announcement drafted",
      });
      setEditor(null);
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "Save failed", description: err?.message });
    } finally {
      setBusyId(null);
    }
  }

  async function onPublish(id) {
    setBusyId(id);
    try {
      const n = await publishAnnouncement(id);
      addToast({
        variant: "success",
        title: "Published",
        description:
          typeof n === "number"
            ? `Queued notices for ${n} host teammate${n === 1 ? "" : "s"}.`
            : undefined,
      });
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "Publish failed", description: err?.message });
    } finally {
      setBusyId(null);
    }
  }

  async function onArchive(id) {
    setBusyId(id);
    try {
      await archiveAnnouncement(id);
      addToast({ variant: "success", title: "Archived" });
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "Archive failed", description: err?.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Service notices for Hosts. Push is always on; email follows each host&apos;s community email preference.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()}>
            Refresh
          </Button>
          <Button
            size="sm"
            icon={Plus}
            onClick={() => setEditor({ id: null, title: "", bodyMd: "" })}
          >
            New
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <SectionCard>
          <p className="text-sm text-[var(--color-text-secondary)]">No announcements yet.</p>
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <SectionCard key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-[var(--color-text-primary)] truncate">
                      {row.title}
                    </h3>
                    <Badge variant={STATUS_BADGE[row.status] || "default"}>
                      {row.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    Updated {formatDateTime(row.updated_at)}
                    {row.published_at ? ` · Published ${formatDateTime(row.published_at)}` : ""}
                  </p>
                  <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap line-clamp-3">
                    {row.body_md}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.status === "draft" && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Pencil}
                        disabled={busyId === row.id}
                        onClick={() =>
                          setEditor({
                            id: row.id,
                            title: row.title,
                            bodyMd: row.body_md,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        icon={Send}
                        disabled={busyId === row.id}
                        onClick={() => void onPublish(row.id)}
                      >
                        Publish
                      </Button>
                    </>
                  )}
                  {row.status === "published" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Archive}
                      disabled={busyId === row.id}
                      onClick={() => void onArchive(row.id)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.id ? "Edit announcement" : "New announcement"}
      >
        <ModalBody className="space-y-3">
          <Input
            label="Title"
            value={editor?.title || ""}
            onChange={(e) => setEditor((prev) => ({ ...prev, title: e.target.value }))}
            maxLength={200}
          />
          <Textarea
            label="Body (markdown ok)"
            value={editor?.bodyMd || ""}
            onChange={(e) => setEditor((prev) => ({ ...prev, bodyMd: e.target.value }))}
            rows={8}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setEditor(null)}>
            Cancel
          </Button>
          <Button
            loading={busyId === (editor?.id || "new")}
            onClick={() => void saveEditor()}
          >
            Save draft
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
