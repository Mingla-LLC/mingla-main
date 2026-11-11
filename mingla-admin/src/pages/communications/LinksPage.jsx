// #4383 — Communications › Links page: the strips on usemingla.com/links.
// Moved out of Support as its own screen; admins and the Support area open it,
// exactly as the tab (lib/access.js PAGE_ADDITIONAL_AREAS.links).
import { PageHeader } from "../../components/ui/PageHeader";
import { LinksPagePanel } from "../../components/links/LinksPagePanel";

export function LinksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Links page"
        description="The strips on usemingla.com/links, in the order they show."
      />
      <LinksPagePanel />
    </div>
  );
}
