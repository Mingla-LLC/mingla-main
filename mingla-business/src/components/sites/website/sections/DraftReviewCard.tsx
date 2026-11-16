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

export function DraftReviewCard({ siteId, readOnly, mode, toast }: {
  siteId: string | null;
  readOnly: boolean;
  /** "pages": every Draft with Looks right; "publish": the pages that block publishing. */
  mode: "pages" | "publish";
  toast: (message: string, kind?: "success" | "info" | "warn" | "error") => void;
}): React.ReactElement | null {
  const status = useReviewStatus(siteId);
  const mark = useMarkReviewed(siteId);
  if (status.isLoading || !status.data) {
    return status.isError ? <Banner tone="err" icon="alert" title="We couldn't check which sections need review." body="Try again in a moment." /> : null;
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
            {mode === "pages" && !readOnly ? (
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
