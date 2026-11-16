// #4452 §7.6 — Website pages.
// [TRANSITIONAL] header only — replaced by the page editor in the next #4452 commit on this branch.
import { PageHeader } from "../components/ui/PageHeader";

export function WebsitePagesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Website pages" description="Every public page on usemingla.com is listed here automatically when it ships. New ones get a New tag." />
    </div>
  );
}
