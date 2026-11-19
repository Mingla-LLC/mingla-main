import React from "react";
import { StyleSheet, View } from "react-native";
import { Banner, Card, CardTitle, Chip, Hint, ListBox, Row, RowText, WButton } from "../ui";
import { useMarkReviewed, useReviewStatus, type ReviewPageRow } from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { draftChipLabel } from "../../../../../../packages/site-contracts/src/publishChecks.ts";

/*
 * #4453 (spec v1 §4.3) — sections the composer or Ari wrote are Draft until
 * a brand member says they look right. Publishing waits for every Draft on an
 * enabled page (UNREVIEWED_SECTIONS); nothing is reviewed automatically.
 * Shown on Pages (per page, per section) and on Publish (the blocking pages).
 */

const SECTION_NAMES: Record<string, string> = {
  hero: "Opening section", rich_text: "Text", offering_grid: "Upcoming list", offering_history: "Past trips",
  testimonials: "Reviews", faq: "Questions", feature_cards: "What makes you different", destination_grid: "Places",
  story_grid: "Stories", gallery: "Photos", newsletter_signup: "Sign-up", contact_form: "Question form",
  contact_details: "Contact details", page_header: "Page heading", cta: "Button", marquee: "Ticker",
  venue_reservation: "Reservations", menu_board: "Menu", hours_location: "Hours and location",
};

export function sectionName(type: string): string {
  return SECTION_NAMES[type] ?? "Section";
}

export function reviewCountLabel(count: number): string {
  return count === 1 ? "1 section to review" : `${count} sections to review`;
}

export function DraftReviewCard({ siteId, proofEnabled, readOnly, mode, toast }: {
  siteId: string | null;
  /** SITES_PROOF_PART, from the plan read (WebsiteContext.plan): only decides whether a failed check is shown. */
  proofEnabled: boolean;
  readOnly: boolean;
  /** "pages": every Draft with Looks right; "publish": the pages that block publishing. */
  mode: "pages" | "publish";
  toast: (message: string, kind?: "success" | "info" | "warn" | "error") => void;
}): React.ReactElement | null {
  /*
   * #4453 — the review card follows the Drafts, not the flag: only CREATING
   * Drafts is behind SITES_PROOF_PART. If the flag goes off while Drafts
   * exist, publishing still refuses them (UNREVIEWED_SECTIONS), so the owner
   * must still see them and clear them here. Core's review_status and
   * mark_reviewed are deliberately not flag-gated. With the flag off a failed
   * check shows nothing (P3-3): there is normally nothing to review.
   */
  const status = useReviewStatus(siteId);
  const mark = useMarkReviewed(siteId);
  if (status.isLoading || !status.data) {
    return status.isError && proofEnabled ? <Banner tone="err" icon="alert" title="We couldn't check which sections need review." body="Try again in a moment." /> : null;
  }
  const pages = status.data.pages.filter((page) => page.enabled && page.count > 0);
  if (!pages.length) return null;

  const onMark = (page: ReviewPageRow, blockIds: string[] | "all") => {
    mark.mutate({ pageId: page.id, blockIds }, {
      onError: (error) => toast(error instanceof BrandSitesError ? error.message : "That didn't save. Try again.", "error"),
    });
  };

  return (
    <Card testID={`draft-review-${mode}`}>
      <CardTitle>{mode === "publish" ? "Review these sections before you publish" : reviewCountLabel(status.data.total)}</CardTitle>
      <Hint>
        {mode === "publish"
          ? "Mingla built these from your answers or Ari wrote them. Check each one and tap Looks right, or change it first."
          : "Check each section Mingla or Ari wrote. Your site can be published once every one looks right."}
      </Hint>
      {pages.map((page) => (
        <View key={page.id} style={styles.page}>
          <Row>
            <RowText title={page.title} lines={[reviewCountLabel(page.count)]} />
            {/* On Publish too: a refused publish always has a way out here. */}
            {!readOnly ? (
              <WButton label="Mark all as reviewed" size="sm" variant="ghost" icon="check" onPress={() => onMark(page, "all")} disabled={mark.isPending} accessibilityLabel={`Mark all on ${page.title} as reviewed`} testID="draft-review-mark-all" />
            ) : null}
          </Row>
          {mode === "pages" ? (
            <ListBox>
              {page.blocks.map((block) => (
                <Row key={block.id} testID="draft-review-section">
                  <RowText title={sectionName(block.type)} lines={[<Chip key="chip" label={draftChipLabel(block.source)} tone="warn" />]} />
                  {!readOnly ? (
                    <WButton label="Looks right" size="sm" icon="check" onPress={() => onMark(page, [block.id])} disabled={mark.isPending} accessibilityLabel={`${sectionName(block.type)} on ${page.title} looks right`} testID="draft-review-looks-right" />
                  ) : null}
                </Row>
              ))}
            </ListBox>
          ) : null}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { gap: 8, marginTop: 12 },
});
