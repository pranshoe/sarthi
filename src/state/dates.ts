/** Date helpers. All state dates are ISO yyyy-mm-dd strings. */

export function parseISODate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function todayISO(): string {
  return toLocalISO(new Date());
}

/**
 * Format a Date as local yyyy-mm-dd. Never use toISOString() for this:
 * it converts to UTC, which returns the previous day for IST.
 */
export function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDate(v: Date | string): Date | null {
  return v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v) : parseISODate(v);
}

/** Whole days from a to b. Accepts ISO strings or Date objects. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function formatHuman(iso: string | null | undefined, locale = "en-IN"): string {
  const d = parseISODate(iso);
  if (!d) return "";
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const FIND_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoParts(d: number, m: number, y: number): string | null {
  if (!Number.isFinite(d) || !Number.isFinite(m) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return toLocalISO(dt);
}

/**
 * Find a date mentioned anywhere inside a longer message
 * ("emailed them on 12th March", "sent it 5 days ago").
 * Explicit years win; a bare day+month resolves to its most recent
 * past occurrence. Returns null when nothing date-like is present.
 */
export function findDateInText(text: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;

  const verbal = t.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\b(?!\d)/i,
  );
  if (verbal) {
    const m = FIND_MONTHS[verbal[2]!.slice(0, 3).toLowerCase()];
    if (m) {
      const explicit = /20\d{2}|19\d{2}/.exec(t)?.[0];
      if (explicit) return isoParts(Number(verbal[1]), m, Number(explicit));
      const today = new Date();
      let out = isoParts(Number(verbal[1]), m, today.getFullYear());
      if (out) {
        const asDate = new Date(`${out}T00:00:00`);
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        if (asDate.getTime() > startOfToday.getTime()) {
          out = isoParts(Number(verbal[1]), m, today.getFullYear() - 1);
        }
      }
      return out;
    }
  }

  const numeric = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (numeric) {
    let y = Number(numeric[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return isoParts(Number(numeric[1]), Number(numeric[2]), y);
  }

  const isoIn = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoIn) return `${isoIn[1]}-${isoIn[2]}-${isoIn[3]}`;

  const ago = t.match(/(\d+)\s*(day|week|month|year)s?\s*(ago|back|earlier|පෙර|முன்பு|ಹಿಂದೆ|पहले)?/i);
  if (ago) {
    const n = Number(ago[1]);
    const unit = ago[2]!.toLowerCase();
    const mult = unit.startsWith("week") ? 7 : unit.startsWith("month") ? 30 : unit.startsWith("year") ? 365 : 1;
    const d = new Date();
    d.setDate(d.getDate() - n * mult);
    return toLocalISO(d);
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}