import type { ContentRequest, ContentResponse, FillReport, GrievanceState } from "@/shared/types";
import { adapterFor } from "@/portal/adapter";
import { fillPortal, protectedElementsPresent } from "@/portal/fillEngine";

/**
 * Runs on the SEBI SCORES and IEPF pages. Two jobs only:
 *   1. Notice we are on a supported portal and show a small launcher.
 *   2. Fill fields on request, then get out of the way.
 *
 * It never clicks Submit and never touches a CAPTCHA (see fillEngine).
 */

const LAUNCHER_ID = "saathi-launcher";
let report: FillReport | null = null;

function adapterForThisPage() {
  return adapterFor(location.hostname);
}

function mountLauncher(): void {
  if (document.getElementById(LAUNCHER_ID)) return;
  const adapter = adapterForThisPage();
  if (!adapter) return;

  const host = document.createElement("div");
  host.id = LAUNCHER_ID;
  Object.assign(host.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    zIndex: "2147483647",
    fontFamily: "system-ui, sans-serif",
  });

  const button = document.createElement("button");
  button.textContent = "Saathi";
  button.title = `Open Saathi to file on ${adapter.displayName}`;
  Object.assign(button.style, {
    padding: "12px 18px",
    borderRadius: "999px",
    border: "none",
    background: "linear-gradient(135deg,#1a56db,#6d28d9)",
    color: "#fff",
    fontWeight: "700",
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(0,0,0,.25)",
  });
  button.onclick = () => void openPanel();

  const badge = document.createElement("div");
  badge.id = "saathi-badge";
  badge.style.cssText =
    "display:none;margin-top:8px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;" +
    "padding:8px;font-size:11px;color:#0f172a;box-shadow:0 6px 20px rgba(0,0,0,.15);max-width:240px";

  host.append(button, badge);
  document.documentElement.appendChild(host);
}

async function openPanel(): Promise<void> {
  // Ask the service worker; it owns the sidePanel API.
  try {
    await chrome.runtime.sendMessage({ type: "panel/open", payload: {} });
  } catch {
    console.warn("[saathi] could not open the side panel");
  }
}

function renderBadge(): void {
  const badge = document.getElementById("saathi-badge");
  if (!badge || !report) return;
  const rows = report.results
    .map((r) => {
      const mark =
        r.status === "filled"
          ? "✓"
          : r.status === "ambiguous"
            ? "!"
            : r.status === "skipped"
              ? "–"
              : "?";
      return `<div style="padding:1px 0">${mark} ${r.key}${r.detail ? ` — ${escapeHtml(r.detail)}` : ""}</div>`;
    })
    .join("");
  badge.innerHTML =
    `<strong>Saathi filled ${report.results.filter((r) => r.status === "filled").length} field(s)</strong>` +
    rows +
    `<div style="margin-top:6px;border-top:1px solid #e2e8f0;padding-top:6px;color:#b91c1c">` +
    `Still yours: ${protectedElementsPresent().join(", ") || "the Submit button"}</div>`;
  badge.style.display = "block";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
  (async (): Promise<ContentResponse> => {
    try {
      if (msg.type === "portal/detect") {
        return { ok: true, portal: adapterForThisPage()?.id ?? null };
      }

      if (msg.type === "portal/fill") {
        const state = msg.payload.state as GrievanceState;
        report = await fillPortal(state);
        renderBadge();
        return { ok: true, filled: report };
      }

      if (msg.type === "portal/highlight") {
        document
          .querySelectorAll("[data-saathi-filled]")
          .forEach((el) => ((el as HTMLElement).style.boxShadow = ""));
        for (const sel of msg.payload.fields) {
          document.querySelectorAll(sel).forEach((el) => {
            (el as HTMLElement).style.boxShadow = "0 0 0 3px rgba(26,86,219,.4)";
            (el as HTMLElement).style.transition = "box-shadow .3s ease";
          });
        }
        return { ok: true, filled: report ?? emptyReport() };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return { ok: false, error: "unknown request" };
  })().then(sendResponse);
  return true; // async response
});

function emptyReport(): FillReport {
  return { portal: "unknown", results: [], captchaDetected: false, submitDisabled: true };
}

// SPAs swap content without a reload, so keep an eye out for the form.
function ensureLauncher(): void {
  mountLauncher();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureLauncher);
} else {
  ensureLauncher();
}

// Re-check on navigation for client-side routed portals.
const observer = new MutationObserver(() => ensureLauncher());
observer.observe(document.documentElement, { childList: true, subtree: true });