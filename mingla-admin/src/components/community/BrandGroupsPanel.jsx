import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { SectionCard } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { ProductSignalModal } from "./SupportWorkflowModals";
import {
  listOfficialBrandGroups,
  listOfficialBrandGroupMessages,
  markOfficialBrandGroupRead,
  openOfficialBrandGroupFile,
  prepareOfficialBrandGroupFiles,
  finalizeOfficialBrandGroupFile,
  sendOfficialBrandGroupMessage,
  setOfficialBrandGroupMuted,
  uploadOfficialBrandGroupFile,
} from "../../services/communityService";
import { listProductSignals } from "../../services/supportProductWorkflowService";
import { timeAgo } from "../../lib/formatters";

export function BrandGroupsPanel() {
  const { session } = useAuth();
  const { addToast } = useToast();
  const myUserId = session?.user?.id ?? null;
  const mounted = useRef(true);
  const [groups, setGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [signalSource, setSignalSource] = useState(null);
  const [signals, setSignals] = useState([]);
  const fileInputRef = useRef(null);
  const [uploads, setUploads] = useState([]);
  const [filePreview, setFilePreview] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => () => { mounted.current = false; }, []);
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
      setError("");
    } catch (cause) {
      if (mounted.current) setError(cause?.message || "Couldn't load Brand groups");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (conversationId) => {
    if (!conversationId) return;
    setThreadLoading(true);
    try {
      const [rows, productSignals] = await Promise.all([
        listOfficialBrandGroupMessages(conversationId),
        listProductSignals(),
      ]);
      if (!mounted.current) return;
      setMessages(rows);
      setSignals(productSignals);
      await markOfficialBrandGroupRead(conversationId);
      await loadGroups();
    } catch (cause) {
      if (mounted.current) addToast({ variant: "error", title: "Couldn't load the Brand group", description: cause?.message });
    } finally {
      if (mounted.current) setThreadLoading(false);
    }
  }, [addToast, loadGroups]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => {
    setReplyTo(null);
    setSelectedMessageIds([]);
    setComposer("");
    setMessages([]);
    if (selectedId) void loadThread(selectedId);
  }, [loadThread, selectedId]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-brand-groups")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (event) => {
        void loadGroups();
        if (selectedId && event.new?.conversation_id === selectedId) void loadThread(selectedId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_group_reads" }, () => {
        void loadGroups();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadGroups, loadThread, selectedId]);

  const selectedGroup = groups.find((group) => group.conversation_id === selectedId) ?? null;
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageIds.includes(message.id)),
    [messages, selectedMessageIds],
  );
  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? groups.filter((group) => group.brand_name?.toLowerCase().includes(needle)) : groups;
  }, [groups, query]);
  const teammateLabel = (count) => `${count} ${count === 1 ? "teammate" : "teammates"}`;

  async function send() {
    const content = composer.trim();
    if (!selectedId || !content || sending) return;
    setSending(true);
    try {
      await sendOfficialBrandGroupMessage({
        conversationId: selectedId,
        content,
        replyToId: replyTo?.id ?? null,
        relatedMessageIds: selectedMessageIds,
      });
      setComposer("");
      setReplyTo(null);
      setSelectedMessageIds([]);
      await loadThread(selectedId);
    } catch (cause) {
      addToast({ variant: "error", title: "Message not sent", description: cause?.message });
    } finally {
      setSending(false);
    }
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

  function toggleSelected(id) {
    setSelectedMessageIds((current) => current.includes(id)
      ? current.filter((messageId) => messageId !== id)
      : [...current, id]);
  }

  function openSignal(message) {
    const evidence = [message, ...selectedMessages.filter((item) => item.id !== message.id)]
      .map((item) => `${item.sender_display_name}: ${item.content}`)
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
      if (selectedId) await loadThread(selectedId);
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

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Spinner /></div>;
  if (error) return <SectionCard title="Brand groups"><div className="space-y-3 text-sm text-[var(--color-text-secondary)]"><p>{error}</p><Button variant="secondary" onClick={() => void loadGroups()}>Retry</Button></div></SectionCard>;

  return (
    <div className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
      <SectionCard title="Official Brand groups" subtitle={`${groups.length} active`} noPadding>
        <div className="border-b border-[var(--gray-200)] p-3"><label className="sr-only" htmlFor="brand-group-search">Search Brand groups</label><input id="brand-group-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Brand groups" className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm" /></div>
        <div className="max-h-[700px] overflow-y-auto divide-y divide-[var(--gray-200)]">
          {visibleGroups.length === 0 ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">{groups.length ? "No Brand groups match that search." : "Active Host brands will appear here automatically."}</p> : visibleGroups.map((group) => (
            <button
              key={group.conversation_id}
              type="button"
              onClick={() => setSelectedId(group.conversation_id)}
              className={`w-full min-h-16 px-4 py-3 text-left transition-colors ${selectedId === group.conversation_id ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{group.brand_name}</span>
                {group.unread_count > 0 ? <Badge variant="brand">{group.unread_count}</Badge> : null}
              </div>
              <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{group.last_message_preview || teammateLabel(group.member_count)}</p>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={selectedGroup?.brand_name || "Choose a Brand group"}
        subtitle={selectedGroup ? `${teammateLabel(selectedGroup.member_count)} · Support has access` : ""}
        action={selectedGroup ? <div className="flex max-w-72 flex-col items-end gap-1"><Button variant="secondary" size="sm" onClick={() => void toggleMute()}>{selectedGroup.muted ? "Muted" : "Mute"}</Button><span className="text-right text-[11px] leading-4 text-[var(--color-text-tertiary)]">Mingla staff get a push for every brand group message unless muted.</span></div> : null}
        noPadding
      >
        {!selectedGroup ? <div className="flex min-h-64 items-center justify-center p-6 text-sm text-[var(--color-text-secondary)]">Select a Brand group to read and reply.</div> : (
          <div className="flex min-h-[620px] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {threadLoading && messages.length === 0 ? <div className="flex min-h-48 items-center justify-center"><Spinner /></div> : null}
              {!threadLoading && messages.length === 0 ? <p className="rounded-xl border border-[var(--gray-200)] p-5 text-sm text-[var(--color-text-secondary)]">This is the official Brand group. Start the first conversation here.</p> : null}
              {messages.map((message) => {
                const mine = message.sender_id === myUserId;
                const selected = selectedMessageIds.includes(message.id);
                return (
                  <div key={message.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                    {!mine ? <span className="mb-1 px-2 text-[11px] font-medium text-[var(--color-text-tertiary)]">{message.sender_display_name}{message.sender_role === "Mingla Support" ? " · Mingla Support" : ""}</span> : null}
                    <div className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${mine ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white" : "border-[var(--gray-200)] bg-[var(--gray-100)] text-[var(--color-text-primary)]"} ${selected ? "ring-2 ring-[#8b5cf6]" : ""}`}>
                      {message.reply_content ? <blockquote className="mb-2 border-l-2 border-current pl-2 text-xs opacity-75"><strong>{message.reply_sender_display_name || "Message"}</strong><br />{message.reply_content}</blockquote> : null}
                      {message.file_id ? (
                        <button type="button" onClick={() => void preview(message)} className="flex min-w-52 items-center gap-3 rounded-xl border border-current/20 p-2 text-left hover:bg-black/5">
                          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black/10">{message.message_type === "video" ? "▶" : message.message_type === "image" ? "▣" : "↥"}</span>
                          <span className="min-w-0"><strong className="block truncate">{message.file_name}</strong><span className="text-[11px] opacity-70">{message.file_size ? `${(message.file_size / 1024 / 1024).toFixed(1)} MB` : "Secure shared file"} · Preview</span></span>
                        </button>
                      ) : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                      <p className="mt-1 text-[10px] opacity-65">{timeAgo(message.created_at)}</p>
                    </div>
                    <div className={`mt-1 flex flex-wrap gap-3 px-2 text-xs ${mine ? "justify-end" : "justify-start"}`}>
                      <button type="button" className="font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => setReplyTo(message)}>Reply</button>
                      <button type="button" className="font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => toggleSelected(message.id)}>{selected ? "Unselect" : "Select"}</button>
                      <button type="button" className="font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => openSignal(message)}>Create product signal</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-2 border-t border-[var(--gray-200)] p-3 sm:p-4">
              {replyTo ? <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--gray-100)] px-3 py-2 text-xs"><div className="min-w-0"><strong>Replying to {replyTo.sender_display_name}</strong><p className="truncate text-[var(--color-text-tertiary)]">{replyTo.content}</p></div><button type="button" className="font-semibold text-[var(--color-brand-600)]" onClick={() => setReplyTo(null)}>Clear</button></div> : null}
              {selectedMessages.length ? <p className="text-xs font-medium text-[#7c3aed]">{selectedMessages.length} related message{selectedMessages.length === 1 ? "" : "s"} selected</p> : null}
              <p className="text-[11px] text-[var(--color-text-tertiary)]">Replying as your real staff name · Mingla Support</p>
              {uploads.length ? <div className="space-y-2 rounded-xl border border-[var(--gray-200)] p-3">{uploads.map((item) => (
                <div key={item.prepared.fileId} className="flex items-center gap-3 text-xs">
                  <div className="min-w-0 flex-1"><strong className="block truncate text-[var(--color-text-primary)]">{item.prepared.name}</strong><span className={item.state === "failed" ? "text-red-600" : "text-[var(--color-text-tertiary)]"}>{item.state === "uploading" ? `${Math.round(item.progress * 100)}% uploaded` : item.state === "finalizing" ? "Saving to Drive…" : item.state === "complete" ? "Shared" : item.error || "Waiting"}</span><div className="mt-1 h-1 overflow-hidden rounded bg-[var(--gray-200)]"><div className="h-full bg-[var(--color-brand-500)]" style={{ width: `${Math.round(item.progress * 100)}%` }} /></div></div>
                  {item.state === "failed" ? <button type="button" className="font-semibold text-[var(--color-brand-600)]" onClick={() => void transferUpload(item)}>Retry</button> : null}
                </div>
              ))}</div> : null}
              <div className="flex items-end gap-2">
                <input ref={fileInputRef} type="file" multiple className="sr-only" accept="image/*,video/*,audio/*,.pdf,.docx,.xlsx,.txt,.csv" onChange={(event) => void chooseFiles(event)} />
                <Button variant="secondary" disabled={uploads.some((item) => ["queued", "uploading", "finalizing"].includes(item.state))} onClick={() => fileInputRef.current?.click()}>Add files</Button>
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  rows={2}
                  placeholder="Reply to the Brand group…"
                  className="min-h-11 flex-1 resize-y rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
                />
                <Button loading={sending} disabled={sending || !composer.trim()} onClick={() => void send()}>Send</Button>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

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
        <div role="dialog" aria-modal="true" aria-label={`Preview ${filePreview.name}`} className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 rounded-t-xl bg-[var(--color-background-primary)] px-4 py-3"><div className="min-w-0"><strong className="block truncate text-[var(--color-text-primary)]">{filePreview.name}</strong><span className="text-xs text-[var(--color-text-tertiary)]">Secure Brand-group preview</span></div><Button variant="secondary" onClick={() => setFilePreview(null)}>Close</Button></div>
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
