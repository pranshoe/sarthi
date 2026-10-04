/**
 * Local API proxy.
 *
 * The extension bundle NEVER contains an API key. Everything that needs a
 * secret calls this server, which reads keys from proxy/.env and forwards them.
 *
 * Why this exists (spec 2a): shipping a key in extension code means anyone who
 * unpacks the .crx has your credentials. A local proxy also keeps Sarvam usage
 * inside a spend cap.
 *
 * Run:  node --experimental-strip-types proxy/server.ts
 * or:   npm run proxy
 */

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- config ----

function loadEnv(): Record<string, string> {
  const p = join(__dirname, ".env");
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return i === -1 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const env = { ...loadEnv(), ...process.env };
const SARVAM_KEY = env.SARVAM_API_KEY ?? "";
const GEMINI_KEY = env.GEMINI_API_KEY ?? "";
const PORT = Number(env.PORT ?? 8787);

/**
 * Hard spend guard. Sarvam TTS is ~INR 30 per 10k chars,
 * so a runaway loop could otherwise drain the balance during a live demo.
 */
const SPEND_CAP_INR = Number(env.SPEND_CAP_INR ?? 100);
const TTS_RATE_PER_10K_CHARS = 30;

const spent = { ttsChars: 0, sarvamLlmIn: 0, sarvamLlmOut: 0 };

function estimateSpendINR(): number {
  return (
    (spent.ttsChars / 10_000) * TTS_RATE_PER_10K_CHARS +
    (spent.sarvamLlmIn / 1_000_000) * 29.28 +
    (spent.sarvamLlmOut / 1_000_000) * 73.2
  );
}

function overCap(): boolean {
  return estimateSpendINR() >= SPEND_CAP_INR;
}

// ---- helpers ----

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(buf);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      // 25 MB ceiling against runaway or abusive payloads.
      if (size > 25 * 1024 * 1024) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---- routes ----

async function handleTts(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!SARVAM_KEY) return json(res, 503, { error: "SARVAM_API_KEY not set in proxy/.env" });
  if (overCap()) return json(res, 429, { error: "spend cap reached", spent: estimateSpendINR() });

  const body = await readBody(req);
  const incoming = JSON.parse(body.toString()) as {
    text: string;
    language_code: string;
    model?: string;
    speaker?: string;
  };

  const upstream = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": SARVAM_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: incoming.text,
      language_code: incoming.language_code,
      model: incoming.model ?? "bulbul:v3",
      speaker: incoming.speaker ?? "anushka",
    }),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    console.error(`[proxy] tts ${upstream.status}: ${text.slice(0, 200)}`);
    return json(res, upstream.status, { error: "tts failed", detail: text.slice(0, 300) });
  }

  spent.ttsChars += incoming.text?.length ?? 0;
  // Passthrough: Sarvam returns { audios: string[] } which the client decodes.
  res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
  res.end(text);
}

async function handleSarvamLlm(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!SARVAM_KEY) return json(res, 503, { error: "SARVAM_API_KEY not set in proxy/.env" });
  const body = await readBody(req);
  const upstream = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "api-subscription-key": SARVAM_KEY,
      "Content-Type": "application/json",
    },
    body: body.toString("utf8"),
  });
  const text = await upstream.text();
  res.writeHead(upstream.status, { ...CORS, "Content-Type": "application/json" });
  res.end(text);
}

async function handleGemini(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!GEMINI_KEY) return json(res, 503, { error: "GEMINI_API_KEY not set in proxy/.env" });

  const raw = await readBody(req);
  const payloadStr = raw.toString("utf8");
  
  let payloadObj: any = {};
  try { payloadObj = JSON.parse(payloadStr); } catch {}
  
  const model = payloadObj.model || "gemini-2.5-flash";
  if (payloadObj.model) delete payloadObj.model;
  const payload = JSON.stringify(payloadObj);

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_KEY,
        "Content-Type": "application/json",
      },
      body: payload,
    },
  );

  const text = await upstream.text();
  if (!upstream.ok) {
    console.error(`[proxy] gemini ${upstream.status}: ${text.slice(0, 300)}`);
    return json(res, upstream.status, { error: "gemini failed", detail: text.slice(0, 400) });
  }
  const usage = safeUsage(text);
  if (usage.prompt || usage.completion) {
    console.log(`[proxy] gemini ok, tokens: ${usage.prompt} in / ${usage.completion} out`);
  }
  res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
  res.end(text);
}

function safeUsage(body: string): Record<string, number> {
  try {
    const j = JSON.parse(body) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    return {
      prompt: j.usageMetadata?.promptTokenCount ?? 0,
      completion: j.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch {
    return {};
  }
}

// ---- server ----

/**
 * Bump whenever a route path or body contract changes. The extension checks
 * this on startup and shouts when the running proxy predates the bundle
 * (stale-proxy 404s otherwise surface as cryptic per-model failures).
 */
export const PROXY_PROTOCOL = "sarthi-proxy/2";

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      protocol: PROXY_PROTOCOL,
      sarvam: Boolean(SARVAM_KEY),
      gemini: Boolean(GEMINI_KEY),
      spentINR: Number(estimateSpendINR().toFixed(3)),
      capINR: SPEND_CAP_INR,
      usage: spent,
    });
  }

  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>> = {
    "/speech/tts": handleTts,
    "/sarvam/v1/chat/completions": handleSarvamLlm,
    "/llm/chat": handleGemini,
  };

  const route = routes[url.pathname];
  if (route) {
    route(req, res).catch((e: Error) => {
      console.error("[proxy]", e.message);
      if (!res.headersSent) json(res, 500, { error: e.message });
    });
    return;
  }


  json(res, 404, { error: "unknown route" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  sarthi proxy  ->  http://127.0.0.1:${PORT}`);
  console.log(`  sarvam key : ${SARVAM_KEY ? "loaded" : "MISSING (proxy/.env)"}`);
  console.log(`  gemini key : ${GEMINI_KEY ? "loaded" : "MISSING (proxy/.env)"}`);
  console.log(`  spend cap  : INR ${SPEND_CAP_INR}`);
  console.log(`  spent      : INR ${estimateSpendINR().toFixed(3)}\n`);
});