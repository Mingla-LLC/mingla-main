// #4636 block `toolCard` — one free tool with the design's preview of its form
// (host-type pages), moved as-is (R1) from icp-landing.tsx. The preview opens
// the tool; the tool asks for these details itself.
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { TOOL_PATH, type ToolName } from '@/content/host-landing/icps'
import { secClass, type BlockProps } from './shared'

export interface ToolCardContent {
  tool: ToolName
  body: string
  cta: string
  fields: readonly { label: string; input: 'text' | 'select'; example: string }[]
}

export function ToolCardBlock({ content: d, colour, blockId }: BlockProps<ToolCardContent>) {
  const toolPath = TOOL_PATH[d.tool]
  return (
    <section className={secClass(colour)} style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="tool reveal">
          <div className="l">
            <h2 className="h2">{d.tool}</h2>
            <p className="lead">{d.body}</p>
            <div className="row" style={{ marginTop: 28 }}>
              <Link className="btn cta" href={toolPath} data-icp-event="icp_tool_card_clicked">
                {d.cta} <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
          <form className="r" action={toolPath} method="get" aria-label={d.tool}>
            {d.fields.map(({ label, input, example }, i) => {
              const id = `${blockId}-${i}`
              return (
                <div className="field" key={label}>
                  <label htmlFor={id}>{label}</label>
                  {input === 'select' ? (
                    <select id={id} defaultValue={example}>
                      <option>{example}</option>
                    </select>
                  ) : (
                    <input id={id} placeholder={example} />
                  )}
                </div>
              )
            })}
            <button className="btn ink" type="submit" style={{ marginTop: 6 }} data-icp-event="icp_tool_card_clicked">
              {d.cta}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
