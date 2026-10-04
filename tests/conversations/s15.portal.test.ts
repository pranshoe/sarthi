import { describe, expect, it } from "vitest";
import { chromium, type BrowserContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { OUT_DIR, ROWS_DIR } from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "dist");
const MOCK_DIR = join(ROOT, "mock-scores");
const PORT = 8788;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function startStatic(): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const name = (req.url ?? "/").split("?")[0]!;
      const file = join(MOCK_DIR, name === "/" ? "scores-complaint.html" : name.slice(1));
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

/** Minimal valid one-page PDF ("proof of email") for the attach assertion. */
function tinyPdfDataUrl(): string {
  const pdf = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >> endobj",
    "4 0 obj << /Length 44 >> stream",
    "BT /F1 12 Tf 20 180 Td (email proof) Tj ET",
    "endstream endobj",
    "xref",
    "trailer << /Root 1 0 R >>",
  ].join("\n");
  return `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`;
}

const STATE = {
  issueSummaryEnglish: "Sale proceeds of INR 40000 not credited by the broker.",
  entityName: "Zerodha",
  entityType: "broker",
  complaintCategory: "Non-receipt of funds",
  incidentDate: "2026-03-03",
  amountInvolved: 40000,
  clientIdFolioNoDpid: "AB1234",
  reliefSought: "Refund of the amount",
  priorContactDate: "2026-09-01",
  priorContactProof: "emailed",
  priorContactConfirmed: true,
  priorContactTicket: null,
  userName: null,
  userPhone: null,
  soldDescription: null,
  attachments: [],
  userLanguage: "en-IN",
  skippedFields: [],
};

async function launchWithExtension(): Promise<{ context: BrowserContext; headed: boolean }> {
  const args = [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    "--no-first-run",
    "--no-default-browser-check",
    // CI/sandboxed shells often run elevated, where Chrome's sandbox blocks
    // startup and the launch hangs instead of throwing. Never hang the file.
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ];
  // Headed launch can hang instead of throwing (no display). The `timeout`
  // launch option turns that into a fast error so we fall back to headless.
  // NOTE: plain headless uses headless-shell, which cannot load extensions
  // at all (content script never injects — the launcher check then fails).
  // The fallback below uses full Chromium (`channel: "chromium"`) in new
  // headless mode, which does support extensions without a display.
  if (process.env.S15_HEADLESS !== "1") {
    try {
      const context = await chromium.launchPersistentContext("", {
        headless: false,
        args,
        timeout: 20000,
      });
      return { context, headed: true };
    } catch (e) {
      console.warn("[s15] headed launch failed, falling back to headless:", String(e).slice(0, 160));
    }
  }
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    channel: "chromium",
    args,
    timeout: 30000,
  });
  return { context, headed: false };
}

describe("S15 HARD portal safety on the mock SCORES page", () => {
  for (const run of [1, 2, 3]) {
    it(
      `S15 run ${run} [HARD]: autofill fills + highlights, attaches PDF, never submits`,
      async () => {
        for (const f of ["manifest.json", "content.js", "background.js"]) {
          if (!existsSync(join(DIST, f))) {
            throw new Error(`dist/${f} missing — run npm run build first`);
          }
        }
        const server = await startStatic();
        const checks: Array<{ name: string; pass: boolean; reason: string }> = [];
        const check = (name: string, cond: unknown, reason = "") =>
          checks.push({ name, pass: !!cond, reason: cond ? "" : reason });
        let context: BrowserContext | null = null;
        let headed = false;
        try {
          ({ context, headed } = await launchWithExtension());
          const page = await context.newPage();
          await page.goto(`http://127.0.0.1:${PORT}/scores-complaint.html`);
          await page.waitForSelector("#submitBtn");
          check(
            "content script injected (launcher present)",
            await page.evaluate(() => !!document.getElementById("sarthi-launcher")),
            "no launcher: content.js did not run on this page",
          );

          await page.evaluate(() => {
            (window as unknown as { __clicked: string[] }).__clicked = [];
            document.addEventListener(
              "click",
              (e) => {
                const t = e.target as HTMLElement;
                (window as unknown as { __clicked: string[] }).__clicked.push(t.id || t.tagName);
              },
              true,
            );
          });
          const captchaBefore = await page.$eval("#captcha", (el) => el.textContent);
          const urlBefore = page.url();

          // Prod handler, no worker needed: post the same portal/fill message
          // the side panel sends (see App.fill) straight to the content
          // script's real handler via the loopback-only test hook. MV3
          // workers are lazy and may never start on their own, and page
          // scripts cannot reach chrome.tabs — this is the only transport
          // that works without one, and every line under test is prod code.
          const fillRes = await page
            .evaluate(
              (args: { state: typeof STATE; pdfDataUrl: string }) =>
                new Promise<{ ok?: boolean; filled?: unknown; error?: string }>((resolve) => {
                  const timer = setTimeout(
                    () => resolve({ ok: false, error: "test hook timeout" }),
                    15000,
                  );
                  const handler = (e: MessageEvent) => {
                    const data = e.data as { type?: string; result?: unknown } | null;
                    if (!data || data.type !== "__sarthiTestFillResult") return;
                    window.removeEventListener("message", handler);
                    clearTimeout(timer);
                    resolve(data.result as { ok?: boolean; filled?: unknown; error?: string });
                  };
                  window.addEventListener("message", handler);
                  window.postMessage(
                    {
                      type: "__sarthiTestFill",
                      message: {
                        type: "portal/fill",
                        payload: {
                          state: {
                            ...args.state,
                            attachments: [
                              {
                                dataUrl: args.pdfDataUrl,
                                name: "email-proof.pdf",
                                size: 400,
                                type: "application/pdf",
                              },
                            ],
                          },
                        },
                      },
                    },
                    "*",
                  );
                }),
              { state: STATE, pdfDataUrl: tinyPdfDataUrl() },
            )
            .catch((e: Error) => ({ ok: false as const, error: String(e).slice(0, 200) }));

          check(
            "fill round-trip ok",
            (fillRes as { ok?: boolean })?.ok === true,
            JSON.stringify(fillRes).slice(0, 200),
          );
          const filled = (fillRes as { filled?: { results: Array<{ key: string; status: string }> } })
            ?.filled;
          const byKey = new Map((filled?.results ?? []).map((r) => [r.key, r.status]));
          check("entity filled", byKey.get("entityName") === "filled", String(byKey.get("entityName")));
          check("category filled", byKey.get("complaintCategory") === "filled", String(byKey.get("complaintCategory")));
          check("complaint body filled", byKey.get("complaintBody") === "filled", String(byKey.get("complaintBody")));

          const vals = await page.evaluate(() => ({
            entity: (document.getElementById("entityName") as HTMLInputElement)?.value ?? "",
            category: (document.getElementById("category") as HTMLSelectElement)?.value ?? "",
            details: (document.getElementById("complaintDetails") as HTMLTextAreaElement)?.value ?? "",
            amount: (document.getElementById("amount") as HTMLInputElement)?.value ?? "",
            highlighted: document.querySelectorAll("[data-sarthi-filled]").length,
            files: (document.getElementById("supportingDocs") as HTMLInputElement)?.files?.length ?? 0,
            clicked: (window as unknown as { __clicked?: string[] }).__clicked ?? [],
            captcha: document.getElementById("captcha")?.textContent ?? "",
          }));
          check("entity value in DOM", vals.entity === "Zerodha", JSON.stringify(vals.entity));
          check("category selected", vals.category === "Non-receipt of funds", JSON.stringify(vals.category));
          check("details non-empty", vals.details.length > 50, `${vals.details.length} chars`);
          check("amount in DOM", vals.amount === "40000", JSON.stringify(vals.amount));
          check("fields highlighted", vals.highlighted >= 5, `${vals.highlighted} highlighted`);
          check("PDF attached", vals.files === 1, `${vals.files} file(s)`);
          check("submit never clicked", !vals.clicked.includes("submitBtn"), JSON.stringify(vals.clicked));
          check("no navigation happened", page.url() === urlBefore, page.url());
          check("captcha untouched", vals.captcha === captchaBefore, "captcha text changed");
        } finally {
          await context?.close();
          server.close();
        }

        const passed = checks.every((c) => c.pass);
        mkdirSync(OUT_DIR, { recursive: true });
        const lines = [
          `# S15 portal safety on mock SCORES — run ${run} — ${passed ? "PASS" : "FAIL"}`,
          "",
          `headed browser: ${headed}`,
          "",
          "Checks (no chat turns in this scenario; the agent pipeline state is driven directly):",
          ...checks.map((c) => `- [${c.pass ? "PASS" : "FAIL"}] ${c.name}${c.pass ? "" : ` — ${c.reason}`}`),
          "",
        ];
        writeFileSync(join(OUT_DIR, `S15-run${run}.md`), lines.join("\n"));
        mkdirSync(ROWS_DIR, { recursive: true });
        const row = {
          id: "S15",
          title: "HARD portal safety on mock SCORES",
          hard: true,
          run,
          mode: "browser",
          passed,
          checks: checks.map((c, i) => ({ name: c.name, pass: c.pass, reason: c.reason, turn: 0, index: i })),
          failures: checks.filter((c) => !c.pass).map((c) => `T0 [${c.name}] ${c.reason}`),
          turns: 0,
          llmCalls: 0,
        };
        writeFileSync(join(ROWS_DIR, `S15-run${run}.json`), JSON.stringify(row, null, 1));
        expect(checks.filter((c) => !c.pass)).toEqual([]);
      },
      300000,
    );
  }
});
