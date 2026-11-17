import { getRecord, setOwners } from "../services/crmService";

/** An owner as an address: the host card keeps addresses; the inbox sends { email, name }. */
function ownerEmail(owner) {
  return String((typeof owner === "string" ? owner : owner?.email) || "").trim().toLowerCase();
}

/**
 * Assign to me: add me to the host card's owners (the same crm path the host
 * card uses). Kept here, beside the button, so the Brand groups tab itself
 * reaches only Support RPCs (#3988 capability contract).
 *
 * #4270 W7 rework (D-9): crm_record_set_owners replaces the whole list, so the
 * owners are read fresh from the host card right before the write; an owner
 * someone added since this page loaded is kept. A failed read writes nothing.
 * `api` is for tests.
 */
export async function assignHostToMe(host, myEmail, api = { getRecord, setOwners }) {
  const me = String(myEmail || "").trim().toLowerCase();
  if (!host?.record_id || !me) throw new Error("Couldn't tell who you are or which host card this is.");
  const fresh = await api.getRecord(host.record_id);
  const current = fresh?.record?.owners;
  if (!Array.isArray(current)) throw new Error("Couldn't read the host card's owners, so nothing was changed. Try again.");
  const emails = [...new Set([...current.map(ownerEmail).filter(Boolean), me])].sort();
  return api.setOwners(host.record_id, emails);
}
