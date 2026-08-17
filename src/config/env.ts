import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  TWILIO_WHATSAPP_FROM: z.string().min(1, "TWILIO_WHATSAPP_FROM is required"),
  TWILIO_LANGUAGE_CONTENT_SID: z.string().min(1, "TWILIO_LANGUAGE_CONTENT_SID is required"),
  TWILIO_MAIN_MENU_CONTENT_SID_EN: z.string().min(1, "TWILIO_MAIN_MENU_CONTENT_SID_EN is required"),
  TWILIO_MAIN_MENU_CONTENT_SID_ML: z.string().min(1, "TWILIO_MAIN_MENU_CONTENT_SID_ML is required"),
  TWILIO_FILING_DRAFT_CHOICE_SID_EN: z.string().min(1, "TWILIO_FILING_DRAFT_CHOICE_SID_EN is required"),
  TWILIO_FILING_DRAFT_CHOICE_SID_ML: z.string().min(1, "TWILIO_FILING_DRAFT_CHOICE_SID_ML is required"),
  TWILIO_FILING_NOTICE_SID_EN: z.string().min(1, "TWILIO_FILING_NOTICE_SID_EN is required"),
  TWILIO_FILING_NOTICE_SID_ML: z.string().min(1, "TWILIO_FILING_NOTICE_SID_ML is required"),
  TWILIO_ENROLMENT_PROMPT_SID_EN: z.string().min(1, "TWILIO_ENROLMENT_PROMPT_SID_EN is required"),
  TWILIO_ENROLMENT_PROMPT_SID_ML: z.string().min(1, "TWILIO_ENROLMENT_PROMPT_SID_ML is required"),
  TWILIO_ENROLMENT_CONFIRM_SID_EN: z.string().min(1, "TWILIO_ENROLMENT_CONFIRM_SID_EN is required"),
  TWILIO_ENROLMENT_CONFIRM_SID_ML: z.string().min(1, "TWILIO_ENROLMENT_CONFIRM_SID_ML is required"),
  TWILIO_COMPLAINANT_REVIEW_SID_EN: z.string().min(1, "TWILIO_COMPLAINANT_REVIEW_SID_EN is required"),
  TWILIO_COMPLAINANT_REVIEW_SID_ML: z.string().min(1, "TWILIO_COMPLAINANT_REVIEW_SID_ML is required"),
  TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN: z.string().min(1, "TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN is required"),
  TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML: z.string().min(1, "TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML is required"),
  TWILIO_ACCUSED_REVIEW_SID_EN: z.string().min(1, "TWILIO_ACCUSED_REVIEW_SID_EN is required"),
  TWILIO_ACCUSED_REVIEW_SID_ML: z.string().min(1, "TWILIO_ACCUSED_REVIEW_SID_ML is required"),
  TWILIO_ACCUSED_EDIT_FIELDS_SID_EN: z.string().min(1, "TWILIO_ACCUSED_EDIT_FIELDS_SID_EN is required"),
  TWILIO_ACCUSED_EDIT_FIELDS_SID_ML: z.string().min(1, "TWILIO_ACCUSED_EDIT_FIELDS_SID_ML is required"),
  // #33 Part A.
  TWILIO_COMPLAINANT_ROLE_SID_EN: z.string().min(1, "TWILIO_COMPLAINANT_ROLE_SID_EN is required"),
  TWILIO_COMPLAINANT_ROLE_SID_ML: z.string().min(1, "TWILIO_COMPLAINANT_ROLE_SID_ML is required"),
  // #33 Part B.
  TWILIO_ACCUSED_ENTITY_TYPE_SID_EN: z.string().min(1, "TWILIO_ACCUSED_ENTITY_TYPE_SID_EN is required"),
  TWILIO_ACCUSED_ENTITY_TYPE_SID_ML: z.string().min(1, "TWILIO_ACCUSED_ENTITY_TYPE_SID_ML is required"),
  // #33 Part C.
  TWILIO_FILING_RETURN_REASON_SID_EN: z.string().min(1, "TWILIO_FILING_RETURN_REASON_SID_EN is required"),
  TWILIO_FILING_RETURN_REASON_SID_ML: z.string().min(1, "TWILIO_FILING_RETURN_REASON_SID_ML is required"),
  TWILIO_FILING_PART_PAYMENT_SID_EN: z.string().min(1, "TWILIO_FILING_PART_PAYMENT_SID_EN is required"),
  TWILIO_FILING_PART_PAYMENT_SID_ML: z.string().min(1, "TWILIO_FILING_PART_PAYMENT_SID_ML is required"),
  // #33 Part D.
  TWILIO_FILING_WITNESS_SID_EN: z.string().min(1, "TWILIO_FILING_WITNESS_SID_EN is required"),
  TWILIO_FILING_WITNESS_SID_ML: z.string().min(1, "TWILIO_FILING_WITNESS_SID_ML is required"),
  // #33 Part F.
  TWILIO_FILING_COURT_SID_EN: z.string().min(1, "TWILIO_FILING_COURT_SID_EN is required"),
  TWILIO_FILING_COURT_SID_ML: z.string().min(1, "TWILIO_FILING_COURT_SID_ML is required"),
  TWILIO_FILING_REVIEW_ACTIONS_SID_EN: z.string().min(1, "TWILIO_FILING_REVIEW_ACTIONS_SID_EN is required"),
  TWILIO_FILING_REVIEW_ACTIONS_SID_ML: z.string().min(1, "TWILIO_FILING_REVIEW_ACTIONS_SID_ML is required"),
  TWILIO_FILING_EDIT_GROUP_SID_EN: z.string().min(1, "TWILIO_FILING_EDIT_GROUP_SID_EN is required"),
  TWILIO_FILING_EDIT_GROUP_SID_ML: z.string().min(1, "TWILIO_FILING_EDIT_GROUP_SID_ML is required"),
  TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_EN: z.string().min(1, "TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_EN is required"),
  TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_ML: z.string().min(1, "TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_ML is required"),
  TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_EN: z.string().min(1, "TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_EN is required"),
  TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_ML: z.string().min(1, "TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_ML is required"),
  TWILIO_FILING_DECLARE_SID_EN: z.string().min(1, "TWILIO_FILING_DECLARE_SID_EN is required"),
  TWILIO_FILING_DECLARE_SID_ML: z.string().min(1, "TWILIO_FILING_DECLARE_SID_ML is required"),
  // #34.
  TWILIO_FILING_DRAFT_READY_ACTIONS_SID_EN: z.string().min(1, "TWILIO_FILING_DRAFT_READY_ACTIONS_SID_EN is required"),
  TWILIO_FILING_DRAFT_READY_ACTIONS_SID_ML: z.string().min(1, "TWILIO_FILING_DRAFT_READY_ACTIONS_SID_ML is required"),
  // #35.
  TWILIO_FILING_FILED_ACTIONS_SID_EN: z.string().min(1, "TWILIO_FILING_FILED_ACTIONS_SID_EN is required"),
  TWILIO_FILING_FILED_ACTIONS_SID_ML: z.string().min(1, "TWILIO_FILING_FILED_ACTIONS_SID_ML is required"),
  // #36.
  TWILIO_FILING_DRAFT_LIST_SID_EN: z.string().min(1, "TWILIO_FILING_DRAFT_LIST_SID_EN is required"),
  TWILIO_FILING_DRAFT_LIST_SID_ML: z.string().min(1, "TWILIO_FILING_DRAFT_LIST_SID_ML is required"),
  TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_EN: z.string().min(1, "TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_EN is required"),
  TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_ML: z.string().min(1, "TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_ML is required"),
  // #37: the case-status screen's new actions, the defect-alert/review/sent
  // actions, and the days-of-delay select.
  TWILIO_CASE_STATUS_ACTIONS_SID_EN: z.string().min(1, "TWILIO_CASE_STATUS_ACTIONS_SID_EN is required"),
  TWILIO_CASE_STATUS_ACTIONS_SID_ML: z.string().min(1, "TWILIO_CASE_STATUS_ACTIONS_SID_ML is required"),
  TWILIO_DEFECT_ALERT_ACTIONS_SID_EN: z.string().min(1, "TWILIO_DEFECT_ALERT_ACTIONS_SID_EN is required"),
  TWILIO_DEFECT_ALERT_ACTIONS_SID_ML: z.string().min(1, "TWILIO_DEFECT_ALERT_ACTIONS_SID_ML is required"),
  TWILIO_DEFECT_DAYS_SID_EN: z.string().min(1, "TWILIO_DEFECT_DAYS_SID_EN is required"),
  TWILIO_DEFECT_DAYS_SID_ML: z.string().min(1, "TWILIO_DEFECT_DAYS_SID_ML is required"),
  TWILIO_DEFECT_REVIEW_ACTIONS_SID_EN: z.string().min(1, "TWILIO_DEFECT_REVIEW_ACTIONS_SID_EN is required"),
  TWILIO_DEFECT_REVIEW_ACTIONS_SID_ML: z.string().min(1, "TWILIO_DEFECT_REVIEW_ACTIONS_SID_ML is required"),
  TWILIO_DEFECT_SENT_ACTIONS_SID_EN: z.string().min(1, "TWILIO_DEFECT_SENT_ACTIONS_SID_EN is required"),
  TWILIO_DEFECT_SENT_ACTIONS_SID_ML: z.string().min(1, "TWILIO_DEFECT_SENT_ACTIONS_SID_ML is required"),
  // #38: the proactive hearing-reminder's will-attend/seek-adjournment
  // actions. MUST be an approved WhatsApp Message Template before use on
  // any non-Sandbox number — see hearing-sender.ts.
  TWILIO_HEARING_REMINDER_ACTIONS_SID_EN: z.string().min(1, "TWILIO_HEARING_REMINDER_ACTIONS_SID_EN is required"),
  TWILIO_HEARING_REMINDER_ACTIONS_SID_ML: z.string().min(1, "TWILIO_HEARING_REMINDER_ACTIONS_SID_ML is required"),
  PUBLIC_BASE_URL: z.string().url("PUBLIC_BASE_URL must be an absolute URL"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // #31: durable storage for uploaded filing documents (Vercel Blob). Set
  // automatically when a Blob store is linked to the Vercel project.
  BLOB_READ_WRITE_TOKEN: z.string().min(1, "BLOB_READ_WRITE_TOKEN is required"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  return parsed.data;
}

export const env = loadEnv();
