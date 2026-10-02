import type { FillReport, GrievanceState } from "@/shared/types";
import {
  FORBIDDEN_SELECTORS,
  adapterFor,
  buildComplaintBody,
  type FieldMapping,
} from "./adapter";
import { config } from "@/shared/config";

/**
 * Fill engine.
 *
 * Two rules it will not break, per spec 7:
 *   1. It never clicks Submit.
 *   2. It never touches a CAPTCHA.
 * FORBIDDEN_SELECTORS is checked on every field, so a badly written adapter
 * config cannot get us into trouble.
 */

const HIGHLIGHT = "saathi-filled";

export interface FillOptions {
  /** Called before filling a field marked `confirm`. */
  confirm?: (field: FieldMapping) => Promise<boolean>;
  dryRun?: boolean;
}

export async function detectPortal(hostname: string, path: string, bodyText: string) {
  const adapter = adapterFor(hostname);
  if (!adapter) return null;
  if (adapter.pathIncludes && adapter.pathIncludes.length) {
    const inPath = adapter.pathIncludes.some((p) => path.includes(p));
    const inDom = (adapter.domMarkers ?? []).some((m) => bodyText.includes(m));
    if (!inPath && !inDom) return adapter; // still show the launcher
  }
  return adapter;
}

function isForbidden(el: Element): boolean {
  return FORBIDDEN_SELECTORS.some((sel) => {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  });
}

function locate(field: FieldMapping): { el: HTMLElement | null; used: string } {
  for (const sel of [field.selector, ...(field.fallbackSelectors ?? [])]) {
    try {
      const el = document.querySelector(sel);
      if (el) return { el: el as HTMLElement, used: sel };
    } catch {
      /* invalid selector, try the next one */
    }
  }
  return { el: null, used: field.selector };
}

/** 
 * Self-Healing Web Automation:
 * If the primary selector misses, extract the page inputs and ask the LLM for the new selector.
 */
async function healSelector(field: FieldMapping): Promise<string | null> {
  try {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    const domSimplified = inputs.map(el => {
      let html = el.outerHTML;
      if (html.length > 200) html = html.substring(0, 200) + "...";
      return html;
    }).join("\n");

    const prompt = `You are a Self-Healing Web Automation agent. The primary CSS selector for the field "${field.label}" failed.
Here are the current input elements on the page:
${domSimplified}

Based on the 'name', 'id', or 'placeholder' attributes above, what is the best CSS selector to find the "${field.label}" field? 
Respond ONLY with the raw CSS selector string (e.g., input[name='new_name']), no markdown, no quotes, no explanation.`;

    const proxyUrl = `${config.proxyUrl.replace(/\/$/, "")}/llm/chat`;
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    });

    if (!res.ok) return null;
    const json = await res.json() as any;
    let selector = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    selector = selector.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim();
    
    // Quick validation
    if (selector && document.querySelector(selector)) {
      return selector;
    }
    return null;
  } catch (e) {
    console.warn("[saathi] Self-healing failed for", field.label, e);
    return null;
  }
}

/**
 * Set a value in a way frameworks actually notice. React tracks the previous
 * value on the DOM node, so assigning .value directly is silently ignored.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/** Fuzzy option match: exact, then substring, then token overlap. */
export function matchOption(
  options: Array<{ value: string; text: string }>,
  wanted: string,
): { value: string; how: "exact" | "substring" | "token" } | null {
  const w = wanted.trim().toLowerCase();
  if (!w) return null;

  for (const o of options) {
    if (o.text.trim().toLowerCase() === w || o.value.toLowerCase() === w) {
      return { value: o.value, how: "exact" };
    }
  }
  for (const o of options) {
    if (o.text.toLowerCase().includes(w) || w.includes(o.text.toLowerCase().trim())) {
      return { value: o.value, how: "substring" };
    }
  }
  // Token overlap, e.g. "Non-receipt of funds" vs "Non receipt of amount".
  const wantTokens = w.split(/\s+/).filter((t) => t.length > 2);
  for (const o of options) {
    const text = o.text.toLowerCase();
    const hits = wantTokens.filter((t) => text.includes(t)).length;
    if (wantTokens.length > 0 && hits / wantTokens.length >= 0.6) {
      return { value: o.value, how: "token" };
    }
  }
  return null;
}

function highlight(el: HTMLElement): void {
  el.classList.add(HIGHLIGHT);
  el.setAttribute("data-saathi-filled", "true");
  if (el instanceof HTMLElement) {
    el.style.transition = "box-shadow .3s ease";
    el.style.boxShadow = "0 0 0 3px rgba(26,86,219,.35)";
  }
}

function valueFor(field: FieldMapping, state: GrievanceState): string | null {
  switch (field.key) {
    case "complaintBody":
      return buildComplaintBody(state);
    case "amountInvolved":
      return state.amountInvolved ? String(state.amountInvolved) : null;
    case "incidentDate":
      // Most portals want dd/mm/yyyy for an Indian investor.
      return formatIndianDate(state.incidentDate);
    default: {
      const v = state[field.key as keyof GrievanceState];
      return v === null || v === undefined ? null : String(v);
    }
  }
}

function formatIndianDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export async function fillPortal(
  state: GrievanceState,
  opts: FillOptions = {},
): Promise<FillReport> {
  const adapter = adapterFor(location.hostname);
  const report: FillReport = {
    portal: adapter?.id ?? "unknown",
    results: [],
    captchaDetected: detectCaptcha(),
    submitDisabled: true,
  };
  if (!adapter) return report;

  for (const field of adapter.fields) {
    let { el, used } = locate(field);

    if (!el && !field.optional) {
      // Initiate Self-Healing
      const healedSelector = await healSelector(field);
      if (healedSelector) {
        el = document.querySelector(healedSelector) as HTMLElement;
        used = `${healedSelector} (AI Healed)`;
      }
    }

    if (!el) {
      report.results.push({
        key: String(field.key),
        selector: used,
        status: field.optional ? "skipped" : "not_found",
        detail: field.optional ? "Optional field not present" : "Field not found (Healing failed)",
      });
      continue;
    }

    if (isForbidden(el)) {
      report.results.push({
        key: String(field.key),
        selector: used,
        status: "skipped",
        detail: "Refused: matches a protected element",
      });
      continue;
    }

    if (field.confirm && opts.confirm) {
      const ok = await opts.confirm(field);
      if (!ok) {
        report.results.push({
          key: String(field.key),
          selector: used,
          status: "skipped",
          detail: "You declined this field",
        });
        continue;
      }
    }

    if (opts.dryRun) {
      report.results.push({
        key: String(field.key),
        selector: used,
        status: "filled",
        detail: "dry run",
      });
      continue;
    }

    if (field.strategy === "select") {
      const sel = el as HTMLSelectElement;
      const options = [...sel.options].map((o) => ({ value: o.value, text: o.text }));
      const wanted = (field.optionMatchers ?? []).find((m) => valueFor(field, state) &&
        String(valueFor(field, state)).toLowerCase().includes(m.toLowerCase()));
      const target =
        matchOption(options, String(valueFor(field, state) ?? "")) ??
        (wanted ? matchOption(options, wanted) : null);

      if (!target) {
        report.results.push({
          key: String(field.key),
          selector: used,
          status: "ambiguous",
          detail: `No option matched "${valueFor(field, state) ?? ""}". Choose it yourself.`,
        });
        continue;
      }
      setNativeValue(sel, target.value);
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      highlight(sel);
      report.results.push({
        key: String(field.key),
        selector: used,
        status: "filled",
        detail: `matched by ${target.how}`,
      });
      continue;
    }

    const value = valueFor(field, state);
    if (!value) {
      report.results.push({
        key: String(field.key),
        selector: used,
        status: field.optional ? "skipped" : "ambiguous",
        detail: "No value captured for this field yet",
      });
      continue;
    }

    const input = el as HTMLInputElement;
    // Date inputs must receive yyyy-mm-dd, not the Indian format.
    if (input.type === "date") {
      setNativeValue(input, state.incidentDate ?? "");
    } else {
      setNativeValue(input, value);
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    highlight(input);
    report.results.push({
      key: String(field.key),
      selector: used,
      status: "filled",
      detail: `${value.length} characters`,
    });
  }

  return report;
}

export function detectCaptcha(): boolean {
  return FORBIDDEN_SELECTORS.some((sel) => {
    try {
      return document.querySelector(sel) !== null;
    } catch {
      return false;
    }
  });
}

/** Present on the review panel so the user knows what is still theirs to do. */
export function protectedElementsPresent(): string[] {
  const found: string[] = [];
  if (document.querySelector("iframe[src*='recaptcha'], .g-recaptcha, .h-captcha")) {
    found.push("CAPTCHA");
  }
  if (document.querySelector("button[type='submit'], input[type='submit']")) {
    found.push("Submit button");
  }
  return found;
}