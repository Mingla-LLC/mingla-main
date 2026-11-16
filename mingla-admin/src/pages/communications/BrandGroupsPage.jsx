// #4452 §7.2 — Communications › Brand groups: every host brand's group chat
// with the team, moved out of Community as its own screen. The panel is the
// same component (moved, not rewritten): three columns, realtime, read marks,
// mute, files, Send to Product and the side-panel stack. It keeps exactly the
// access its tab had (the Support area, lib/access.js). Old
// #/community?tab=brand-groups addresses redirect here (lib/adminRoutes.js).
import { Bell } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { BrandGroupsPanel } from "../../components/community/BrandGroupsPanel";
import { publishBrandGroupWaiting } from "../../lib/brandGroupWaiting";

export function BrandGroupsPage() {
  return (
    // #4452 (B2): the page fills the space under the top bar exactly (the
    // shell's gutter above and below is the breathing room), and the
    // workspace takes whatever the header and the summary leave, so the
    // composer never meets the window's edge and the page does not scroll.
    <div data-brand-groups-page="" className="flex h-[calc(100dvh-var(--header-height)-var(--page-gutter)*2)] min-h-[600px] min-w-0 flex-col gap-6">
      <PageHeader
        title="Brand groups"
        description="Every host brand's group chat with the team. Moved here from Support › Community."
        actions={(
          <Button variant="secondary" icon={Bell} onClick={() => { window.location.hash = "#/messages?tab=settings"; }}>
            Notification settings
          </Button>
        )}
      />
      <BrandGroupsPanel onCounts={publishBrandGroupWaiting} />
    </div>
  );
}
