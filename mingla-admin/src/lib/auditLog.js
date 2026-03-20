/**
 * Audit Logging Utility
 * Logs admin actions to admin_audit_log table.
 * CRITICAL: Never blocks the primary action — all errors are caught and logged to console.
 */
import { supabase } from "./supabase";

export async function logAdminAction(action, targetType, targetId, metadata = {}) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    await supabase.from("admin_audit_log").insert({
      admin_email: session.user.email,
      action,
      target_type: targetType,
      target_id: targetId != null ? String(targetId) : null,
      metadata,
    });
  } catch (err) {
    // Never block the primary action
    console.error("Audit log failed:", err);
  }
}

/**
 * Human-readable labels for audit actions.
 * Used by the Recent Activity section on the Overview page.
 */
export const ACTION_LABELS = {
  "user.ban": "Banned user",
  "user.unban": "Unbanned user",
  "user.delete": "Deleted user",
  "user.edit": "Edited user",
  "subscription.grant_override": "Granted subscription override",
  "subscription.revoke_override": "Revoked subscription override",
  "content.toggle_active": "Toggled content visibility",
  "content.edit": "Edited content",
  "content.delete": "Deleted content",
  "config.create": "Created config",
  "config.update": "Updated config",
  "config.delete": "Deleted config",
  "admin.invite": "Invited admin",
  "admin.accept": "Accepted admin invite",
  "admin.revoke": "Revoked admin access",
  "email.send": "Sent email",
  "seed.run": "Ran database script",
  "place.import": "Imported places",
  "place.toggle_active": "Toggled place visibility",
  "place.edit": "Edited place",
  "feedback.update_status": "Updated feedback status",
  "report.update_status": "Updated report status",
  "photo.backfill": "Triggered photo backfill",
  "city.launch": "Launched city",
  "city.import": "Imported city places",
  "place.stale_deactivate": "Deactivated stale place",
  "place.stale_reactivate": "Reactivated stale place",
  "place.stale_bulk_deactivate": "Bulk deactivated stale places",
  "place.batch_refresh": "Batch refreshed stale places",
  "place.refresh_single": "Refreshed single place",
};
