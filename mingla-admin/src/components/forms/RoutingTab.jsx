// #4452 A1.3 / §7.4 "Leads and lead label" tab: every submission goes to Leads
// with its label (locked); "Also create a pipeline card" is off by default and,
// when on, fixes the pipeline by the label (never for Local, R-25), offers the
// owner (R-26) and matches people by email. The lead label, the Lead to ad
// platforms toggle, the end goal and the privacy note.
import { useEffect, useState } from "react";
import { Select } from "../ui/Input";
import { LabelPill, Panel, ToggleRow } from "./formsUi";
import { GOALS, GOAL_LATER_HINT, NO_LOCALS_PIPELINE, PIPELINE_FOR, setAudience, setCard } from "../../lib/formsModel";
import { crmChoices } from "../../services/formsService";

export function RoutingTab({ def, edit, canEdit }) {
  const card = def.routing?.card || { on: false };
  const pipeline = PIPELINE_FOR[def.audience];
  const [team, setTeam] = useState([]);
  useEffect(() => {
    let live = true;
    if (!card.on || !card.pipeline) return undefined;
    crmChoices(card.pipeline).then((c) => { if (live) setTeam(c.team); }, () => { if (live) setTeam([]); });
    return () => { live = false; };
  }, [card.on, card.pipeline]);
  const owner = def.routing?.owner || { mode: "unassigned", emails: [] };
  const setOwner = (o) => edit({ ...def, routing: { ...def.routing, owner: o.mode === "unassigned" ? undefined : o } });
  const goal = def.ads?.goal || "none";

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-routing-tab="">
      <Panel title="Where answers go">
        <div className="flex flex-col gap-3">
          <ToggleRow title="Every submission goes to Leads with its label." hint="One person is one lead, whatever they send." checked disabled onChange={() => {}} />
          <ToggleRow title="Also create a pipeline card" data-card-switch=""
            hint={pipeline ? `Adds them to ${pipeline === "hosts" ? "Hosts" : "Creators"} too. Off by default: Leads is the home.` : NO_LOCALS_PIPELINE}
            checked={Boolean(card.on)} disabled={!canEdit || !pipeline} onChange={(v) => edit(setCard(def, v))} />
          {card.on && (
            <>
              <Select label="Pipeline" value={card.pipeline} disabled options={[{ value: "hosts", label: "Hosts" }, { value: "creators", label: "Creators" }]} helper="Fixed by the lead label." />
              <Select label="Owner" value={owner.mode} disabled={!canEdit} onChange={(e) => setOwner({ mode: e.target.value, emails: e.target.value === "unassigned" ? [] : owner.emails?.slice(0, e.target.value === "person" ? 1 : 10) || [] })}
                options={[{ value: "unassigned", label: "Unassigned" }, { value: "person", label: "A person" }, { value: "round_robin", label: "Round robin" }]} />
              {owner.mode === "person" && (
                <Select label="Person" value={owner.emails?.[0] || ""} disabled={!canEdit} placeholder="Pick someone" onChange={(e) => setOwner({ mode: "person", emails: e.target.value ? [e.target.value] : [] })}
                  options={team.map((t) => ({ value: t.email, label: t.name }))} />
              )}
              {owner.mode === "round_robin" && (
                <fieldset className="grid gap-1.5" aria-label="Round robin people">
                  <legend className="mb-1 text-[12.5px] font-semibold text-[var(--a-text2)]">Pick two or more</legend>
                  {team.map((t) => (
                    <label key={t.email} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--a-text)]" disabled={!canEdit} checked={(owner.emails || []).includes(t.email)}
                        onChange={(e) => setOwner({ mode: "round_robin", emails: e.target.checked ? [...(owner.emails || []), t.email] : (owner.emails || []).filter((x) => x !== t.email) })} />
                      {t.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <ToggleRow title="Match people by email" hint="An existing card gets a note, not a duplicate." checked disabled onChange={() => {}} />
            </>
          )}
        </div>
      </Panel>
      <Panel title="Lead label for ads">
        <div className="flex flex-col gap-3">
          <Select label="This form's leads are" value={def.audience} disabled={!canEdit} onChange={(e) => edit(setAudience(def, e.target.value))}
            options={[{ value: "host", label: "Host lead" }, { value: "creator", label: "Creator lead" }, { value: "local", label: "Local lead" }]} />
          <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]"><LabelPill label={def.audience} /> is what Meta, Google, TikTok, Snap and Reddit receive.</p>
          <ToggleRow title="Send a Lead to ad platforms" hint="Server and pixel share one event id, so it counts once." checked={def.ads?.lead_on !== false} disabled={!canEdit}
            onChange={(v) => edit({ ...def, ads: { ...def.ads, lead_on: v } })} />
          <Select label="End goal (what we really want)" value={goal} disabled={!canEdit} onChange={(e) => edit({ ...def, ads: { ...def.ads, goal: e.target.value } })}
            options={GOALS.map((g) => ({ value: g.id, label: g.label }))}
            helper={goal === "app_signup" || goal === "approved" ? GOAL_LATER_HINT : "Sent as its own result (Meta Schedule, a Google conversion per label), credited to the same ad click as the lead."} />
          <p className="rounded-xl bg-[var(--a-soft)] px-3 py-2 text-xs text-[var(--a-text2)]"><b>Privacy:</b> if the visitor turned ads off in the privacy strip, no pixel fires and no browser ids are kept; the server Lead goes without them.</p>
        </div>
      </Panel>
    </div>
  );
}
