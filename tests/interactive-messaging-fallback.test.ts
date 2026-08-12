import { beforeEach, describe, expect, it } from "vitest";
import { reopenLanguagePicker, type LanguageWorkflowDeps } from "../src/services/language-workflow";
import { sendMainMenu, type MainMenuSenderDeps } from "../src/services/main-menu-sender";
import { sendDraftChoice, sendFilingNotice, type FilingSenderDeps } from "../src/services/filing-sender";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

// Every send path in this file follows the same three-tier rule (#16 task
// 6): a provider's native interactive buttons/list first when the
// capability exists, then the Content Template, then plain text. Twilio
// never has the capability, so it always goes straight to Content
// Template — already covered by the existing per-workflow test files.
// This file is specifically about the branch that capability adds.

const WHATSAPP_NUMBER = "15005550006";
const FROM_NUMBER = "617991234500";
const CONTENT_SID = "kapso-template-not-yet-wired";
const MAIN_MENU_CONTENT_SID = { en: CONTENT_SID, ml: CONTENT_SID };

describe("interactive-first send with graceful fallback", () => {
  let conversationRepo: InMemoryConversationRepository;
  let interactiveClient: FakeMessagingClient;

  beforeEach(() => {
    conversationRepo = new InMemoryConversationRepository();
    interactiveClient = createFakeMessagingClient({ interactive: true });
  });

  it("language picker: uses native interactive buttons and never touches the Content Template when the capability exists", async () => {
    const deps: LanguageWorkflowDeps = {
      conversationRepo,
      messagingClient: interactiveClient,
      fromNumber: FROM_NUMBER,
      contentSid: CONTENT_SID,
      mainMenuContentSid: MAIN_MENU_CONTENT_SID,
    };

    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    const result = await reopenLanguagePicker(deps, { whatsappNumber: WHATSAPP_NUMBER, messageId: "wamid.1" });

    expect(result.delivered).toBe(true);
    expect(interactiveClient.sendInteractiveButtons).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      bodyText: expect.stringContaining("Please choose your preferred language"),
      buttons: [
        { id: "language:en", title: "English" },
        { id: "language:ml", title: "മലയാളം" },
      ],
    });
    expect(interactiveClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("language picker: falls back to the Content Template when the interactive send itself fails", async () => {
    interactiveClient.sendInteractiveButtons!.mockRejectedValueOnce(new Error("Meta rejected the request"));
    const deps: LanguageWorkflowDeps = {
      conversationRepo,
      messagingClient: interactiveClient,
      fromNumber: FROM_NUMBER,
      contentSid: CONTENT_SID,
      mainMenuContentSid: MAIN_MENU_CONTENT_SID,
    };

    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    const result = await reopenLanguagePicker(deps, { whatsappNumber: WHATSAPP_NUMBER, messageId: "wamid.2" });

    expect(result.delivered).toBe(true);
    expect(interactiveClient.sendContentTemplate).toHaveBeenCalledWith({ from: FROM_NUMBER, to: WHATSAPP_NUMBER, contentSid: CONTENT_SID });
  });

  it("main menu: uses a native interactive list with all four stable action ids and never touches the Content Template", async () => {
    const deps: MainMenuSenderDeps = { messagingClient: interactiveClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID };

    const delivered = await sendMainMenu(deps, { to: WHATSAPP_NUMBER, language: "en", correlationId: "wamid.3" });

    expect(delivered.delivered).toBe(true);
    expect(interactiveClient.sendInteractiveList).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      bodyText: expect.any(String),
      buttonText: expect.any(String),
      sections: [
        {
          rows: [
            { id: "menu:file-case", title: expect.any(String) },
            { id: "menu:case-status", title: expect.any(String) },
            { id: "menu:change-language", title: expect.any(String) },
            { id: "menu:help", title: expect.any(String) },
          ],
        },
      ],
    });
    expect(interactiveClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("main menu: falls back to the Content Template when the interactive list send fails", async () => {
    interactiveClient.sendInteractiveList!.mockRejectedValueOnce(new Error("row title too long"));
    const deps: MainMenuSenderDeps = { messagingClient: interactiveClient, fromNumber: FROM_NUMBER, contentSidByLanguage: MAIN_MENU_CONTENT_SID };

    const delivered = await sendMainMenu(deps, { to: WHATSAPP_NUMBER, language: "ml", correlationId: "wamid.4" });

    expect(delivered.delivered).toBe(true);
    expect(interactiveClient.sendContentTemplate).toHaveBeenCalledWith({ from: FROM_NUMBER, to: WHATSAPP_NUMBER, contentSid: CONTENT_SID });
  });

  it("draft choice: uses native interactive buttons with all three stable action ids", async () => {
    const deps: FilingSenderDeps = {
      messagingClient: interactiveClient,
      fromNumber: FROM_NUMBER,
      draftChoiceContentSid: MAIN_MENU_CONTENT_SID,
      noticeContentSid: MAIN_MENU_CONTENT_SID,
    };

    const delivered = await sendDraftChoice(deps, { to: WHATSAPP_NUMBER, language: "en", correlationId: "wamid.5" });

    expect(delivered.delivered).toBe(true);
    expect(interactiveClient.sendInteractiveButtons).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      bodyText: expect.any(String),
      buttons: [
        { id: "filing:resume-draft", title: "Resume draft" },
        { id: "filing:start-new", title: "Start new filing" },
        { id: "nav:main-menu", title: "Main menu" },
      ],
    });
    expect(interactiveClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("filing notice: uses native interactive buttons with both stable action ids", async () => {
    const deps: FilingSenderDeps = {
      messagingClient: interactiveClient,
      fromNumber: FROM_NUMBER,
      draftChoiceContentSid: MAIN_MENU_CONTENT_SID,
      noticeContentSid: MAIN_MENU_CONTENT_SID,
    };

    const delivered = await sendFilingNotice(deps, { to: WHATSAPP_NUMBER, language: "ml", correlationId: "wamid.6" });

    expect(delivered.delivered).toBe(true);
    expect(interactiveClient.sendInteractiveButtons).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      bodyText: expect.any(String),
      buttons: [
        { id: "filing:accept-test-notice", title: "തുടരുക" },
        { id: "nav:main-menu", title: "പ്രധാന മെനു" },
      ],
    });
    expect(interactiveClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("draft choice: falls back all the way to plain text when both the interactive send and the Content Template fail", async () => {
    interactiveClient.sendInteractiveButtons!.mockRejectedValueOnce(new Error("Meta rejected the request"));
    interactiveClient.sendContentTemplate.mockRejectedValueOnce(new Error("Kapso has no template SID"));
    const deps: FilingSenderDeps = {
      messagingClient: interactiveClient,
      fromNumber: FROM_NUMBER,
      draftChoiceContentSid: MAIN_MENU_CONTENT_SID,
      noticeContentSid: MAIN_MENU_CONTENT_SID,
    };

    const delivered = await sendDraftChoice(deps, { to: WHATSAPP_NUMBER, language: "en", correlationId: "wamid.7" });

    expect(delivered.delivered).toBe(true);
    expect(interactiveClient.sendText).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: WHATSAPP_NUMBER,
      body: expect.stringContaining("Resume draft"),
    });
  });
});
