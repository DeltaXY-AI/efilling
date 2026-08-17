import { describe, expect, it } from "vitest";
import {
  buildDraftListRows,
  documentsComplete,
  renderCaseStatus,
  renderDraftCard,
  renderMinePromptBody,
  sendDraftCardMessage,
  sendDraftListMessage,
  type DraftListRow,
} from "../src/services/filing-draft-list-sender";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import type { FilingRecord } from "../src/repositories/filing-repository";

const FROM_NUMBER = "whatsapp:+14155238886";
const DRAFT_LIST_CONTENT_SID = { en: "HXfdlistEn0000000000000000000000000", ml: "HXfdlistMl0000000000000000000000000" };
const DRAFT_DETAIL_ACTIONS_CONTENT_SID = { en: "HXfddetailEn00000000000000000000000", ml: "HXfddetailMl00000000000000000000000" };
const CASE_STATUS_ACTIONS_CONTENT_SID = { en: "HXcasestatEn0000000000000000000000", ml: "HXcasestatMl0000000000000000000000" };

function baseFiling(overrides: Partial<FilingRecord> = {}): FilingRecord {
  const now = new Date("2026-04-18T00:00:00Z");
  return {
    id: "filing-1",
    conversationId: "conv-1",
    role: "COMPLAINANT_ADVOCATE",
    status: "DRAFT",
    currentStep: "FILING_DOC_CHEQUE",
    language: "en",
    testNoticeVersion: "v1",
    testNoticeAcceptedAt: null,
    advocateEnrolmentOriginal: null,
    advocateEnrolmentNormalized: null,
    advocateEnrolmentStatus: null,
    advocateEnrolmentConfirmedAt: null,
    chequeNumber: null,
    chequeDate: null,
    chequeAmount: null,
    bankBranch: null,
    returnReason: null,
    memoDate: null,
    noticeDate: null,
    serviceDate: null,
    partPayment: null,
    narrative: null,
    witnessPresent: null,
    selectedCourt: null,
    declarationAcceptedAt: null,
    diaryNumber: null,
    filedAt: null,
    courtFeePaidAt: null,
    courtFeeTransactionId: null,
    defectNotifiedAt: null,
    defectCorrectedChequeNumber: null,
    defectDelayReason: null,
    defectDelayDays: null,
    defectResubmittedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("documentsComplete", () => {
  it("false until every required group (cheque/memo/notice/id) meets its minimum", () => {
    expect(documentsComplete({})).toBe(false);
    expect(documentsComplete({ cheque: 1, memo: 1, notice: 1 })).toBe(false);
  });

  it("true once every required group's minimum is met (support is optional, min 0)", () => {
    expect(documentsComplete({ cheque: 1, memo: 1, notice: 1, id: 1 })).toBe(true);
  });
});

describe("buildDraftListRows", () => {
  it("orders Drafts before Active cases, newest first within each", () => {
    const older = baseFiling({ id: "d-old", status: "DRAFT", createdAt: new Date("2026-04-01T00:00:00Z") });
    const newer = baseFiling({ id: "d-new", status: "DRAFT", createdAt: new Date("2026-04-10T00:00:00Z") });
    const filed = baseFiling({ id: "f-1", status: "FILED", diaryNumber: "TEST-000001-2026" });
    // listByConversation's own contract: already newest-first.
    const filings = [filed, newer, older];

    const { rows } = buildDraftListRows("en", filings, new Map(), new Map());

    expect(rows.map((r) => r.filingId)).toEqual(["d-new", "d-old", "f-1"]);
    expect(rows[0].rowKind).toBe("draft");
    expect(rows[2].rowKind).toBe("case");
  });

  it("caps at 9 data rows and reports the overflow count — never a silent drop", () => {
    const filings = Array.from({ length: 12 }, (_, i) => baseFiling({ id: `d-${i}`, createdAt: new Date(2026, 3, 12 - i) }));

    const { rows, overflowCount } = buildDraftListRows("en", filings, new Map(), new Map());

    expect(rows).toHaveLength(9);
    expect(overflowCount).toBe(3);
  });

  it("row title/description never exceed WhatsApp's 24/72-character limits, even for a long accused name and large amount", () => {
    const filing = baseFiling({ chequeAmount: "45000000", chequeNumber: "004512" });
    const accusedName = "Sreekumaran Nair Vazhappilly Thekkath Ramankutty Menon"; // deliberately long
    const accusedNames = new Map([[filing.id, accusedName]]);
    const docsComplete = new Map([[filing.id, true]]);

    const { rows } = buildDraftListRows("en", [filing], accusedNames, docsComplete);

    expect(rows[0].title.length).toBeLessThanOrEqual(24);
    expect(rows[0].description.length).toBeLessThanOrEqual(72);
  });

  it("a filing with no accused name yet falls back to a 'Started <date>' description", () => {
    const filing = baseFiling({ id: "brand-new" });
    const { rows } = buildDraftListRows("en", [filing], new Map(), new Map());
    expect(rows[0].description).toContain("Started");
  });

  it("formats the cheque amount with Indian digit grouping", () => {
    const filing = baseFiling({ chequeAmount: "450000" });
    const accusedNames = new Map([[filing.id, "Rajesh Menon"]]);
    const { rows } = buildDraftListRows("en", [filing], accusedNames, new Map([[filing.id, true]]));
    expect(rows[0].description).toContain("4,50,000");
  });
});

describe("renderMinePromptBody", () => {
  it("says there's nothing yet when there are no rows at all", () => {
    expect(renderMinePromptBody("en", false, 0)).toContain("don't have any drafts");
  });

  it("includes the 30-day retention line when there are rows", () => {
    expect(renderMinePromptBody("en", true, 0)).toContain("kept for 30 days");
  });

  it("appends an overflow note rather than silently dropping filings past the cap", () => {
    expect(renderMinePromptBody("en", true, 3)).toContain("+3 more");
  });
});

describe("renderDraftCard", () => {
  it("shows the checklist derived from real state — never 'details read from the documents' (no OCR, #32)", () => {
    const filing = baseFiling({ declarationAcceptedAt: null });
    const body = renderDraftCard("en", filing, "Rajesh Menon", false, new Date("2026-04-18T00:00:00Z"));
    expect(body).toContain("Documents not yet uploaded");
    expect(body).toContain("Case details not yet entered");
    expect(body).not.toContain("read from the documents");
  });

  it("marks both checklist items done once documents are complete and the declaration is accepted", () => {
    const filing = baseFiling({ declarationAcceptedAt: new Date("2026-04-17T00:00:00Z") });
    const body = renderDraftCard("en", filing, "Rajesh Menon", true, new Date("2026-04-18T00:00:00Z"));
    expect(body).toContain("✅ Documents uploaded");
    expect(body).toContain("✅ Case details entered");
  });

  it("shows the limitation deadline and days left when serviceDate is on file", () => {
    const filing = baseFiling({ serviceDate: "2026-03-28" });
    const body = renderDraftCard("en", filing, "Rajesh Menon", true, new Date("2026-04-18T00:00:00Z"));
    expect(body).toContain("12-05-2026");
    expect(body).toMatch(/\d+ days left/);
  });

  it("omits the deadline line entirely when serviceDate isn't on file yet — never guessed", () => {
    const filing = baseFiling({ serviceDate: null });
    const body = renderDraftCard("en", filing, "Rajesh Menon", false, new Date("2026-04-18T00:00:00Z"));
    expect(body).not.toContain("File before");
  });

  it("shows an overdue message once the deadline has passed", () => {
    const filing = baseFiling({ serviceDate: "2026-01-01" });
    const body = renderDraftCard("en", filing, "Rajesh Menon", true, new Date("2026-06-01T00:00:00Z"));
    expect(body).toContain("overdue");
  });
});

describe("renderCaseStatus", () => {
  it("is read-only content — diary number, accused, filed date, court, no action-implying text", () => {
    const filing = baseFiling({ status: "FILED", diaryNumber: "TEST-000001-2026", filedAt: new Date("2026-04-18T09:00:00Z"), selectedCourt: "ON Court - I, Kollam" });
    const body = renderCaseStatus("en", filing, "Rajesh Menon");
    expect(body).toContain("TEST-000001-2026");
    expect(body).toContain("Rajesh Menon");
    expect(body).toContain("ON Court - I, Kollam");
  });
});

describe("sendDraftListMessage / sendDraftCardMessage", () => {
  let messagingClient: FakeMessagingClient;

  function deps() {
    return {
      messagingClient,
      fromNumber: FROM_NUMBER,
      draftListContentSid: DRAFT_LIST_CONTENT_SID,
      draftDetailActionsContentSid: DRAFT_DETAIL_ACTIONS_CONTENT_SID,
      caseStatusActionsContentSid: CASE_STATUS_ACTIONS_CONTENT_SID,
    };
  }

  const sendInput = { to: "whatsapp:+15005550006", language: "en" as const, correlationId: "SM1" };

  it("sends the list as a Content Template with row content in its content variables", async () => {
    messagingClient = createFakeMessagingClient();
    const rows: DraftListRow[] = [{ filingId: "d-1", rowKind: "draft", title: "Draft · S.138 complaint", description: "Rajesh Menon · Rs.4,50,000" }];

    const delivered = await sendDraftListMessage(deps(), sendInput, rows, 0);

    expect(delivered).toBe(true);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        contentSid: DRAFT_LIST_CONTENT_SID.en,
        contentVariables: expect.objectContaining({ "2": "Draft · S.138 complaint", "3": "Rajesh Menon · Rs.4,50,000" }),
      }),
    );
  });

  it("falls back to numbered plain text (only the real rows, no padding) when the Content Template send fails", async () => {
    messagingClient = createFakeMessagingClient();
    messagingClient.sendContentTemplate.mockRejectedValueOnce(new Error("boom"));
    const rows: DraftListRow[] = [{ filingId: "d-1", rowKind: "draft", title: "Draft · S.138 complaint", description: "Rajesh Menon · Rs.4,50,000" }];

    const delivered = await sendDraftListMessage(deps(), sendInput, rows, 0);

    expect(delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("1. Draft · S.138 complaint") }));
  });

  it("sends the draft card text then its Continue/Discard/Main-menu Content Template", async () => {
    messagingClient = createFakeMessagingClient();
    const filing = baseFiling({ id: "d-1" });

    const delivered = await sendDraftCardMessage(deps(), sendInput, filing, "Rajesh Menon", false, new Date("2026-04-18T00:00:00Z"));

    expect(delivered).toBe(true);
    expect(messagingClient.sendText).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Rajesh Menon") }));
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith(expect.objectContaining({ contentSid: DRAFT_DETAIL_ACTIONS_CONTENT_SID.en }));
  });
});
