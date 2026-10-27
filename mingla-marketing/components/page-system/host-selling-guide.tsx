import type { HostGuideRecord } from '@/content/page-system/shared'
import { DeviceCta } from '@/components/cutout'
import { DeviceLink } from '@/components/cutout/device-link'
import { siteAttribution } from '@/lib/links-src'
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
          <div className="ps-host-guide-actions">
            <a href="#host-guide-tool" className="ps-primary-action">Try the {guide.toolLabel}</a>
            <DeviceCta
              surface="host"
              location="page_system_host_guide_hero_app"
              phoneLabel="Download the Host app"
              desktopLabel="Use Mingla Host on web"
              variant="ink"
              className="ps-host-guide-app-action"
            />
          </div>
        </div>
        <figure className="ps-host-guide-photo">
          <img src={guide.heroMedia.src} alt={guide.heroMedia.alt} width="1600" height="1211" />
        </figure>
      </header>

      <section id="host-guide-tool" className="ps-growth-tool" aria-label={`${guide.toolLabel} embedded tool`}>
        <div className="ps-growth-tool-frame"><GrowthToolEmbed tool={guide.toolKey} /></div>
        <p className="ps-tool-limitation">{guide.limitation}</p>
      </section>

      <section className="ps-host-conversion" aria-labelledby="host-conversion-heading">
        <div><p className="ps-eyebrow">Ready to publish?</p><h2 id="host-conversion-heading">Put the {guide.creationNoun} where people can understand and join it.</h2></div>
        {/* #4137: phone → Mingla Host install; computer → the guide's create page. */}
        <DeviceLink
          surface="host"
          attribution={siteAttribution('business_hero')}
          hostComputerHref={guide.hostUrl}
          sameTab
          className="ps-primary-action"
        >
          {guide.hostAction}
        </DeviceLink>
      </section>
    </>
  )
}
