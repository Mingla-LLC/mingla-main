// Issue #4130 (Wave 3) — what an admin can do to a person, and only on the server.
//
// Pure module: no React, no Supabase import. peopleService.js hands in the
// app's client; a node test hands in a stand-in and proves the rule below.
//
// The rule: a ban, an unban, closing a business account and marking someone
// as staff or test each run as ONE audited admin RPC. If the server refuses,
// the error is shown and nothing else happens. This module never reads or
// writes a table, never calls an edge function and never "finishes the job"
// from the browser. (The old Users page fell back to deleting rows table by
// table from the browser when the server said no; that is gone.)
//
// Permanent deletion of a whole account is not offered: no admin server step
// for it exists yet, and the `delete-user` edge function deletes the signed-in
// caller's own account, so it is never called from admin.

/** Plain-English copy for a refused or failed action. */
export function personActionErrorMessage(error) {
  const msg = typeof error?.message === "string" ? error.message : "";
  if (msg.includes("not_authorized")) return "You don't have permission to do this. Nothing was changed.";
  if (msg.includes("reason_required")) return "Add a reason first. Nothing was changed.";
  if (msg.includes("not_found")) return "This person no longer exists. Nothing was changed.";
  return "The server didn't make this change, so nothing was changed. Try again, or ask engineering if it keeps failing.";
}

/**
 * The person actions, bound to a client with an `rpc(name, params)` method that
 * resolves to { data, error }. Every action resolves to the server's data or
 * throws an Error whose message is safe to show.
 */
export function createPersonActions(client) {
  async function call(rpcName, params) {
    let result;
    try {
      result = await client.rpc(rpcName, params);
    } catch (error) {
      throw new Error(personActionErrorMessage(error));
    }
    if (!result || result.error) throw new Error(personActionErrorMessage(result?.error));
    return result.data;
  }

  function requireReason(reason) {
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(personActionErrorMessage({ message: "reason_required" }));
    }
    return reason.trim();
  }

  return Object.freeze({
    /** Stop someone using Mingla (profiles.active = false), audited. */
    async ban(userId, reason) {
      return call("admin_set_user_active", { p_user_id: userId, p_active: false, p_reason: requireReason(reason) });
    },
    async unban(userId, reason) {
      return call("admin_set_user_active", { p_user_id: userId, p_active: true, p_reason: requireReason(reason) });
    },
    /** Close (soft-delete) the person's business account, audited. Restorable. */
    async deleteBusinessAccount(userId, reason) {
      return call("admin_set_account_deleted", { p_user_id: userId, p_deleted: true, p_reason: requireReason(reason) });
    },
    /** Mark or unmark staff and test, audited. */
    async setInternal(userId, internal, reason) {
      return call("admin_set_internal_account", {
        p_user_id: userId,
        p_internal: internal === true,
        p_reason: requireReason(reason),
      });
    },
  });
}

/** The typed word each destructive action asks for. */
export const CONFIRM_WORDS = Object.freeze({ ban: "BAN", deleteBusinessAccount: "DELETE" });
