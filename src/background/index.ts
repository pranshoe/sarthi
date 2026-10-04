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
  // which matters because a popup closes on blur and loses the conversation.
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch(() => {});

// ---- alarms and notifications ----

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("track_")) {
    const ticket = alarm.name.split("_")[1];
    chrome.notifications?.create({
      type: "basic",
      iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", // 1x1 transparent fallback
      title: "Sarthi: SEBI Update",
      message: `Your grievance ticket #${ticket} has been updated. The entity has submitted a reply.`,
      priority: 2,
    });
  }
});

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

    case "tts/speak": {
      const res = await callProxy("/speech/tts", {
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

    case "alarm/set": {
      if (chrome.alarms) {
        chrome.alarms.create(`track_${msg.payload.ticketNumber}`, {
          delayInMinutes: msg.payload.delayMinutes,
        });
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: "unknown request" };
  }
}

// Must match PROXY_PROTOCOL in proxy/server.ts. Bump both together.
const EXPECTED_PROXY_PROTOCOL = "sarthi-proxy/2";

// Surface proxy status so the panel can warn before the demo if it is down.
chrome.runtime.onInstalled.addListener(() => {
  void proxyHealth().then((h) => {
    console.info("[sarthi] proxy:", h);
    if (h && h.protocol && h.protocol !== EXPECTED_PROXY_PROTOCOL) {
      console.error(
        `[sarthi] PROXY MISMATCH: running proxy speaks ${h.protocol}, ` +
          `extension expects ${EXPECTED_PROXY_PROTOCOL}. ` +
          `Kill the old proxy and restart it with \`npm run proxy\` from the current sources, then reload the extension.`,
      );
    }
  });
});