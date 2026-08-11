-- #5 (V4) sent advocates who selected "File or resume case" straight to
-- FILING_START and never collected any data there. #8 (V5A) repurposes
-- menu:file-case entirely — routeInboundMessage no longer knows what
-- FILING_START means, so any conversation already sitting in that state
-- from before this deployment would go permanently silent (every future
-- message just falls into the generic "keep alive, do nothing" branch).
-- Move them back to MAIN_MENU, where the advocate can select
-- "File or resume case" again and enter the real V5A flow. This is safe
-- precisely because V4 never asked for or stored anything in FILING_START.
UPDATE conversations
SET state = 'MAIN_MENU',
    updated_at = now(),
    version = version + 1
WHERE state = 'FILING_START';
