import type { WorkerRequest, WorkerResponse } from "@/shared/types";
import { gmailComposeUrl } from "@/agent/emailDraft";
import { config } from "@/shared/config";

/**
 * Service worker.
 *
 * Owns three things the side panel should not: the sidePanel API, the proxy
 * (so no key ever reaches the panel bundle), and typing the message boundary.
 */

// ---- side panel ----

chrome.runtime.onInstalled.addListener(() => {
  // Chrome: clicking the toolbar icon opens the side panel and it stays open,
  // which matters because a popup closes on blur and would kill the microphone.
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch(() => {});

// ---- proxy calls ----

function proxy(path: string): string {
  return `${config.proxyUrl.replace(/\/$/, "")}${path}`;
}

async function callProxy(path: string, init: RequestInit): Promise<Response> {
  return fetch(proxy(path), init);
}

async function proxyHealth() {
  try {
    const res = await fetch(`${config.proxyUrl.replace(/\/$/, "")}/health`);
    return await res.json();
  } catch {
    return null;
  }
}

// ---- typed router ----

chrome.runtime.onMessage.addListener((msg: WorkerRequest, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch((e: Error) =>
    sendResponse({ ok: false, error: e.message } satisfies WorkerResponse),
  );
  return true; // async
});

async function handle(msg: WorkerRequest, sender: chrome.runtime.MessageSender): Promise<WorkerResponse> {
  switch (msg.type) {
    case "panel/open": {
      if (chrome.sidePanel?.open) {
        const windowId = sender.tab?.windowId;
        if (windowId !== undefined) await chrome.sidePanel.open({ windowId });
        return { ok: true };
      }
      return { ok: true };
    }

    case "gmail/open": {
      // Compose URL only. We never touch Gmail's DOM and never send anything.
      // "to" may be empty on purpose when the broker has no verified address.
      await chrome.tabs.create({ url: gmailComposeUrl(msg.payload.to, msg.payload.subject, msg.payload.body) });
      return { ok: true };
    }

    case "stt/transcribe": {
      const { audio, langHint } = msg.payload;
      const blob = new Blob([audio], { type: "audio/webm" });
      const fd = new FormData();
      fd.append("file", blob, "clip.webm");
      fd.append("model", "saaras:v4");
      fd.append("mode", "transcribe");
      fd.append("language_code", langHint && langHint !== "auto" ? langHint : "unknown");

      const res = await callProxy("/stt", { method: "POST", body: fd });
      const body = (await res.json()) as { text?: string; detectedLang?: string; error?: string };
      if (!res.ok) {
        return { ok: false, error: body.error ?? `stt ${res.status}`, detail: JSON.stringify(body) };
      }
      return { ok: true, text: body.text ?? "", detectedLang: body.detectedLang ?? "unknown" };
    }

    case "tts/speak": {
      const res = await callProxy("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload),
      });
      const body = (await res.json()) as { audios?: string[]; error?: string };
      if (!res.ok) {
        return { ok: false, error: body.error ?? `tts ${res.status}` };
      }
      return { ok: true, audio: body.audios?.[0] ?? "" };
    }

    case "llm/turn": {
      // The LLM is called from the panel directly so we can keep the React state
      // loop simple. This branch exists for callers that prefer the worker.
      return { ok: false, error: "llm/turn is handled in the panel" };
    }

    default:
      return { ok: false, error: "unknown request" };
  }
}

// Surface proxy status so the panel can warn before the demo if it is down.
chrome.runtime.onInstalled.addListener(() => {
  void proxyHealth().then((h) => console.info("[saathi] proxy:", h));
});