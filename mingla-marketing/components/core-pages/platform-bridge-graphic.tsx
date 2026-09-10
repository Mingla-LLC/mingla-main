import { ArrowRight } from 'lucide-react'

export function PlatformBridgeGraphic() {
  return (
    <div className="core-platform-graphic" aria-label="Mingla connects Explorer and Host">
      <div><img src="/brand/mingla-logo-white-on-orange.png" alt="" /><strong>Explorer</strong><span>Choose · Save · Share</span></div>
      <ArrowRight aria-hidden="true" />
      <div><img src="/brand/mingla-business-logo.png" alt="" /><strong>Mingla Host</strong><span>Publish · Promote · Run</span></div>
    </div>
  )
}
