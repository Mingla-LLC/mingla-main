from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
PDF_PATH = ROOT / "MINGLA_SALES_BATTLE_SHEETS_2026-06-24.pdf"
MD_PATH = ROOT / "MINGLA_SALES_BATTLE_SHEETS_2026-06-24.md"
PREVIEW_DIR = ROOT / "sales_battle_sheets_previews_2026-06-24"

DPI = 200
PAGE_W, PAGE_H = int(8.5 * DPI), int(11 * DPI)
M = 72
G = 24

FONT_DIR = Path("/System/Library/Fonts/Supplemental")
FONT_REG = str(FONT_DIR / "Arial.ttf")
FONT_BOLD = str(FONT_DIR / "Arial Bold.ttf")
FONT_ITALIC = str(FONT_DIR / "Arial Italic.ttf")


def font(size: int, bold: bool = False, italic: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT_ITALIC if italic else FONT_REG
    return ImageFont.truetype(path, size)


F = {
    "eyebrow": font(20, bold=True),
    "title": font(36, bold=True),
    "sub": font(19),
    "h": font(22, bold=True),
    "body": font(18),
    "small": font(16),
    "tiny": font(14),
    "quote": font(17, italic=True),
}

COLORS = {
    "ink": (30, 36, 45),
    "muted": (90, 98, 110),
    "line": (205, 210, 218),
    "bg": (248, 249, 251),
    "teal": (0, 112, 116),
    "blue": (37, 86, 156),
    "coral": (184, 72, 64),
    "gold": (158, 116, 30),
    "green": (64, 128, 84),
    "white": (255, 255, 255),
}


BATTLE_SHEETS = [
    {
        "name": "Event-forward independent hospitality operators",
        "buyer": "Owner, GM, marketer, events lead, chef-owner",
        "trigger": "A recurring night, tasting, menu drop, slow shift, private dinner, or local collaboration.",
        "goal": "Turn one real-world moment into a page, QR/link, and measurable booking or lead test within 7 days.",
        "pain": "They create moments people would attend, but attention is scattered across Instagram, flyers, DMs, and reservation tools.",
        "opener": "Saw you already have moments people would go to. How are you turning a post into an actual booking, buyer, or repeat visitor today?",
        "qualify": [
            "What events or offers do you repeat monthly?",
            "Where do interested people drop off: discovery, booking, payment, reminders, or follow-up?",
            "Do you know which posts or partners actually drive foot traffic?",
            "What would make a small test worth keeping next month?",
        ],
        "show": [
            "Start from their actual flyer, menu, or event post.",
            "Show a Mingla page with clear action: reserve, buy, RSVP, or join list.",
            "Show QR/link sharing for staff, tables, Instagram bio, and partner posts.",
            "End on follow-up: buyer list, clicks, bookings, and what to repeat.",
        ],
        "close": "Send me one event, offer, or recurring night and one asset. I will turn it into a page you can approve before we ask you to change anything.",
        "objections": [
            ("We already use OpenTable, Resy, or our website.", "Keep it. Mingla packages one specific moment into a shareable action page and routes people to the right booking or purchase step."),
            ("Instagram is enough for us.", "Instagram creates attention. Mingla captures intent, gives staff a single link or QR, and shows what actually moved people."),
            ("I do not have time to set this up.", "That is exactly why the first ask is one asset and one offer. We draft the page; you approve the facts."),
        ],
        "proof": [
            "Next event/offer published",
            "QR or link used in at least two channels",
            "Bookings, RSVPs, clicks, or buyer list captured",
            "Owner agrees what to repeat or stop",
        ],
        "disqualify": "No recurring moments, no owner or manager access, or unwilling to publish even one low-risk test.",
    },
    {
        "name": "Nightlife and live-entertainment venues",
        "buyer": "Owner, GM, promoter lead, talent buyer, events manager, door lead",
        "trigger": "Upcoming show, DJ night, comedy night, guest list, cover charge, comp list, or door-sale pressure.",
        "goal": "Make one event door-ready with ticket/RSVP flow, guest list clarity, and post-event buyer follow-up.",
        "pain": "Promotion, ticketing, comps, door list, and follow-up often live in separate tools and group chats.",
        "opener": "For the next event, where does the mess show up most: promo, checkout, guest list, comps, scanning, door sales, or follow-up?",
        "qualify": [
            "What is the next event you most need to fill?",
            "How do comps, guests, and walk-ups get reconciled at the door?",
            "Who owns the buyer list after the event: venue, promoter, or no one?",
            "What would prove this is better than the current door flow?",
        ],
        "show": [
            "Use their flyer to build the event page.",
            "Show ticket tiers, RSVP, comp/guest-list logic, and scanner-ready flow.",
            "Show promoter share links and door notes.",
            "Show post-event buyer list and repeat-event follow-up.",
        ],
        "close": "Give me one upcoming event and the current flyer. We will mirror it into a Mingla test without disrupting the door team.",
        "objections": [
            ("We already use Eventbrite, POSH, or Dice.", "If that is working, keep it. Mingla wins when you need local discovery, partner sharing, door context, and repeat-audience ownership around the event."),
            ("Our door team already has a process.", "Good. The test should make the current process clearer, not replace it midstream. We can start as a parallel list or promo page."),
            ("Can you actually bring people?", "We should not promise magic. We can make each partner share measurable and show which channels deserve more effort."),
        ],
        "proof": [
            "Event page live",
            "Ticket/RSVP/guest-list path tested",
            "Door team confirms list usability",
            "Post-event buyer or attendee list captured",
        ],
        "disqualify": "No upcoming events, no authority over door process, or only interested in broad ads with no operational follow-through.",
    },
    {
        "name": "Recurring promoters and community organizers",
        "buyer": "Promoter, community organizer, series curator, meetup host, cultural organizer",
        "trigger": "Weekly or monthly series, repeat audience, manual DMs, fragmented lists, low repeat conversion.",
        "goal": "Move one recurring series into a repeatable event-to-audience loop.",
        "pain": "Every event feels like starting from zero even when the room has already been built before.",
        "opener": "Does each event still feel like starting from zero, even though you have already built this audience before?",
        "qualify": [
            "How often does the series run?",
            "Where are past attendees stored today?",
            "What percent of attendance comes from repeats versus one-off promo?",
            "Who are the best partners or venues for the next three events?",
        ],
        "show": [
            "Build the next event page from the current announcement.",
            "Show ticket/RSVP plus audience capture.",
            "Show how reminders and next-event follow-up work.",
            "Show partner-specific sharing so they know who drove interest.",
        ],
        "close": "Let us migrate one recurring event and use it to build the repeat-audience list you can reuse next month.",
        "objections": [
            ("My audience is on Instagram or WhatsApp.", "That is the top of funnel. Mingla gives those people a place to commit, pay, and be reachable next time."),
            ("I already use Eventbrite.", "Eventbrite can sell a ticket. The question is whether it helps you own the community loop and repeat attendance."),
            ("Setup sounds like extra work.", "The first motion is one event, one page, and one follow-up list. We should prove value before adding complexity."),
        ],
        "proof": [
            "Recurring series page/template created",
            "Past or current audience capture started",
            "Partner/channel links separated",
            "Next-event follow-up ready",
        ],
        "disqualify": "Pure one-off event with no repeat intent, no access to audience/channel, or no willingness to follow up after the event.",
    },
    {
        "name": "Experience, activity, and trip operators",
        "buyer": "Founder, operator, tour host, trip host, activity lead, experience manager",
        "trigger": "Flagship tour, private group request, manual intake, payment friction, logistics-heavy booking.",
        "goal": "Create one flagship experience page that reduces manual messages and captures qualified bookings.",
        "pain": "Interest turns into back-and-forth: itinerary, dates, payment, intake, reminders, and refund rules all need explanation.",
        "opener": "Walk me through what happens between someone being interested and you having payment, intake, and logistics squared away.",
        "qualify": [
            "Which experience is easiest to sell but hardest to administer?",
            "What questions do prospects ask before paying?",
            "What information do you need before the day of the experience?",
            "Where do no-shows, refunds, or confusion usually happen?",
        ],
        "show": [
            "Show one flagship page with itinerary, dates, capacity, price, and requirements.",
            "Show intake questions and payment path.",
            "Show confirmation/reminder content and refund terms.",
            "Show how group/private interest can be captured separately.",
        ],
        "close": "Let us build the flagship experience page first. If it saves messages or captures a booking, then we expand.",
        "objections": [
            ("Our website already explains this.", "The website informs. Mingla packages the experience for action: book, answer intake, share, and follow up."),
            ("Google Forms and Stripe work fine.", "They work as pieces. The test is whether one buyer-ready flow reduces admin time and missed demand."),
            ("Our logistics are too custom.", "Then we start with the most repeatable offer and capture exceptions as intake, not as endless DMs."),
        ],
        "proof": [
            "Flagship page approved",
            "Intake/payment path tested",
            "Fewer manual clarification messages",
            "Qualified inquiry or paid booking captured",
        ],
        "disqualify": "No repeatable offer, unsafe or unclear fulfillment, or unwillingness to publish policies/pricing.",
    },
    {
        "name": "Creator-hosts and micro-community curators",
        "buyer": "Creator, curator, newsletter owner, local tastemaker, micro-community host",
        "trigger": "Audience trust, venue partnership idea, guide, small gathering, paid plan, or collaborative event.",
        "goal": "Turn influence into a measurable plan, guide, RSVP, waitlist, or partner-backed event.",
        "pain": "They influence where people go, but the value disappears into likes, DMs, and screenshots.",
        "opener": "You already influence where people go. What happens after someone says, 'I would go to that'?",
        "qualify": [
            "What local category does your audience trust you for?",
            "Have you ever sent people to a venue or event and wished you could measure it?",
            "Would you rather start with a guide, waitlist, or small hosted event?",
            "Which venue or partner would care about the proof?",
        ],
        "show": [
            "Show a creator-branded guide, plan, or small event page.",
            "Show save/share/RSVP/waitlist capture.",
            "Show partner attribution for venue conversations.",
            "Show how the creator can prove demand without becoming a full-time event operator.",
        ],
        "close": "Let us test one creator-led guide, waitlist, or small-capacity plan and use the proof to approach a venue partner.",
        "objections": [
            ("I do not run events.", "You do not need to start there. A guide or waitlist can prove demand before you host anything."),
            ("My audience is on TikTok or Instagram.", "Great. Mingla is the action layer after the post, where people save, RSVP, join, or buy."),
            ("I am worried about trust or payment.", "Start with a free waitlist or partner-backed page. Earn proof before paid complexity."),
        ],
        "proof": [
            "Guide, plan, or waitlist page live",
            "Creator channel link tracked",
            "Saves, RSVPs, or venue interest captured",
            "Partner conversation started with proof",
        ],
        "disqualify": "No clear local audience, unwilling to share, or wants sponsorship before demonstrating any measurable pull.",
    },
    {
        "name": "Pop-up, market, and temporary experience operators",
        "buyer": "Market organizer, pop-up founder, chef pop-up host, vendor-market operator, temporary venue lead",
        "trigger": "Short-run pop-up, vendor lineup, limited-capacity drop, market day, seasonal activation.",
        "goal": "Capture demand before the event disappears from the feed and give vendors/partners one shareable page.",
        "pain": "Temporary experiences depend on timing; scattered posts and forms make it hard to capture demand quickly.",
        "opener": "How do you capture demand before the pop-up disappears from the feed?",
        "qualify": [
            "What is the next date and capacity?",
            "Who needs to share: vendors, venue, sponsors, creators, or staff?",
            "Do you need attendee RSVPs, ticket sales, vendor info, or waitlist first?",
            "What do you need to know before deciding to repeat it?",
        ],
        "show": [
            "Show a pop-up or market page with date, lineup, location, and clear action.",
            "Show vendor/share kit links and QR.",
            "Show RSVP/ticket/waitlist capture.",
            "Show post-event proof for sponsors, vendors, and repeat decisions.",
        ],
        "close": "Send the date, lineup, location, and one image. We will publish a page vendors can share today.",
        "objections": [
            ("A Google Form is enough.", "Forms collect data. Mingla gives the public-facing story, the action, and the proof in one place."),
            ("We promote last-minute.", "That makes the single page more important. Everyone shares the same link instead of improvising."),
            ("We do not need an app.", "The first win is not app adoption. It is a clean page, RSVP or ticket capture, and better partner sharing."),
        ],
        "proof": [
            "Pop-up page live within one day",
            "Vendor or partner shares recorded",
            "RSVPs, ticket clicks, or waitlist captured",
            "Repeat decision supported by data",
        ],
        "disqualify": "No public date, no partner/share channels, or event details too unstable to publish.",
    },
    {
        "name": "Workshop-first wellness and lifestyle operators",
        "buyer": "Studio owner, instructor, facilitator, retreat lead, lifestyle host",
        "trigger": "Special workshop, one-off class, retreat teaser, community night, teacher collaboration.",
        "goal": "Sell or fill one special workshop without forcing it through the normal class-booking mold.",
        "pain": "Normal class systems handle routine inventory, but special experiences need richer context, sharing, and follow-up.",
        "opener": "Your class system may handle regular classes. What happens when you need to promote a special workshop or community event?",
        "qualify": [
            "Which workshop or event needs more explanation than a normal class?",
            "What questions do people ask before committing?",
            "Is capacity, price, waiver, or what-to-bring the main friction?",
            "Who can help share it if the page is clean?",
        ],
        "show": [
            "Show a workshop page with benefits, instructor, capacity, price, and what to bring.",
            "Show booking/RSVP and waitlist path.",
            "Show creator/studio share link and QR.",
            "Show post-event list for next workshop or series.",
        ],
        "close": "Let us publish one special workshop page and measure whether it improves signups or reduces explanation work.",
        "objections": [
            ("Mindbody or ClassPass already handles this.", "Keep routine classes there. Mingla is for special moments that need richer story, sharing, and follow-up."),
            ("Our audience may not want another app.", "They can act from a link. The app is not the first hurdle; clear commitment is."),
            ("We cannot add more admin.", "We should remove admin by putting questions, policies, and action in one approved page."),
        ],
        "proof": [
            "Workshop page approved",
            "Booking, RSVP, or waitlist tested",
            "Share links used by instructor/studio",
            "Follow-up list captured for next session",
        ],
        "disqualify": "Only routine classes, no special programs, or no willingness to promote a standalone page.",
    },
    {
        "name": "Multi-location hospitality groups",
        "buyer": "Owner, regional operator, marketing lead, finance/ops lead, group GM",
        "trigger": "Seasonal campaign, location-level event push, inconsistent local marketing, reporting gap.",
        "goal": "Prove one repeatable campaign at one or two locations before expanding across the group.",
        "pain": "Good local ideas are hard to package, compare, and repeat across locations with clean reporting.",
        "opener": "If one location runs a great moment, how fast can you package it, compare it, and repeat it across the group?",
        "qualify": [
            "Which location has the strongest immediate activation opportunity?",
            "What campaign or moment could repeat across locations?",
            "Who needs to approve: marketing, ops, GM, finance, or ownership?",
            "What metrics make expansion worth discussing?",
        ],
        "show": [
            "Show one location campaign page.",
            "Show how the same campaign can copy to a second location with local details.",
            "Show location-level links/QR and reporting.",
            "Show rollout decision: expand, adjust, or stop.",
        ],
        "close": "Let us run one campaign at one location, or a two-location comparison, and use the result to decide whether a group rollout is worth it.",
        "objections": [
            ("We have an agency, POS, and website.", "Those should stay. Mingla sits at the campaign/action layer and gives location-level proof your existing stack usually hides."),
            ("Approvals are complicated.", "Then the test should be narrow: one campaign, one location, pre-approved assets, and a clear success metric."),
            ("This sounds enterprise-heavy.", "We do not need an enterprise rollout first. We need one controlled proof point a group operator can trust."),
        ],
        "proof": [
            "One-location or two-location campaign live",
            "Location-specific links or QR active",
            "Lead/booking/click metrics separated",
            "Rollout decision documented",
        ],
        "disqualify": "No local activation authority, no clear location owner, or requires full procurement before a small proof test.",
    },
]


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    max_w: int,
    font_obj: ImageFont.FreeTypeFont,
    fill=COLORS["ink"],
    line_gap: int = 5,
    bullet: str | None = None,
) -> int:
    x, y = xy
    avg = max(6, int(font_obj.getlength("abcdefghijklmnopqrstuvwxyz") / 26))
    width_chars = max(18, max_w // avg)
    prefix = f"{bullet} " if bullet else ""
    indent = int(font_obj.getlength(prefix)) if bullet else 0
    lines = []
    for para in text.split("\n"):
        wrapped = wrap(para, width=width_chars) or [""]
        lines.extend(wrapped)
    for i, line in enumerate(lines):
        draw.text((x + (0 if i == 0 else indent), y), (prefix if i == 0 else "") + line, font=font_obj, fill=fill)
        y += font_obj.size + line_gap
    return y


def card(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, accent=COLORS["teal"]) -> int:
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, radius=12, fill=COLORS["white"], outline=COLORS["line"], width=2)
    draw.rectangle((x1, y1, x1 + 8, y2), fill=accent)
    draw.text((x1 + 22, y1 + 15), title, font=F["h"], fill=accent)
    return y1 + 51


def draw_header(draw: ImageDraw.ImageDraw, sheet: dict, idx: int) -> int:
    draw.rectangle((0, 0, PAGE_W, PAGE_H), fill=COLORS["bg"])
    draw.text((M, 44), "MINGLA SALES BATTLE SHEET", font=F["eyebrow"], fill=COLORS["teal"])
    draw.text((PAGE_W - M - 130, 44), f"ICP {idx}/8", font=F["eyebrow"], fill=COLORS["muted"])
    y = 78
    y = draw_wrapped(draw, sheet["name"], (M, y), PAGE_W - 2 * M, F["title"], fill=COLORS["ink"], line_gap=4)
    y += 6
    meta = f"Buyer: {sheet['buyer']}  |  Trigger: {sheet['trigger']}"
    y = draw_wrapped(draw, meta, (M, y), PAGE_W - 2 * M, F["sub"], fill=COLORS["muted"], line_gap=4)
    y += 10
    draw.rounded_rectangle((M, y, PAGE_W - M, y + 72), radius=14, fill=(232, 244, 243), outline=(174, 215, 212), width=2)
    draw_wrapped(draw, f"7-day activation goal: {sheet['goal']}", (M + 22, y + 17), PAGE_W - 2 * M - 44, F["sub"], fill=COLORS["ink"], line_gap=4)
    return y + 96


def section_list(draw: ImageDraw.ImageDraw, title: str, items: list[str], box: tuple[int, int, int, int], accent) -> None:
    x1, y1, x2, y2 = box
    y = card(draw, box, title, accent)
    for item in items:
        y = draw_wrapped(draw, item, (x1 + 28, y), x2 - x1 - 48, F["small"], fill=COLORS["ink"], line_gap=4, bullet="-")
        y += 5


def render_page(sheet: dict, idx: int) -> Image.Image:
    img = Image.new("RGB", (PAGE_W, PAGE_H), COLORS["bg"])
    draw = ImageDraw.Draw(img)
    y = draw_header(draw, sheet, idx)

    left_x = M
    right_x = PAGE_W // 2 + 12
    col_w = (PAGE_W - 2 * M - G) // 2
    row_gap = 18

    top_h = 260
    mid_h = 386
    obj_h = 450
    bottom_h = 226

    # First row.
    box = (left_x, y, left_x + col_w, y + top_h)
    ty = card(draw, box, "Core pain and opener", COLORS["blue"])
    ty = draw_wrapped(draw, f"Pain: {sheet['pain']}", (box[0] + 28, ty), col_w - 48, F["small"], fill=COLORS["ink"], line_gap=4)
    ty += 8
    draw_wrapped(draw, f"Say: \"{sheet['opener']}\"", (box[0] + 28, ty), col_w - 48, F["quote"], fill=COLORS["coral"], line_gap=4)

    section_list(draw, "Qualify fast", sheet["qualify"], (right_x, y, right_x + col_w, y + top_h), COLORS["teal"])
    y += top_h + row_gap

    # Second row.
    section_list(draw, "Demo route", sheet["show"], (left_x, y, left_x + col_w, y + mid_h), COLORS["green"])
    box = (right_x, y, right_x + col_w, y + mid_h)
    ty = card(draw, box, "Close and next step", COLORS["gold"])
    ty = draw_wrapped(draw, sheet["close"], (box[0] + 28, ty), col_w - 48, F["body"], fill=COLORS["ink"], line_gap=6)
    ty += 14
    draw.text((box[0] + 28, ty), "CRM proof fields to fill", font=F["h"], fill=COLORS["teal"])
    ty += 34
    for item in sheet["proof"]:
        ty = draw_wrapped(draw, item, (box[0] + 28, ty), col_w - 48, F["small"], fill=COLORS["ink"], line_gap=4, bullet="-")
        ty += 5
    y += mid_h + row_gap

    # Objection row spans width.
    box = (M, y, PAGE_W - M, y + obj_h)
    ty = card(draw, box, "Objection handling", COLORS["coral"])
    table_x = box[0] + 28
    table_w = box[2] - box[0] - 56
    obj_w = int(table_w * 0.33)
    resp_w = table_w - obj_w - 20
    for objection, response in sheet["objections"]:
        row_top = ty
        draw.rounded_rectangle((table_x, row_top, table_x + table_w, row_top + 118), radius=10, fill=(253, 253, 253), outline=(225, 228, 234), width=1)
        draw_wrapped(draw, objection, (table_x + 16, row_top + 14), obj_w - 20, F["small"], fill=COLORS["ink"], line_gap=4)
        draw.line((table_x + obj_w + 5, row_top + 12, table_x + obj_w + 5, row_top + 106), fill=COLORS["line"], width=2)
        draw_wrapped(draw, response, (table_x + obj_w + 24, row_top + 14), resp_w - 28, F["small"], fill=COLORS["muted"], line_gap=4)
        ty += 128
    y += obj_h + row_gap

    # Bottom guardrail.
    box = (M, y, PAGE_W - M, y + bottom_h)
    ty = card(draw, box, "Do not force it", COLORS["muted"])
    draw_wrapped(draw, f"Disqualify when: {sheet['disqualify']}", (box[0] + 28, ty), box[2] - box[0] - 56, F["small"], fill=COLORS["ink"], line_gap=4)
    draw.text((M, PAGE_H - 52), "Use as the live call guide. After call: update Supply CRM stage, ICP, city market, contact, next step, owner, proof fields, and follow-up date.", font=F["tiny"], fill=COLORS["muted"])
    return img


def build_markdown() -> str:
    lines = [
        "# Sales Battle Sheets",
        "",
        "Printable PDF artifact: `Mingla_Artifacts/MINGLA_SALES_BATTLE_SHEETS_2026-06-24.pdf`",
        "",
        "Use these as one-page call guides for the Supply CRM. ICP is the account type; city is only a market filter.",
        "",
    ]
    for i, s in enumerate(BATTLE_SHEETS, 1):
        lines.extend(
            [
                f"## {i}. {s['name']}",
                "",
                f"**Buyer:** {s['buyer']}",
                "",
                f"**Trigger:** {s['trigger']}",
                "",
                f"**7-day activation goal:** {s['goal']}",
                "",
                f"**Core pain:** {s['pain']}",
                "",
                f"**Call opener:** \"{s['opener']}\"",
                "",
                "**Qualify fast:**",
            ]
        )
        lines.extend([f"- {x}" for x in s["qualify"]])
        lines.extend(["", "**Demo route:**"])
        lines.extend([f"- {x}" for x in s["show"]])
        lines.extend(["", f"**Close:** {s['close']}", "", "**Objection handling:**"])
        for objection, response in s["objections"]:
            lines.append(f"- **{objection}** {response}")
        lines.extend(["", "**CRM proof fields:**"])
        lines.extend([f"- {x}" for x in s["proof"]])
        lines.extend(["", f"**Disqualify when:** {s['disqualify']}", ""])
    return "\n".join(lines).strip() + "\n"


def main() -> None:
    PREVIEW_DIR.mkdir(exist_ok=True)
    pages = [render_page(sheet, idx) for idx, sheet in enumerate(BATTLE_SHEETS, 1)]
    for idx, page in enumerate(pages, 1):
        page.save(PREVIEW_DIR / f"sales_battle_sheet_{idx:02d}.png")
    pages[0].save(
        PDF_PATH,
        "PDF",
        resolution=DPI,
        save_all=True,
        append_images=pages[1:],
    )
    MD_PATH.write_text(build_markdown(), encoding="utf-8")
    print(PDF_PATH)
    print(MD_PATH)
    print(PREVIEW_DIR)


if __name__ == "__main__":
    main()
