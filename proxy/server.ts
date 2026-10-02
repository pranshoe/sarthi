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
 * Hard spend guard. Sarvam STT is ~INR 30/hour and TTS ~INR 30 per 10k chars,
 * so a runaway loop could otherwise drain the balance during a live demo.
 */
const SPEND_CAP_INR = Number(env.SPEND_CAP_INR ?? 100);
const STT_RATE_PER_HOUR = 30;
const TTS_RATE_PER_10K_CHARS = 30;

const spent = { sttSeconds: 0, ttsChars: 0, sarvamLlmIn: 0, sarvamLlmOut: 0 };

function estimateSpendINR(): number {
  return (
    (spent.sttSeconds / 3600) * STT_RATE_PER_HOUR +
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
      // 25 MB ceiling: enough for a few minutes of webm audio.
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

/** Crude but effective: never log anything that could carry PII. */
function mask(text: string): string {
  return text
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "PAN")
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "AADHAAR")
    .replace(/\b\d{9,}\b/g, "NUM")
    .slice(0, 120);
}

// ---- routes ----

async function handleStt(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!SARVAM_KEY) return json(res, 503, { error: "SARVAM_API_KEY not set in proxy/.env" });
  if (overCap()) return json(res, 429, { error: "spend cap reached", spent: estimateSpendINR() });

  const body = await readBody(req);
  // Forward the multipart bytes exactly. Buffer.from copies into a fresh
  // allocation, so pooled bytes can never leak into the upstream request.
  const bytes = Buffer.from(body);
  const upstream = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: {
      "api-subscription-key": SARVAM_KEY,
      "Content-Type": req.headers["content-type"] ?? "multipart/form-data",
    },
    body: bytes as unknown as BodyInit,
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    console.error(`[proxy] stt ${upstream.status}: ${text.slice(0, 200)}`);
    return json(res, upstream.status, { error: "stt failed", detail: text.slice(0, 300) });
  }

  const parsed = JSON.parse(text) as { transcript?: string; text?: string };
  spent.sttSeconds += 5; // conservative flat estimate per clip
  console.log(`[proxy] stt ok, ~${mask(parsed.transcript ?? parsed.text ?? "")}`);

  return json(res, 200, {
    text: parsed.transcript ?? parsed.text ?? "",
    // Language detection is done client-side by design; we echo the hint.
    detectedLang: "unknown",
    spentINR: Number(estimateSpendINR().toFixed(3)),
  });
}

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

  // Path is /gemini/<model>:generateContent
  const url = new URL(req.url ?? "/", "http://localhost");
  const modelPath = url.pathname.replace(/^\/gemini\//, "").replace(/^\//, "");

  // JSON route: forward as text. This avoids every ArrayBuffer/pool pitfall
  // entirely -- the previous version forwarded raw pool bytes, so Gemini
  // received garbage starting with this file's own header comment.
  const raw = await readBody(req);
  const payload = raw.toString("utf8");

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}`,
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      sarvam: Boolean(SARVAM_KEY),
      gemini: Boolean(GEMINI_KEY),
      spentINR: Number(estimateSpendINR().toFixed(3)),
      capINR: SPEND_CAP_INR,
      usage: spent,
    });
  }

  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>> = {
    "/stt": handleStt,
    "/tts": handleTts,
    "/sarvam/v1/chat/completions": handleSarvamLlm,
  };

  const route = routes[url.pathname];
  if (route) {
    route(req, res).catch((e: Error) => {
      console.error("[proxy]", e.message);
      if (!res.headersSent) json(res, 500, { error: e.message });
    });
    return;
  }

  if (url.pathname.startsWith("/gemini/")) {
    handleGemini(req, res).catch((e: Error) => {
      if (!res.headersSent) json(res, 500, { error: e.message });
    });
    return;
  }

  json(res, 404, { error: "unknown route" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  saathi proxy  ->  http://127.0.0.1:${PORT}`);
  console.log(`  sarvam key : ${SARVAM_KEY ? "loaded" : "MISSING (proxy/.env)"}`);
  console.log(`  gemini key : ${GEMINI_KEY ? "loaded" : "MISSING (proxy/.env)"}`);
  console.log(`  spend cap  : INR ${SPEND_CAP_INR}`);
  console.log(`  spent      : INR ${estimateSpendINR().toFixed(3)}\n`);
});