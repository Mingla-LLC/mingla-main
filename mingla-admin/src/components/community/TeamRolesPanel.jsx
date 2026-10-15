import { useState } from "react";
import { UserPlus } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useToast } from "../../context/ToastContext";
import { supabase } from "../../lib/supabase";
import { setCommunityStaff } from "../../services/communityService";

/**
 * Community moderator/agent grants (not Mingla admin_users, not support_staff).
 * community_staff has no authenticated SELECT — roster listing needs a later RPC.
 * This tab grants/updates by resolving email → profiles.id then community_set_staff.
 */
export function TeamRolesPanel() {
  const { addToast } = useToast();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("moderator");
  const [busy, setBusy] = useState(false);
  const [lastGranted, setLastGranted] = useState(null);

  async function resolveUserId(rawEmail) {
    const trimmed = rawEmail.trim().toLowerCase();
    if (!trimmed) throw new Error("Email is required.");
    const { data, error } = await supabase
      .from("profiles_with_segment")
      .select("id, email, display_name")
      .ilike("email", trimmed)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("No Mingla profile matches that email.");
    return data;
  }

  async function onGrant({ enabled }) {
    setBusy(true);
    try {
      const profile = await resolveUserId(email);
      await setCommunityStaff({
        userId: profile.id,
        role,
        enabled,
        displayName: displayName.trim() || null,
      });
      setLastGranted({
        email: profile.email || email.trim(),
        role,
        enabled,
        displayName: displayName.trim() || profile.display_name || null,
      });
      addToast({
        variant: "success",
        title: enabled ? "Community role saved" : "Community role disabled",
        description: profile.email || email.trim(),
      });
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not update community staff",
        description: err?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Community roles">
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Moderators and agents for the Host community. Full Mingla admins already
          have publish access via admin status — do not add them here. Support desk
          agents stay on the Support tab.
        </p>
        <div className="grid gap-3 max-w-xl">
          <Input
            label="Teammate email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@usemingla.com"
          />
          <Input
            label="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
            Role
            <select
              className="mt-1 w-full rounded-md border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] px-3 py-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="moderator">Moderator</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={UserPlus}
              loading={busy}
              onClick={() => void onGrant({ enabled: true })}
            >
              Grant / update
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void onGrant({ enabled: false })}
            >
              Disable
            </Button>
          </div>
        </div>
        {lastGranted && (
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
            Last change: {lastGranted.email} → {lastGranted.role}
            {lastGranted.enabled ? " (enabled)" : " (disabled)"}
            {lastGranted.displayName ? ` · ${lastGranted.displayName}` : ""}
          </p>
        )}
      </SectionCard>
    </div>
  );
}
