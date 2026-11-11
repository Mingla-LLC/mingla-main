// #4383 — Communications › Announcements: what every host sees on Host Home,
// in their bell and as a push. Moved out of Community as its own screen; it
// keeps the access the Community tab had (full admins, lib/access.js default).
import { Plus } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { AnnouncementsPanel } from "../../components/community/AnnouncementsPanel";
import { FailedPushBanner } from "../../components/community/FailedPushBanner";

export const NEW_ANNOUNCEMENT_EVENT = "community:new-announcement";

export function AnnouncementsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="What every host sees on Host Home, in their bell and as a push. Publish now or pick a time."
        actions={
          <Button icon={Plus} onClick={() => window.dispatchEvent(new CustomEvent(NEW_ANNOUNCEMENT_EVENT))}>
            New announcement
          </Button>
        }
      />
      <FailedPushBanner />
      <AnnouncementsPanel />
    </div>
  );
}
