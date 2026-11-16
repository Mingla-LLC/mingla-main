// #4452 §7.4 — the forms kit: the REAL marketing field kit and pop-up, bundled
// into mingla-admin/public/forms-kit/ at Admin build time
// (mingla-admin/scripts/build-forms-kit.mjs) and drawn in the builder's
// preview iframe (srcdoc, sandboxed: scripts only, an opaque origin, no
// cookies, no network calls: the form is always in preview mode, so Send
// never reaches forms-submit and nothing is tracked).
//
// The builder posts {type:"mingla-forms-kit", form, device} to the frame; the
// kit only listens to its own parent window.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PopupDialog } from '../popup-dialog'
import { FormRenderer, type RendererForm } from '../form-renderer'
import { FormLook } from '../form-look'
import { designOf } from '@/lib/forms/design'

type Device = 'desktop' | 'phone' | 'visitor'
interface KitMessage { type: 'mingla-forms-kit'; form: RendererForm & { name: string }; device: Device }

function Stage({ msg }: { msg: KitMessage }) {
  const [done, setDone] = useState<{ id: string; first: string | null } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [closed, setClosed] = useState(false)
  const form = { ...msg.form, preview: true }
  const design = designOf(form.design)
  const phone = msg.device === 'phone'
  useEffect(() => { setDone(null); setClosed(false) }, [msg.device, design.layout])
  if (closed) {
    return <div className="kit-closed"><p>The visitor closed it.</p><button type="button" className="fk-send" onClick={() => { setClosed(false); setDone(null) }}>Show it again</button></div>
  }
  if (design.layout === 'inline' || design.layout === 'page') {
    return (
      <div className={`kit-page kit-${design.layout}${phone ? ' kit-phone' : ''}`}>
        <div className="kit-card">
          {!phone && design.layout === 'inline' ? <FormLook design={design} /> : null}
          <div className="kit-card-form">
            <h2 className="pu-title">{design.head} {design.em ? <em>{design.em}</em> : null}</h2>
            {done ? <p className="fk-help">Sent (preview: nothing was submitted).</p> : (
              <FormRenderer form={form} placement={design.layout === 'page' ? 'form_page' : 'inline'} sendLabel={design.send}
                onDone={(o, first) => setDone({ id: o.submissionId, first })} />
            )}
          </div>
        </div>
      </div>
    )
  }
  const style = phone ? 'sheet' : design.layout === 'side' ? 'side' : 'centre'
  return (
    <PopupDialog framed style={style} form={form} block={{ id: 'preview', head: undefined, em: undefined }}
      confirmClose={confirm} onKeepGoing={() => setConfirm(false)}
      onClose={(how) => { if (how === 'done' || how === 'not_now' || how === 'close_button' || how === 'esc') { setConfirm(false); setClosed(true) } }}
      done={done} onDone={(o, first) => setDone({ id: o.submissionId, first })} />
  )
}

function Kit() {
  const [msg, setMsg] = useState<KitMessage | null>(null)
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      const data = e.data as KitMessage
      if (data && data.type === 'mingla-forms-kit' && data.form && Array.isArray(data.form.fields)) setMsg(data)
    }
    window.addEventListener('message', on)
    window.parent.postMessage({ type: 'mingla-forms-kit-ready' }, '*')
    return () => window.removeEventListener('message', on)
  }, [])
  if (!msg) return <p className="kit-wait">Loading the preview…</p>
  return <Stage msg={msg} />
}

const el = document.getElementById('kit')
if (el) createRoot(el).render(<Kit />)
