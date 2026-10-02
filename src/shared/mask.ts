/** Masks PAN / Aadhaar-shaped numbers so they never reach logs. */
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const AADHAAR = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;
const UCC = /\b(?:UCC|Client\s*ID)\s*[:\-#]?\s*([A-Z0-9]{4,12})\b/gi;
const LONG_DIGITS = /\b\d{9,}\b/g;

export function maskPAN(v: string): string {
  return v.replace(PAN, (m) => `${m.slice(0, 2)}****${m.slice(-1)}`);
}
export function maskAadhaar(v: string): string {
  return v.replace(AADHAAR, (m) => `XXXX XXXX ${m.replace(/\D/g, "").slice(-4)}`);
}
export function maskUCC(v: string): string {
  return v.replace(UCC, (_m, id: string) => `UCC: ***${id.slice(-2)}`);
}

/** Scrub anything that looks like a government identifier before logging. */
export function scrub(text: string): string {
  let out = maskPAN(text);
  out = maskUCC(out);
  out = maskAadhaar(out);
  out = out.replace(LONG_DIGITS, (m) => `num(${m.length})`);
  return out;
}