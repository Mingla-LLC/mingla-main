'use client'
// #4452 §2.3 — the inline Form block: heading with its italic ending and a line
// on the left, the form on the right (stacked on phones). A missing or
// archived form renders nothing (the Spot already checked).
import { useState } from 'react'
import { FormRenderer, type RendererForm } from '@/components/forms/form-renderer'
import { SuccessScreen } from '@/components/forms/success-screen'
import type { Block, PublicForm } from '@/lib/site-pages/model'
import { virtualPageView } from '@/components/forms/virtual-page'
import './site-blocks.css'

export function FormBlock({ form, block }: { form: PublicForm; block: Block; pagePath: string | null }) {
  const [done, setDone] = useState<{ id: string; first: string | null } | null>(null)
  return (
    <section className="sb-form" data-site-block="form" aria-labelledby={`sb-${block.id}`}>
      <div className="sb-form-copy">
        <h2 id={`sb-${block.id}`}>{block.head ?? ''} {block.em ? <em>{block.em}</em> : null}</h2>
        {block.sub ? <p>{block.sub}</p> : null}
      </div>
      <div className="sb-form-card">
        {done ? (
          <SuccessScreen audience={form.audience} firstName={done.first} submissionId={done.id} preview={form.preview} />
        ) : (
          <FormRenderer
            form={form as unknown as RendererForm}
            placement="inline"
            spotKey={block.spot}
            blockId={block.id}
            onDone={(o, first) => {
              setDone({ id: o.submissionId, first })
              virtualPageView(`/apply/${form.slug ?? form.key}/thanks`)
            }}
          />
        )}
      </div>
    </section>
  )
}
