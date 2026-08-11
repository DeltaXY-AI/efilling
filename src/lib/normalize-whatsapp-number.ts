/**
 * Normalizes a WhatsApp identifier (e.g. "whatsapp:+14155238886") before it
 * is used as a conversation lookup/storage key, so lookups are consistent
 * regardless of incidental casing or surrounding whitespace in the source
 * value.
 */
export function normalizeWhatsappNumber(raw: string): string {
  return raw.trim().toLowerCase();
}
