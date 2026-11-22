// #4420 — Communications › Feature guide: what is live, with its proof. Moved
// unchanged out of Community as its own screen. It keeps exactly the access
// the Community tab had: the Support area and full admins (lib/access.js
// PAGE_ADDITIONAL_AREAS), and writing evidence and capabilities stays
// admin-only (canManage), as before. The release process reads
// docs/contracts/feature-guide-impact.json and the guide's data, not this
// screen. Old #/community?tab=feature-guide links redirect here.
import { PageHeader } from "../../components/ui/PageHeader";
import { FeatureGuidePanel } from "../../components/community/FeatureGuidePanel";
import { useAuth } from "../../context/AuthContext";
import { communitySupportCapabilities } from "../../lib/communitySupportAccess";

export function FeatureGuidePage() {
  const { access } = useAuth();
  const { isAdmin } = communitySupportCapabilities(access);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature guide"
        description="What is live for hosts and explorers, and the proof behind each claim."
      />
      <FeatureGuidePanel canManage={isAdmin} />
    </div>
  );
}
