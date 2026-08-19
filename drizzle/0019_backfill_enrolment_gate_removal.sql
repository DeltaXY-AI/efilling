-- Reference-parity fix: tapping "Start filing" no longer gates on recording
-- the operating advocate's own enrolment number (#9) before anything
-- document-related happens — the client's reference prototype has no such
-- gate, and #33 Part A already captures a similar enrolment field
-- (filing_parties.representative_enrolment_number) later, during the
-- Complainant section, when filing as an advocate for a client. See
-- filing-workflow.ts's handleFilingNoticeInput, which now cascades straight
-- into FILING_DOC_CHEQUE.
--
-- ADVOCATE_ENROLMENT_PENDING/ADVOCATE_ENROLMENT_CONFIRM stay in the
-- conversation_state/outbound_message_type enums (harmless unused values,
-- Postgres enums can't drop values in place anyway) — same fossil-retention
-- pattern already used for COMPLAINANT_DETAILS_START, ACCUSED_DETAILS_START,
-- CHEQUE_DETAILS_START, DRAFT_READY_START, and FILING_FILED_START above.
--
-- This migration only forwards any conversation/filing genuinely stuck at
-- either retired state (from before this deploy) to FILING_DOC_CHEQUE, so
-- nobody is silently stranded — mirrors 0003_backfill_filing_start_state.sql.
UPDATE conversations
SET state = 'FILING_DOC_CHEQUE',
    updated_at = now(),
    version = version + 1
WHERE state IN ('ADVOCATE_ENROLMENT_PENDING', 'ADVOCATE_ENROLMENT_CONFIRM');

UPDATE filings
SET current_step = 'FILING_DOC_CHEQUE',
    updated_at = now()
WHERE current_step IN ('ADVOCATE_ENROLMENT_PENDING', 'ADVOCATE_ENROLMENT_CONFIRM');
