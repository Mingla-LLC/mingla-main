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
  "claim.mark_called": "Marked venue claim as called",
  "claim.approve": "Approved venue claim",
  "claim.reject": "Rejected venue claim",
  "claim.need_more_info": "Requested more info on venue claim",
  // Issue #3802 — team changes. These rows are written by the server.
  "team.invite": "Invited a teammate",
  "team.invite_resend": "Resent an invite",
  "team.role_change": "Changed a teammate's role",
  "team.remove": "Removed a teammate's access",
  "team.restore": "Restored a teammate's access",
  "team.activate": "Accepted an invite",
  "team.status_change": "Changed a teammate's status",
  // Issue #3802 (Wave 1): Hosts and Creators pipelines.
  "crm.record_create": "Added a host or creator",
  "crm.record_update": "Edited a host or creator",
  "crm.stage_move": "Moved a card",
  "crm.stage_undo": "Undid a move",
  "crm.stage_auto_live": "A host went live",
  "crm.owners_set": "Changed owners",
  "crm.log_add": "Logged activity",
  "crm.record_delete": "Deleted a host or creator",
  "crm.record_restore": "Restored a host or creator",
  "crm.bulk_create": "Added records in bulk",
  "crm.target_set": "Set a monthly target",
  "crm.target_remove": "Removed a monthly target",
  "crm.beta_lead_add": "Added a beta lead to Hosts",
  "crm.beta_lead_convert": "Added a beta lead to Hosts",
  "crm.beta_lead_link": "Linked a beta lead to a host",
};
