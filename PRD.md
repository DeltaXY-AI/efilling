# WhatsApp-Based 24x7 ON Courts MVP — Product Requirements Document

**Status:** Draft for customer confirmation  
**Delivery window:** 1 month  
**Primary channel:** Twilio WhatsApp Sandbox  
**Functional reference:** https://dristiwa.netlify.app/  

## 1. Background

The reference prototype demonstrates a WhatsApp-based service for filing and managing cheque-dishonour cases under Section 138 of the Negotiable Instruments Act. It contains 13 scenarios across six roles.

The one-month delivery is intended to be a working MVP, not a complete production court platform.

### Confirmed direction

- Use the existing prototype as the functional reference.
- Use Twilio WhatsApp Sandbox for the MVP.
- Start with one role: **Complainant Advocate**.
- Add other roles only if time remains.
- Real court, payment and e-Sign integrations are not required unless APIs are supplied and agreed during the project.

## 2. Product objective

Deliver a demonstrable WhatsApp chatbot through which a Complainant Advocate can complete the main journey shown in the prototype:

1. Start a conversation and select a language.
2. Begin a cheque-bounce case filing.
3. Submit case details and supporting documents.
4. Review a filing summary.
5. Receive a simulated filing reference and status.
6. Receive and correct simulated scrutiny defects.
7. Receive a hearing update or reminder.

The implementation must isolate Twilio-specific code so a different official WhatsApp provider can be integrated later.

## 3. Users

### Primary MVP user

**Complainant Advocate** — files and follows a cheque-dishonour complaint on behalf of a client.

### Stretch users

1. Scrutiny Officer
2. Complainant Litigant
3. Accused Advocate
4. Accused Litigant
5. Magistrate

Stretch users are not part of the guaranteed one-month scope.

## 4. MVP scope

### P0 — Committed scope

#### 4.1 WhatsApp onboarding

- User joins the Twilio Sandbox using Twilio's join process.
- Bot responds to an initial message such as `Hi` or `Start`.
- User selects English or Malayalam.
- Bot displays the available MVP actions.
- User can restart or return to the main menu.

#### 4.2 File a case

The bot guides the user through the prototype's cheque-bounce filing journey.

Information collected includes:

- Filing as litigant or advocate
- Advocate enrolment number, where applicable
- Complainant name, phone, email and address
- Accused name, phone and address
- Cheque number, date, amount, bank and branch
- Return reason and return-memo date
- Demand-notice date and service date
- Part-payment status
- Description of the underlying transaction
- Witness availability
- Court selection
- Final declaration

The user must be able to cancel, restart or resume the journey.

#### 4.3 Document collection

The bot requests the document groups shown in the prototype:

- Cheque images
- Bank return memo
- Demand notice and proof of service
- Complainant identity document
- Optional supporting documents

For the MVP, files may be received as WhatsApp media or represented with approved test/sample files. Only anonymized test data will be used.

#### 4.4 Review and submission

- Bot presents a final case summary.
- User confirms or requests correction.
- Bot generates a simulated diary/reference number.
- Bot sends a simulated complaint PDF or filing acknowledgement.
- The conversation state is saved for later continuation.

#### 4.5 Case status and notifications

- User can request the status of the demo filing.
- Bot returns a predefined status using the diary or case reference.
- Bot can send simulated filing, scrutiny and hearing updates.
- Proactive messages will use Twilio/WhatsApp-approved mechanisms where required.

#### 4.6 Scrutiny defect correction

The MVP reproduces the three defects from the prototype:

1. Cheque-number mismatch
2. Illegible cheque image
3. Delayed correction requiring condonation

The user can correct the cheque number, provide an explanation, submit a replacement image and provide a reason for delay. The bot then confirms simulated resubmission.

#### 4.7 Hearing update

- Bot displays the listed case, date, time and hearing purpose.
- User can confirm attendance or request an adjournment.
- The MVP records the choice and returns a simulated acknowledgement.

#### 4.8 Bilingual content

The committed Complainant Advocate journey will support:

- English
- Malayalam

Content will follow the reference prototype unless the customer provides corrections.

### P1 — Stretch scope

If the committed scope is completed early, scenarios will be added in this order:

1. **Scrutiny Officer:** review a filing and return or clear it.
2. **Complainant Litigant:** case status and settlement choices.
3. **Accused Advocate:** summons, case papers and compounding.
4. **Accused Litigant:** summons explanation and legal options.
5. **Magistrate:** board summary and application orders.

No stretch scenario may delay or reduce the quality of the P0 scope.

## 5. Out of scope

The following are excluded from the committed MVP:

- Production WhatsApp number and WABA onboarding
- Migration to the Indian vendor
- Real court filing or case-management integration
- Real CNR lookup
- Real Aadhaar verification or e-Sign
- Real payment processing
- Legally valid service of court notices
- Production identity and role verification
- Production administration portal
- Guaranteed implementation of all six roles
- Use of real litigant or court data
- Production-scale security certification or penetration testing

These can be planned after the MVP validates the workflow.

## 6. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | User can start the service from Twilio WhatsApp Sandbox. | P0 |
| FR-02 | User can choose English or Malayalam. | P0 |
| FR-03 | Bot maintains the user's current workflow state. | P0 |
| FR-04 | User can enter all mandatory complaint details. | P0 |
| FR-05 | Bot validates that required fields are present. | P0 |
| FR-06 | User can submit test documents or sample media. | P0 |
| FR-07 | User can review and correct entered information. | P0 |
| FR-08 | Bot generates a simulated filing reference and acknowledgement. | P0 |
| FR-09 | User can retrieve the status of the demo case. | P0 |
| FR-10 | Bot can issue simulated scrutiny and hearing updates. | P0 |
| FR-11 | User can correct and resubmit the three reference defects. | P0 |
| FR-12 | User can confirm hearing attendance or request adjournment. | P0 |
| FR-13 | User can return to the main menu or restart a journey. | P0 |
| FR-14 | Twilio integration is isolated behind a provider adapter. | P0 |
| FR-15 | Additional prototype roles can be enabled without rewriting the core workflow engine. | P1 |

## 7. Non-functional requirements

- **Provider portability:** Business workflows must not depend directly on Twilio payload formats.
- **Security:** Secrets must be stored in environment variables or a secret manager.
- **Test data only:** No real Aadhaar, payment credentials or court evidence will be used.
- **Auditability:** Inbound messages, outbound messages, state changes and errors must be logged using test identifiers.
- **Reliability:** Duplicate Twilio webhooks must not create duplicate workflow actions.
- **Recoverability:** A failed interaction must allow retry or return to the main menu.
- **Responsiveness:** Normal bot replies should begin within three seconds, excluding deliberate simulated processing.
- **Maintainability:** User-visible text should be separated from workflow code to support bilingual editing.

## 8. Proposed architecture

```text
Twilio WhatsApp Sandbox
        |
        v
Twilio Webhook Adapter
        |
        v
Provider-Neutral Messaging Interface
        |
        v
Conversation Workflow Engine
        |
        +--> User/session store
        +--> Demo case repository
        +--> Test document storage
        +--> PDF/acknowledgement generator
        +--> Mock payment/e-Sign/court services
```

### Provider-neutral interface

The application should expose internal operations such as:

- `sendText`
- `sendMenu`
- `sendDocument`
- `sendTemplate`
- `receiveMessage`
- `receiveMedia`

A future Indian-vendor adapter can implement the same operations without changing the case workflows.

## 9. Success criteria

The MVP is successful when:

1. A new tester can join the Twilio Sandbox and start the bot.
2. The tester can complete the Complainant Advocate filing journey end to end.
3. The tester can submit test documents and receive a filing acknowledgement.
4. The tester can retrieve case status and complete defect correction.
5. The hearing attendance and adjournment choices return acknowledgements.
6. The committed flow works in English and Malayalam.
7. The system resumes an interrupted journey.
8. The project team can demonstrate that Twilio-specific code is isolated from workflow logic.
9. No real court action, payment or e-Sign is presented as completed.

## 10. One-month delivery plan

| Week | Target |
|---|---|
| Week 1 | Confirm prototype flow, configure Twilio Sandbox, establish webhook adapter, workflow engine and persistence. |
| Week 2 | Implement onboarding, bilingual menus, case-detail collection and document intake. |
| Week 3 | Implement review, acknowledgement, case status, scrutiny defects and hearing responses. |
| Week 4 | End-to-end testing, content corrections, demo preparation, documentation and available stretch scenarios. |

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Prototype is interpreted as a requirement to build all 13 scenarios. | Obtain written confirmation that only Complainant Advocate is committed. |
| Twilio Sandbox differs from the final Indian vendor. | Use a provider-neutral adapter and keep workflow state in the application. |
| WhatsApp interactive feature limitations delay development. | Provide numbered text-menu fallbacks. |
| Real integrations are requested during the month. | Treat them as change requests unless included before scope approval. |
| Document handling introduces privacy risk. | Use anonymized test files and define deletion rules. |
| Bilingual content requires corrections. | Keep content configurable and request customer review before final demo. |
| Stretch roles affect core quality. | Start stretch work only after all P0 acceptance criteria pass. |

## 12. Assumptions requiring customer confirmation

- The existing prototype is the source of truth for fields, messages and scenario behaviour.
- The guaranteed role is Complainant Advocate.
- Twilio Sandbox is sufficient for the one-month demonstration.
- Payment, e-Sign, court filing and case lookup may be simulated.
- Anonymized sample cases and documents are acceptable.
- Additional roles are stretch scope.
- The MVP is not intended for public or production use.

## 13. Final approval statement

Approval of this PRD confirms that the one-month commitment is a **Twilio WhatsApp Sandbox MVP for the Complainant Advocate journey**. All other roles and real external integrations are subject to available time or a later phase.
