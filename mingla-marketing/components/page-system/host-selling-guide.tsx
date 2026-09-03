import type { HostGuideRecord } from '@/content/page-system/shared'
import { GrowthToolEmbed } from './growth-tool-embed'

export function HostSellingGuide({ guide }: { readonly guide: HostGuideRecord }) {
  return (
    <>
      <header className="ps-host-guide-hero">
        <div className="ps-host-guide-copy">
          <div className="ps-host-lockup">
            <img src="/brand/mingla-business-logo.svg" alt="Mingla Host" width="72" height="72" />
            <span>{guide.eyebrow}</span>
          </div>
          <h1>{guide.title}</h1>
          <p>{guide.subhead}</p>
          <a href="#host-guide-tool" className="ps-primary-action">Try the {guide.toolLabel}</a>
        </div>
        <figure className="ps-host-guide-photo">
          <img src={guide.heroMedia.src} alt={guide.heroMedia.alt} width="1600" height="1211" />
          <figcaption>{guide.heroMedia.caption}</figcaption>
        </figure>
      </header>

      <section className="ps-host-tips" aria-labelledby="host-tips-heading">
        <header><p className="ps-eyebrow">Three things that make the {guide.creationNoun} easier to sell</p><h2 id="host-tips-heading">Clear beats complicated.</h2></header>
        <ol>
          {guide.tips.map((tip, index) => (
            <li key={tip.title}><span>{index + 1}</span><h3>{tip.title}</h3><p>{tip.detail}</p></li>
          ))}
        </ol>
      </section>

      <section id="host-guide-tool" className="ps-growth-tool" aria-labelledby="growth-tool-heading">
        <header>
          <p className="ps-eyebrow">Live Mingla growth tool</p>
          <h2 id="growth-tool-heading">Pressure-test the plan with the {guide.toolLabel}.</h2>
          <p>This is the same working tool available on Mingla’s public tools page, embedded here so the guide stays practical.</p>
        </header>
        <div className="ps-growth-tool-frame"><GrowthToolEmbed tool={guide.toolKey} /></div>
        <p className="ps-tool-limitation">{guide.limitation}</p>
      </section>

      <section className="ps-host-conversion" aria-labelledby="host-conversion-heading">
        <div><p className="ps-eyebrow">Ready to publish?</p><h2 id="host-conversion-heading">Put the {guide.creationNoun} where people can understand and join it.</h2></div>
        <a href={guide.hostUrl} className="ps-primary-action">{guide.hostAction}</a>
      </section>
    </>
  )
}
