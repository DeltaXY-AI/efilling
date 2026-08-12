# Kapso vendor due-diligence questions (#16)

**Status:** Drafted, not yet sent. This is a ready-to-send question list for whoever
on the team owns vendor/security/legal conversations to send to Kapso — I can't
contact a vendor's sales or support channel myself, so this stays a draft until a
person sends it and records the answers back into this file (or a linked one).

**Why these specific questions:** every one below is a non-negotiable gate from
issue #16 — the migration must not be recommended for production until each is
answered, not assumed. Kapso's own docs (reviewed 2026-08-12) don't answer any of
these; they're genuinely open.

---

## Suggested message to Kapso

> Subject: Security, privacy, and commercial due diligence — evaluating Kapso for a court-adjacent WhatsApp integration (India)
>
> We're evaluating Kapso as a possible replacement for our current WhatsApp provider on an application that handles legal case-filing data for Indian courts. Before we can recommend any production migration internally, we need written answers to the questions below. Happy to get on a call if that's easier — but we need these in writing for our own compliance record either way.

## Security, privacy, and legal

- [ ] Will Kapso sign a Data Processing Agreement (DPA)?
- [ ] What is the current subprocessor list, and what are the processing purposes and processing regions for each?
- [ ] What Terms of Service apply to our plan tier specifically?
- [ ] What's the security architecture, and are there any independent certifications or audit reports available (SOC 2, ISO 27001, etc.)?
- [ ] What are the encryption guarantees — for message content, media, credentials, backups, and logs — both at rest and in transit?
- [ ] Is message/media retention configurable? Your public Privacy Policy currently states WhatsApp messages and project data are stored indefinitely while an account is active, and that deletion after termination may take approximately 30–90 days — can this be shortened or made project-specific for us?
- [ ] Is any customer or end-user content used for model training, product training, or human review, at any point?
- [ ] For any audio-transcription feature: who is the transcription provider, what's the data flow, what's the retention period, and can it be disabled entirely?
- [ ] What data-residency options exist, and what's the international-transfer mechanism, for Indian end-user/legal data specifically?
- [ ] What are your security-incident and breach-notification commitments (timeline, channel, contents of notification)?
- [ ] What are your backup, restore, and disaster-recovery commitments — specifically RPO (recovery point objective) and RTO (recovery time objective)?
- [ ] If an end user or our organization requests erasure/export, what's the workflow, and does deletion of a project/contact also cover its messages, media, transcripts, logs, and backups — or can any of those persist elsewhere?

## Reliability and support

- [ ] What contractual SLA applies to the plan tier we'd actually be on? (Your public pricing appears to reserve a custom SLA for Enterprise only — can Pro/Platform get one?)
- [ ] What support channel, coverage hours, severity definitions, and response/resolution targets apply to our tier?
- [ ] If our webhook endpoint is down past your documented retry window (~2.5 minutes across 3 attempts, per your docs), is there any way to replay the missed events afterward, or are they permanently lost?
- [ ] What's your API/version deprecation policy, and how much notice do you give before a breaking change?
- [ ] Can we see your incident history (status.kapso.ai) for the last 6–12 months — specifically any API, application, workflow, number, or template disruptions?
- [ ] What rate/throughput limits apply beyond Meta's own limits, at our projected volume?
- [ ] If we ever needed to leave, what's the exit procedure for moving the WABA, phone number, templates, message history, and Meta billing away from Kapso to another provider or in-house?

## Number and Meta ownership (India specifically)

- [ ] Your pre-verified instant numbers appear to be US numbers. What's the actual path to connecting an Indian production number — is it entirely through our own SIM/WABA via your Embedded Signup flow, or do you offer anything else for India?
- [ ] When we connect our own WABA, do we — not Kapso — retain ownership of the Meta Business Portfolio, WABA, display name, templates, and phone number? Can this be confirmed in writing?
- [ ] What are the prerequisites and typical timeline for Meta business verification, display-name approval, payment setup, and template approval, in your experience with other Indian customers?

## Commercial

- [ ] What is the actual monthly subscription price for the Pro and Platform plans? (Your pricing page publishes message/number/storage allowances but not the dollar price for either tier.)
- [ ] Do you offer a custom plan for our projected volume, and if so, what would it cost?
- [ ] Are there any setup fees, minimum commitments, or contract-length requirements?

---

## Answers received

*(None yet — update this section, or link to where answers are recorded, once Kapso responds.)*
