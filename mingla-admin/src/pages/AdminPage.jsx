import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, UserPlus, UserCheck, UserX, Mail,
  AlertCircle, Crown, Copy, Check, Clock,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { DataTable } from "../components/ui/Table";
import { ListItemSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import {
  timeAgo, formatDate, formatDateTime, formatRelativeTime, formatFullDate, truncate, escapeLike,
} from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";

const SETUP_SQL = `-- Run this in Supabase SQL Editor to create the admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  role text DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  status text DEFAULT 'invited' CHECK (status IN ('active', 'invited', 'revoked')),
  invited_by text,
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz
);

-- Seed the owner (your email)
INSERT INTO admin_users (email, role, status, accepted_at)
VALUES ('seth@usemingla.com', 'owner', 'active', now())
ON CONFLICT (email) DO NOTHING;

-- Enable RLS
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (needed for login check before auth)
CREATE POLICY "Allow anon read" ON admin_users FOR SELECT USING (true);

-- Allow authenticated users to manage admins
CREATE POLICY "Allow authenticated insert" ON admin_users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update" ON admin_users FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated delete" ON admin_users FOR DELETE TO authenticated USING (true);`;

const STATUS_BADGE = {
  active: "success",
  invited: "warning",
  revoked: "error",
};

const staggerItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.2 },
};

export function AdminPage() {
  const { addToast } = useToast();
  const { session } = useAuth();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableExists, setTableExists] = useState(true);
  const [error, setError] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  // Revoke modal
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  // SQL copy
  const [copied, setCopied] = useState(false);

  // Activity modal
  const [activityTarget, setActivityTarget] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const currentEmail = session?.user?.email?.toLowerCase();

  // Fetch admins
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    supabase
      .from("admin_users")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data, error: queryError }) => {
        if (!mounted) return;
        if (queryError) {
          if (queryError.code === "42P01" || queryError.message?.includes("does not exist")) {
            setTableExists(false);
          } else {
            setError(queryError.message);
          }
          setAdmins([]);
        } else {
          setTableExists(true);
          setAdmins(data || []);
        }
        setLoading(false);
      });

    return () => { mounted = false; };
  }, [fetchKey]);

  const refetch = () => setFetchKey((k) => k + 1);

  // Fetch activity for admin
  const fetchActivity = useCallback(async (email) => {
    setActivityLoading(true);
    try {
      const { data } = await supabase
        .from("admin_audit_log")
        .select("*")
        .eq("admin_email", email)
        .order("created_at", { ascending: false })
        .limit(50);
      if (mountedRef.current) setActivityLogs(data || []);
    } catch {
      if (mountedRef.current) setActivityLogs([]);
    } finally {
      if (mountedRef.current) setActivityLoading(false);
    }
  }, []);

  const openActivity = (admin) => {
    setActivityTarget(admin);
    fetchActivity(admin.email);
  };

  // Invite a new admin
  const handleInvite = useCallback(async (e) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();

    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addToast({ variant: "error", title: "Invalid email format" });
      return;
    }

    const existing = admins.find((a) => a.email.toLowerCase() === email);
    if (existing) {
      if (existing.status === "revoked") {
        setInviting(true);
        try {
          const { error: updateError } = await supabase
            .from("admin_users")
            .update({ status: "invited", invited_by: currentEmail, accepted_at: null })
            .eq("id", existing.id);
          if (updateError) throw updateError;

          const { error: otpError } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
          });
          if (otpError) {
            addToast({ variant: "success", title: "Admin re-invited", description: `${email} re-invited, but the invite email failed to send.` });
          } else {
            addToast({ variant: "success", title: "Admin re-invited", description: `Invite email sent to ${email}` });
          }

          await logAdminAction("admin.invite", "admin_user", existing.id, { email, reinvite: true });
          setInviteEmail("");
          refetch();
        } catch (err) {
          addToast({ variant: "error", title: "Re-invite failed", description: err.message });
        } finally {
          setInviting(false);
        }
        return;
      }
      addToast({ variant: "warning", title: "Already exists", description: `${email} is already ${existing.status}` });
      return;
    }

    setInviting(true);
    try {
      const { data: insertData, error: insertError } = await supabase
        .from("admin_users")
        .insert({ email, role: "admin", status: "invited", invited_by: currentEmail })
        .select()
        .single();
      if (insertError) throw insertError;

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (otpError) {
        addToast({ variant: "success", title: "Admin added", description: `${email} added but invite email failed to send.` });
      } else {
        addToast({ variant: "success", title: "Invite sent!", description: `${email} will receive an email with login access` });
      }

      await logAdminAction("admin.invite", "admin_user", insertData?.id, { email });
      setInviteEmail("");
      refetch();
    } catch (err) {
      addToast({ variant: "error", title: "Invite failed", description: err.message });
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, admins, currentEmail, addToast]);

  // Accept (activate) an invited admin
  const handleAccept = useCallback(async (admin) => {
    try {
      const { error: updateError } = await supabase
        .from("admin_users")
        .update({ status: "active", accepted_at: new Date().toISOString() })
        .eq("id", admin.id);
      if (updateError) throw updateError;
      addToast({ variant: "success", title: "Admin activated", description: `${admin.email} is now active` });
      await logAdminAction("admin.accept", "admin_user", admin.id, { email: admin.email });
      refetch();
    } catch (err) {
      addToast({ variant: "error", title: "Accept failed", description: err.message });
    }
  }, [addToast]);

  // Revoke an admin
  const handleRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const { error: updateError } = await supabase
        .from("admin_users")
        .update({ status: "revoked" })
        .eq("id", revokeTarget.id);
      if (updateError) throw updateError;
      addToast({ variant: "success", title: "Admin revoked", description: `${revokeTarget.email} can no longer log in` });
      await logAdminAction("admin.revoke", "admin_user", revokeTarget.id, { email: revokeTarget.email });
      setRevokeTarget(null);
      refetch();
    } catch (err) {
      addToast({ variant: "error", title: "Revoke failed", description: err.message });
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, addToast]);

  // Copy SQL
  const handleCopySQL = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(SETUP_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err.message);
    }
  }, []);

  // Split admins by status
  const activeAdmins = admins.filter((a) => a.status === "active");
  const invitedAdmins = admins.filter((a) => a.status === "invited");
  const revokedAdmins = admins.filter((a) => a.status === "revoked");

  // Setup required screen
  if (!loading && !tableExists) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Admin Users</h1>
        </div>

        <AlertCard variant="warning" title="Setup Required">
          <div>
            The <code className="font-mono text-xs bg-black/10 px-1 py-0.5 rounded">admin_users</code> table
            doesn't exist yet in your Supabase database. Copy and run the SQL below in the{" "}
            <strong>Supabase SQL Editor</strong> to set it up.
          </div>
        </AlertCard>

        <SectionCard
          title="Setup SQL"
          action={
            <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={handleCopySQL}>
              {copied ? "Copied!" : "Copy SQL"}
            </Button>
          }
        >
          <pre className="text-xs font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto leading-relaxed">
            {SETUP_SQL}
          </pre>
        </SectionCard>

        <div className="flex justify-center">
          <Button variant="primary" onClick={refetch}>
            I've run the SQL — Check again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Admin Users</h1>
        </div>
        <Badge variant="outline">{activeAdmins.length} active</Badge>
      </div>

      {/* Invite Form */}
      <SectionCard title="Invite New Admin" subtitle="Send a dashboard access invite">
        <form onSubmit={handleInvite} className="flex items-end gap-3">
          <div className="flex-1">
            <Input
              label="Email address"
              type="email"
              placeholder="newadmin@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              helper="They'll receive an invite email and a Supabase Auth account will be created for them"
            />
          </div>
          <Button type="submit" variant="primary" icon={UserPlus} loading={inviting} disabled={!inviteEmail.trim()}>
            Invite
          </Button>
        </form>
      </SectionCard>

      {/* Pending Invites */}
      {invitedAdmins.length > 0 && (
        <SectionCard
          title="Pending Invites"
          badge={<Badge variant="warning" dot>{invitedAdmins.length} pending</Badge>}
          noPadding
        >
          <div className="divide-y divide-[var(--gray-200)]">
            <AnimatePresence initial={false}>
              {invitedAdmins.map((admin) => (
                <motion.div key={admin.id} {...staggerItem} className="overflow-hidden">
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-warning-50)] text-[var(--color-warning-700)] shrink-0">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">{admin.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="warning" dot>invited</Badge>
                        {admin.invited_by && (
                          <span className="text-[10px] text-[var(--color-text-muted)]">by {admin.invited_by}</span>
                        )}
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {new Date(admin.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button variant="primary" size="sm" icon={UserCheck} onClick={() => handleAccept(admin)}>Accept</Button>
                      <Button variant="ghost" size="sm" icon={UserX} onClick={() => setRevokeTarget(admin)}>Revoke</Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </SectionCard>
      )}

      {/* Active Admins */}
      <SectionCard
        title="Active Admins"
        badge={<Badge variant="success" dot>{activeAdmins.length} active</Badge>}
        noPadding
      >
        {loading ? (
          <div className="p-5">
            {Array.from({ length: 3 }).map((_, i) => <ListItemSkeleton key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Failed to load admins</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{error}</p>
            <Button variant="link" onClick={refetch}>Try again</Button>
          </div>
        ) : activeAdmins.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Shield className="h-10 w-10 text-[var(--gray-300)]" />
            <p className="text-sm text-[var(--color-text-tertiary)]">No active admins</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--gray-200)]">
            <AnimatePresence initial={false}>
              {activeAdmins.map((admin) => {
                const isOwner = admin.role === "owner";
                const isSelf = admin.email.toLowerCase() === currentEmail;
                return (
                  <motion.div key={admin.id} {...staggerItem} className="overflow-hidden">
                    <div className="flex items-center gap-4 px-5 py-3.5">
                      <div className={[
                        "flex h-9 w-9 items-center justify-center rounded-full shrink-0",
                        isOwner
                          ? "bg-[var(--color-brand-50)] text-[var(--color-brand-500)]"
                          : "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
                      ].join(" ")}>
                        {isOwner ? <Crown className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[var(--color-text-primary)]">{admin.email}</p>
                          {isSelf && <Badge variant="info">you</Badge>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant={isOwner ? "brand" : "success"} dot>
                            {isOwner ? (
                              <span className="flex items-center gap-1"><Crown className="h-3 w-3" /> Owner</span>
                            ) : (
                              <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Admin</span>
                            )}
                          </Badge>
                          {admin.accepted_at && (
                            <span className="text-[10px] text-[var(--color-text-muted)]">
                              since {new Date(admin.accepted_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button variant="ghost" size="sm" icon={Clock} onClick={() => openActivity(admin)}>
                          Activity
                        </Button>
                        {!isOwner && !isSelf && (
                          <Button variant="ghost" size="sm" icon={UserX} onClick={() => setRevokeTarget(admin)}>
                            Revoke
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>

      {/* Revoked Admins */}
      {revokedAdmins.length > 0 && (
        <SectionCard
          title="Revoked"
          badge={<Badge variant="error" dot>{revokedAdmins.length}</Badge>}
          noPadding
        >
          <div className="divide-y divide-[var(--gray-200)]">
            {revokedAdmins.map((admin) => (
              <div key={admin.id} className="flex items-center gap-4 px-5 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--gray-100)] text-[var(--color-text-muted)] shrink-0">
                  <UserX className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--color-text-tertiary)] line-through">{admin.email}</p>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  onClick={async () => {
                    try {
                      const { error: err } = await supabase
                        .from("admin_users")
                        .update({ status: "invited", invited_by: currentEmail, accepted_at: null })
                        .eq("id", admin.id);
                      if (err) throw err;
                      addToast({ variant: "success", title: "Re-invited", description: `${admin.email} re-invited` });
                      await logAdminAction("admin.invite", "admin_user", admin.id, { email: admin.email, reinvite: true });
                      refetch();
                    } catch (err) {
                      addToast({ variant: "error", title: "Failed", description: err.message });
                    }
                  }}
                >
                  Re-invite
                </Button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Revoke Confirmation Modal */}
      <Modal open={!!revokeTarget} onClose={() => setRevokeTarget(null)} title="Revoke Admin Access" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Are you sure you want to revoke dashboard access for{" "}
            <strong className="text-[var(--color-text-primary)]">{revokeTarget?.email}</strong>?
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
            They will be logged out and unable to access the admin dashboard. You can re-invite them later.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRevokeTarget(null)}>Cancel</Button>
          <Button variant="danger" icon={UserX} loading={revoking} onClick={handleRevoke}>
            Revoke Access
          </Button>
        </ModalFooter>
      </Modal>

      {/* Activity Modal */}
      <Modal
        open={!!activityTarget}
        onClose={() => { setActivityTarget(null); setActivityLogs([]); }}
        title={activityTarget ? `Activity: ${activityTarget.email}` : "Activity"}
        size="lg"
      >
        <ModalBody>
          {activityLoading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[var(--color-brand-500)] border-t-transparent rounded-full animate-spin" /></div>
          ) : activityLogs.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-8">No activity recorded.</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {activityLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-background-secondary)]">
                  <Clock className="h-4 w-4 text-[var(--color-text-tertiary)] mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--color-text-primary)]">{log.action}</p>
                    {log.target_type && (
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {log.target_type}{log.target_id ? `: ${log.target_id}` : ""}
                      </p>
                    )}
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <p className="text-xs text-[var(--color-text-tertiary)] font-mono mt-0.5">
                        {JSON.stringify(log.metadata)}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] shrink-0 whitespace-nowrap">
                    {formatRelativeTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setActivityTarget(null); setActivityLogs([]); }}>Close</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
