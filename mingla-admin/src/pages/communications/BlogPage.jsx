// #4383 — Communications › Blog: posts on usemingla.com/blog. Moved out of
// Support as its own screen; every teammate opens it, exactly as the tab
// (lib/access.js PAGE_ADDITIONAL_AREAS.blog). A post with a future publish
// time already goes live by itself (read-time visibility, #4137), so the
// header only shows how many are scheduled, from the list's own counts.
import { useCallback, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { BlogPanel } from "../../components/blog/BlogPanel";

export function BlogPage() {
  const [scheduled, setScheduled] = useState(null);
  const onCounts = useCallback((_inReview, counts) => {
    const next = Number(counts?.scheduled);
    setScheduled(Number.isFinite(next) ? next : null);
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Blog"
        description="Posts on usemingla.com/blog. A post with a future publish time goes live by itself."
        meta={scheduled ? <Badge variant="info">{scheduled} scheduled</Badge> : null}
      />
      <BlogPanel onCounts={onCounts} />
    </div>
  );
}
