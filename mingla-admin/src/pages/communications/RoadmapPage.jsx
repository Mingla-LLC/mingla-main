// #4383 — Communications › Roadmap: what hosts see on the public roadmap.
// Moved out of Community as its own screen; it keeps the access the Community
// tab had (full admins, lib/access.js default). #/community?tab=roadmap&card=
// and #/community-support?tab=roadmap&card= links redirect here, card kept.
import { PageHeader } from "../../components/ui/PageHeader";
import { RoadmapPanel } from "../../components/community/RoadmapPanel";

export function RoadmapPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        description={"What hosts see on the public roadmap. Cards and the \u201croadmap changed\u201d notice can both be scheduled."}
      />
      <RoadmapPanel />
    </div>
  );
}
