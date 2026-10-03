import type { Attachment } from "@/shared/types";

/**
 * Attach a user-selected PDF to a file input.
 *
 * Attachments are held in memory in the side panel and passed over as data
 * URLs, so nothing touches disk. DataTransfer is the only way to populate an
 * <input type="file"> programmatically; a plain assignment does nothing.
 */

/** SCORES limits each complaint document to 2MB. */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB. ` +
        `SCORES accepts up to 2MB per document.`,
    );
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
  return { dataUrl, name: file.name, size: file.size, type: file.type };
}

export function dataUrlToFile(a: Attachment): File {
  const [meta = "", payload = ""] = a.dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? a.type ?? "application/pdf";
  const bin = atob(payload ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes.buffer as ArrayBuffer], a.name, { type: mime });
}

/** Put files onto a file input. Returns false when the browser blocks it. */
export function attachToInput(selector: string, files: Attachment[]): boolean {
  const input = document.querySelector(selector) as HTMLInputElement | null;
  if (!input) return false;

  const dt = new DataTransfer();
  for (const a of files) dt.items.add(dataUrlToFile(a));
  input.files = dt.files;

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.setAttribute("data-sarthi-filled", "true");
  return true;
}

/** Pick a file input that looks like the document upload on this page. */
export function guessFileInput(): string | null {
  const candidates = [
    "input[type='file']",
    "input[accept*='pdf' i]",
    "input[name*='attach' i]",
    "input[name*='document' i]",
    "input[id*='upload' i]",
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) return sel;
  }
  return null;
}