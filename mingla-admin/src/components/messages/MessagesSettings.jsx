// Issue #4255 (W4, D14) — the Settings tab of Messages: one table, the same
// switches as the Host app's Mingla team settings. Columns In app, Host app
// push and Email.
//   * In app and push are notification_channel_prefs rows for the team
//     categories, keyed by the signed-in auth user (the same rows the Host
//     app reads and writes).
//   * Email is the per-alert email setting it always was (#3988,
//     issue_3988_set_email_alert_preference): Mentions email stays on unless
//     switched off (#4255), and every other email alert keeps its row here.
//     These are the old Email settings, moved; nothing resets.
import { useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";
import { LoadError } from "../ui/LoadError";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useServerRead } from "../../hooks/useServerRead";
import { announceMessagesChange } from "../../hooks/useMessages";
import * as collaboration from "../../services/teamCollaborationService";
import * as team from "../../services/teamChatService";
import { emailAlertRows } from "../../lib/emailAlerts";
import { SETTING_ROWS, teamPrefOn } from "../../lib/messagesModel";
import { opsErrorWords } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
export const HOST_APP_URL = "https://host.usemingla.com";
const COLUMNS = ["In app", "Host app push", "Email"];

function Switch({ on, label, disabled, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative mx-auto inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-40 ${on ? "bg-[var(--color-brand-500)]" : "bg-[var(--gray-300)]"} ${FOCUS}`}>
      <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function MessagesSettings() {
  const { addToast } = useToast();
  const { session } = useAuth();
  const userId = session?.user?.id || null;
  const email = session?.user?.email || "";
  const [saving, setSaving] = useState(null);
  const [emailRows, setEmailRows] = useState(null);
  const [prefRows, setPrefRows] = useState(null);

  const loadEmail = useCallback(() => collaboration.getEmailAlertPreferences(), []);
  const emailRead = useServerRead(loadEmail);
  const loadPrefs = useCallback(() => (userId ? team.getTeamPrefs(userId) : Promise.resolve([])), [userId]);
  const prefRead = useServerRead(loadPrefs);
  const alerts = emailRows ?? emailAlertRows(emailRead.data);
  const prefs = prefRows ?? (Array.isArray(prefRead.data) ? prefRead.data : []);
  const loading = emailRead.status === "loading" || prefRead.status === "loading";
  const error = emailRead.status === "error" ? emailRead.error : prefRead.status === "error" ? prefRead.error : null;
  const retry = () => { setEmailRows(null); setPrefRows(null); emailRead.retry(); prefRead.retry(); };

  const setPref = async (key, channel, on, label) => {
    if (!userId) return;
    setSaving(`${key}:${channel}`);
    try {
      await team.setTeamPref(userId, key, channel, on);
      const next = await team.getTeamPrefs(userId);
      setPrefRows(Array.isArray(next) ? next : []);
      announceMessagesChange();
    } catch (err) {
      addToast({ variant: "error", title: `Couldn’t change “${label}”`, description: `${opsErrorWords(err)} Nothing was changed.` });
    } finally { setSaving(null); }
  };
  const setEmail = async (alertKey, enabled, label) => {
    setSaving(`${alertKey}:email`);
    try {
      const next = await collaboration.setEmailAlertPreference(alertKey, enabled);
      setEmailRows(emailAlertRows(next));
    } catch (err) {
      addToast({ variant: "error", title: `Couldn’t change “${label}”`, description: err?.message || "Nothing was changed. Try again." });
    } finally { setSaving(null); }
  };
  const emailOf = (key) => alerts.find((a) => a.key === key) || null;
  const otherAlerts = alerts.filter((a) => !SETTING_ROWS.some((r) => r.email === a.key));

  return (
    <div data-messages-settings="" className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex min-w-0 gap-2.5 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-3 text-[12.5px] text-[var(--color-text-secondary)]">
        <span aria-hidden="true" className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--gray-900)] text-[12px] font-bold text-white">M</span>
        <span className="min-w-0">
          <b className="text-[var(--color-text-primary)]">Pushes go to the Mingla Host app</b>
          <br />Signed in there{email ? ` as ${email}` : ""}, you get Mingla team pushes on your phone. Without it you still get them here and by email.{" "}
          <a href={HOST_APP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-[var(--color-brand-700)] hover:underline">Get the Host app<ExternalLink aria-hidden="true" className="h-3 w-3" /></a>
        </span>
      </div>
      {error ? (
        <LoadError title="Couldn’t load your settings" message={opsErrorWords(error)} onRetry={retry} />
      ) : loading && !prefRows && !emailRows ? (
        <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">Loading your settings…</p>
      ) : (
        <>
          <table className="w-full table-fixed border-collapse text-[13px]">
            <caption className="sr-only">Notify me about</caption>
            <thead>
              <tr className="text-[11.5px] text-[var(--color-text-tertiary)]">
                <th scope="col" className="pb-1.5 text-left font-semibold">Notify me about</th>
                {COLUMNS.map((c) => <th key={c} scope="col" className="w-[4.5rem] pb-1.5 text-center font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {SETTING_ROWS.map((row) => {
                const mail = row.email ? emailOf(row.email) : null;
                return (
                  <tr key={row.key} data-setting={row.key} className="border-t border-[var(--gray-100)]">
                    <th scope="row" className="py-2 pr-2 text-left font-medium text-[var(--color-text-primary)]">{row.label}<small className="block text-[11.5px] font-normal text-[var(--color-text-tertiary)]">{row.hint}</small></th>
                    {["inapp", "push"].map((channel, i) => (
                      <td key={channel} className="py-2 text-center">
                        {(row.channels || ["inapp", "push"]).includes(channel) ? (
                          <Switch on={teamPrefOn(prefs, row.key, channel)} label={`${row.label}: ${COLUMNS[i]}`} disabled={saving !== null || !userId}
                            onChange={(on) => setPref(row.key, channel, on, row.label)} />
                        ) : <span className="text-[11.5px] text-[var(--color-text-tertiary)]" aria-label={`${row.label}: not ${COLUMNS[i].toLowerCase()}`}>—</span>}
                      </td>
                    ))}
                    <td className="py-2 text-center">
                      {mail ? <Switch on={mail.enabled} label={`${row.label}: Email`} disabled={saving !== null} onChange={(on) => setEmail(mail.key, on, mail.label)} />
                        : <span className="text-[11.5px] text-[var(--color-text-tertiary)]" aria-label={`${row.label}: no email`}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {otherAlerts.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Email alerts</h3>
              <ul className="flex flex-col">
                {otherAlerts.map((row) => (
                  <li key={row.key} data-alert-key={row.key} className="flex min-w-0 items-center gap-3 border-t border-[var(--gray-100)] py-2">
                    <span className="min-w-0 flex-1 text-[13px] font-medium text-[var(--color-text-primary)]">{row.label}<small className="block text-[11.5px] font-normal text-[var(--color-text-tertiary)]">{row.description}</small></span>
                    <span className="w-[4.5rem] shrink-0 text-center"><Switch on={row.enabled} label={`${row.label}: Email`} disabled={saving !== null} onChange={(on) => setEmail(row.key, on, row.label)} /></span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* #4255: Mentions (work card) email is on by default too, so one
              rule covers every alert. */}
          <p className="mt-3 text-[11.5px] text-[var(--color-text-tertiary)]">Every alert emails you unless you switch it off here. Changes on cards you watch stay in the app.</p>
          <p className="mt-1 text-[11.5px] text-[var(--color-text-tertiary)]"><span aria-hidden="true" className="text-[var(--color-success-600)]">● </span>One set of settings: changing it here changes it in the Host app too.</p>
        </>
      )}
    </div>
  );
}
