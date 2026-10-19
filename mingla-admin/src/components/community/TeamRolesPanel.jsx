import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { supabase } from "../../lib/supabase";
import { timeAgo } from "../../lib/formatters";
import { listAdminTeamRoster, setCommunityStaff } from "../../services/communityService";

export function TeamRolesPanel() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listAdminTeamRoster()); }
    catch (error) { addToast({ variant: "error", title: "Could not load team", description: error?.message }); }
    finally { setLoading(false); }
  }, [addToast]);
  useEffect(() => { void load(); }, [load]);

  async function save(enabled = true) {
    if (!editor?.email?.trim()) return;
    setBusy(true);
    try {
      let userId = editor.userId;
      if (!userId) {
        const { data, error } = await supabase.from("profiles_with_segment").select("id,email,display_name").ilike("email", editor.email.trim()).maybeSingle();
        if (error) throw error;
        if (!data?.id) throw new Error("No Mingla profile matches that email.");
        userId = data.id;
      }
      await setCommunityStaff({ userId, role: editor.role, enabled, displayName: editor.displayName.trim() || null });
      addToast({ variant: "success", title: enabled ? "Community role saved" : "Community role removed" });
      setEditor(null); await load();
    } catch (error) { addToast({ variant: "error", title: "Could not update teammate", description: error?.message }); }
    finally { setBusy(false); }
  }

  return <SectionCard title="Team" subtitle="Who can moderate, answer support and publish" action={<Button size="sm" icon={UserPlus} onClick={() => setEditor({ userId: null, email: "", displayName: "", role: "moderator" })}>Invite teammate</Button>} noPadding>
    {loading ? <div className="flex justify-center py-12"><Spinner /></div> : rows.length === 0 ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">No teammates have Community or Support roles yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-[var(--gray-200)] text-left text-xs text-[var(--color-text-tertiary)]"><th className="p-3">Person</th><th className="p-3">Community role</th><th className="p-3">Support</th><th className="p-3">Available now</th><th className="p-3">Last active</th><th className="p-3"></th></tr></thead><tbody>{rows.map((row) => <tr key={row.user_id} className="border-b border-[var(--gray-100)]"><td className="p-3"><strong className="block text-[var(--color-text-primary)]">{row.display_name}</strong><span className="text-xs text-[var(--color-text-tertiary)]">{row.email}</span></td><td className="p-3"><Badge variant={row.community_role === "admin" ? "brand" : "default"}>{row.community_role || "None"}</Badge></td><td className="p-3"><Badge variant={row.support_role ? "info" : "default"}>{row.support_role || "None"}</Badge></td><td className="p-3"><Badge variant={row.available ? "success" : "default"}>{row.available ? "Yes" : "No"}</Badge></td><td className="p-3 text-xs text-[var(--color-text-secondary)]">{row.last_active ? timeAgo(row.last_active) : "Never"}</td><td className="p-3 text-right">{row.community_role !== "admin" ? <Button size="sm" variant="secondary" icon={MoreHorizontal} onClick={() => setEditor({ userId: row.user_id, email: row.email, displayName: row.display_name, role: row.community_role || "agent" })}>Manage</Button> : null}</td></tr>)}</tbody></table></div>}
    <Modal open={Boolean(editor)} onClose={() => setEditor(null)} title={editor?.userId ? "Manage teammate" : "Invite teammate"} size="sm"><ModalBody className="space-y-3"><Input label="Email" type="email" value={editor?.email || ""} disabled={Boolean(editor?.userId)} onChange={(event) => setEditor((current) => ({ ...current, email: event.target.value }))}/><Input label="Display name" value={editor?.displayName || ""} onChange={(event) => setEditor((current) => ({ ...current, displayName: event.target.value }))}/><label className="block text-sm font-medium">Community role<select value={editor?.role || "moderator"} onChange={(event) => setEditor((current) => ({ ...current, role: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3"><option value="moderator">Moderator</option><option value="agent">Agent</option></select></label></ModalBody><ModalFooter>{editor?.userId ? <Button variant="secondary" disabled={busy} onClick={() => void save(false)}>Remove role</Button> : null}<Button variant="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button loading={busy} onClick={() => void save(true)}>Save</Button></ModalFooter></Modal>
  </SectionCard>;
}
