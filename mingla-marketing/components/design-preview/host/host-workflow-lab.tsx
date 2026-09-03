'use client'
import { CheckCircle2, QrCode, Upload } from 'lucide-react'
import { AriInput } from '@/components/sections/organiser-home/ari-input'
import { ProvenanceChip } from '@/components/design-preview/system/provenance-chip'
import { ThreeStepDemo, type DemoStep } from '@/components/design-preview/system/three-step-demo'
import { EventPagePreview } from './event-page-preview'
import {
  HOST_BUILD,
  HOST_MEASURE,
  HOST_PROMOTE,
  type HostCapability,
} from '@/lib/design-preview/host-truth'

// #2902 — the Host proof lab: build → promote → run.
//
// Every claim rendered here comes from `host-truth.ts`, where each one carries
// the repo path that proves it ships. The evidence path is printed under the
// claim. That is unusual on a marketing page and it is the point: a Host
// landing page that names its receipts is the one an operator believes.

function CapabilityList({ items }: { items: readonly HostCapability[] }) {
  return (
    <ul className="space-y-5">
      {items.map((cap) => (
        <li key={cap.id} className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warm/14"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-warm" strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base leading-tight text-white">{cap.title}</p>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/60">{cap.body}</p>
            <p className="mt-2 truncate font-dashboard text-[11px] text-white/32" title={cap.evidence}>
              {cap.evidence}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function PanelShell({
  left,
  right,
}: {
  left: React.ReactNode
  right: React.ReactNode
}) {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14">
      <div>{left}</div>
      <div className="flex justify-center lg:justify-end">{right}</div>
    </div>
  )
}

/** Step 2's right-hand surface — a campaign send, drawn as product chrome. */
function CampaignPanel() {
  const rows = [
    { label: 'Imported from your phone book', value: '1,284 contacts' },
    { label: 'Came to your last two nights', value: '317 guests' },
    { label: 'Opted in to hear about the next one', value: '289 people' },
  ]
  return (
    <div className="w-full max-w-[22rem] rounded-2xl bg-white p-5 ring-1 ring-[rgba(14,14,16,0.06)]" style={{ boxShadow: 'var(--elev-3)' }}>
      <div data-theme="light" className="font-dashboard">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Your list
          </span>
          <ProvenanceChip kind="illustrative" variant="bare" />
        </div>
        <ul className="mt-4 space-y-2.5">
          {rows.map((r) => (
            <li
              key={r.label}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-black/[0.015] px-3.5 py-2.5"
            >
              <span className="min-w-0 truncate text-[12px] text-text-secondary">{r.label}</span>
              <span className="shrink-0 text-[13px] font-bold tabular-nums text-text-primary">
                {r.value}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-xl bg-warm/[0.07] px-3.5 py-3">
          <p className="text-[12px] font-semibold text-text-primary">
            “Basement Sessions is back — 4 October”
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            Sends from Mingla with click tracking and a working unsubscribe on every message.
          </p>
        </div>
      </div>
    </div>
  )
}

/** Step 3's right-hand surface — the door. */
function DoorPanel() {
  return (
    <div className="w-full max-w-[22rem] rounded-2xl bg-white p-5 ring-1 ring-[rgba(14,14,16,0.06)]" style={{ boxShadow: 'var(--elev-3)' }}>
      <div data-theme="light" className="font-dashboard">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
            <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
            At the door
          </span>
          <ProvenanceChip kind="illustrative" variant="bare" />
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-bold leading-none tabular-nums text-text-primary">184</span>
          <span className="text-sm font-semibold text-text-muted">/ 232 checked in</span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
          <span
            className="block h-full rounded-full"
            style={{ width: '79%', background: 'var(--color-warm)' }}
          />
        </div>
        <ul className="mt-5 space-y-2">
          {[
            ['General admission', '142 / 176'],
            ['Early release', '38 / 44'],
            ['Table of six', '4 / 12'],
          ].map(([label, value]) => (
            <li key={label} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="text-text-secondary">{label}</span>
              <span className="font-semibold tabular-nums text-text-primary">{value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 rounded-xl bg-black/[0.02] px-3.5 py-2.5 text-[11px] leading-relaxed text-text-muted">
          Door staff are invited to the scanner only. They can check people in without reaching the
          rest of your Host account.
        </p>
      </div>
    </div>
  )
}

export function HostWorkflowLab() {
  const steps: readonly DemoStep[] = [
    {
      id: 'build',
      label: 'Build it',
      caption:
        'Describe the night in a sentence. Ari turns it into a page with tiers, and the page is what a buyer opens.',
      panel: (
        <PanelShell
          left={
            <div>
              <AriInput className="max-w-lg" />
              <div className="mt-8">
                <CapabilityList items={HOST_BUILD} />
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <ProvenanceChip kind="product-capability" />
                <span className="text-xs leading-relaxed text-white/45">
                  Each line names the file that proves it ships.
                </span>
              </div>
            </div>
          }
          right={<EventPagePreview />}
        />
      ),
    },
    {
      id: 'promote',
      label: 'Promote it',
      caption:
        'The people most likely to come are the ones who came last time. Bring that list with you, then reach past it.',
      panel: (
        <PanelShell
          left={
            <div>
              <CapabilityList items={HOST_PROMOTE} />
            </div>
          }
          right={<CampaignPanel />}
        />
      ),
    },
    {
      id: 'run',
      label: 'Run it',
      caption:
        'Take the money, work the door, and finish the night with a list you keep rather than a number you screenshot.',
      panel: (
        <PanelShell
          left={
            <div>
              <CapabilityList items={HOST_MEASURE} />
            </div>
          }
          right={<DoorPanel />}
        />
      ),
    },
  ]

  return (
    <ThreeStepDemo
      steps={steps}
      polarity="night"
      label="How an event runs on Mingla"
    />
  )
}
