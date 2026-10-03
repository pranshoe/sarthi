import type { GrievanceState } from "@/shared/types";
import { normaliseDate } from "@/agent/guardrails";
import { findDateInText } from "@/state/dates";

/**
 * Proof extraction from uploaded broker emails / receipts.
 *
 * Two real extractors share one regex parser:
 * - images (screenshots, photos) go through Tesseract OCR,
 * - born-digital PDFs go through pdfjs text-layer extraction (no canvas).
 * Both are lazy/dynamic imports so the sidepanel bundle stays lean.
 */

export interface ProofFields {
  ticketNumber: string | null;
  /** ISO yyyy-mm-dd of the email send date, if found. */
  date: string | null;
  clientId: string | null;
  /** Raw text the fields were parsed from (truncated for logs). */
  rawExcerpt: string;
}

const TICKET =
  /(ticket|token|reference|\bref\.?|complaint|grievance)\s*(no|number|num|id)?\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]{2,})/i;
const CLIENT =
  /(client\s*(?:id|code)|ucc|folio(?:\s*no)?|dp\s*id)\s*(?:no\.?|#|:)?\s*([A-Z0-9]{4,16})/i;

/** Pure parser: ticket number, send date and client ID out of free text. */
export function parseProofText(text: string): ProofFields {
  const t = (text ?? "").trim();
  let ticketNumber: string | null = null;
  let date: string | null = null;
  let clientId: string | null = null;

  const ticket = t.match(TICKET);
  if (ticket?.[3]) ticketNumber = ticket[3].toUpperCase();

  // Prefer a line that looks like a date line, else scan the whole text.
  for (const line of t.split("\n")) {
    if (/date|sent|on/i.test(line)) {
      const d = normaliseDate(line.replace(/^[^:]*:\s*/, "")) ?? findDateInText(line);
      if (d) {
        date = d;
        break;
      }
    }
  }
  date ??= findDateInText(t);

  const client = t.match(CLIENT);
  if (client?.[2]) clientId = client[2].toUpperCase();

  return { ticketNumber, date, clientId, rawExcerpt: t.slice(0, 300) };
}

/** OCR a raster image (PNG/JPEG screenshot or photo) in English. */
export async function extractProofFromImageBytes(bytes: Uint8Array): Promise<ProofFields> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    // Node wants a Buffer, the browser wants a Blob.
    const image =
      typeof Buffer !== "undefined" ? Buffer.from(bytes) : new Blob([bytes as BlobPart]);
    const {
      data: { text },
    } = await worker.recognize(image as unknown as Blob);
    return parseProofText(text ?? "");
  } finally {
    await worker.terminate();
  }
}

/** Text-layer extraction from a born-digital PDF (no rendering needed). */
export async function extractProofFromPdfBytes(bytes: Uint8Array): Promise<ProofFields> {
  const pdfjs = (await import(
    /* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs"
  )) as unknown as {
    getDocument: (params: {
      data: ArrayBuffer;
      useSystemFonts?: boolean;
    }) => {
      promise: Promise<{
        numPages: number;
        getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }>;
        destroy?: () => Promise<void>;
        cleanup?: () => Promise<void>;
      }>;
    };
  };
  const doc = await pdfjs
    .getDocument({
      data: bytes.slice().buffer as ArrayBuffer,
      useSystemFonts: true,
    })
    .promise;
  try {
    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return parseProofText(parts.join("\n"));
  } finally {
    // destroy() exists on some pdfjs builds and not others; never let
    // teardown fail the extraction.
    try {
      await doc.destroy?.();
      await doc.cleanup?.();
    } catch {
      /* teardown is best-effort */
    }
  }
}

export interface ProofMismatch {
  mismatches: string[];
  /** User-facing message; empty when everything agrees. */
  message: string;
}

/**
 * Compare extracted proof against recorded state. Anything that disagrees is
 * flagged for the user to resolve — never silently overwritten.
 */
export function flagProofMismatch(state: GrievanceState, proof: ProofFields): ProofMismatch {
  const mismatches: string[] = [];
  if (
    proof.ticketNumber &&
    state.priorContactTicket &&
    proof.ticketNumber !== state.priorContactTicket
  ) {
    mismatches.push(
      `ticket number (proof says ${proof.ticketNumber}, recorded ${state.priorContactTicket})`,
    );
  }
  if (proof.date && state.priorContactDate && proof.date !== state.priorContactDate) {
    mismatches.push(
      `send date (proof says ${proof.date}, recorded ${state.priorContactDate})`,
    );
  }
  if (
    proof.clientId &&
    state.clientIdFolioNoDpid &&
    proof.clientId !== state.clientIdFolioNoDpid.toUpperCase()
  ) {
    mismatches.push(
      `client ID (proof says ${proof.clientId}, recorded ${state.clientIdFolioNoDpid})`,
    );
  }
  return {
    mismatches,
    message:
      mismatches.length === 0
        ? ""
        : `This document disagrees with what I recorded: ${mismatches.join("; ")}. Which one is right?`,
  };
}
