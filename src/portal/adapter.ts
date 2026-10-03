import type { GrievanceState } from "@/shared/types";

/**
 * Portal adapter layer.
 *
 * Field mappings live here as pure config, completely separate from agent
 * logic, so a portal redesign is fixed by editing one object rather than
 * hunting through the code. Each entry says where a value goes and, for
 * dropdowns, how to recognise the right option in free text.
 */

export type FillStrategy =
  /** Type into an input or textarea. */
  | "text"
  /** Choose a dropdown option by fuzzy text match. */
  | "select"
  /** Attach a file to a file input. */
  | "file"
  /** Deliberately left to the user, but worth showing as a checklist item. */
  | "manual";

export interface FieldMapping {
  /** Key on GrievanceState this fills. */
  key: keyof GrievanceState | "complaintBody";
  strategy: FillStrategy;
  /** Primary selector. */
  selector: string;
  /** Tried in order if the primary misses. */
  fallbackSelectors?: string[];
  /**
   * For selects: strings that identify the correct option. Matched
   * case-insensitively as a substring against option text.
   */
  optionMatchers?: string[];
  /**
   * For selects whose state vocabulary differs from the portal's (e.g. our
   * entityType "broker" vs the portal's "Registered Intermediary"): maps a
   * lowercased state value to the portal-side phrase to match. Unmapped
   * values fall through to the plain matching below, and report ambiguous
   * rather than guessing when nothing matches.
   */
  valueAliases?: Record<string, string>;
  /** Label shown on the review checklist. */
  label: string;
  /** Ask before filling. Used for anything that changes the complaint's meaning. */
  confirm?: boolean;
  optional?: boolean;
}

export interface PortalAdapter {
  id: "scores" | "iepf";
  displayName: string;
  /** Matched against location.hostname. */
  hostnames: string[];
  /** Extra markers: a path fragment plus text that must appear in the page. */
  pathIncludes?: string[];
  domMarkers?: string[];
  fields: FieldMapping[];
  /** Never touched. Listed so the review UI can say so explicitly. */
  neverTouch: string[];
}

export const scoresAdapter: PortalAdapter = {
  id: "scores",
  displayName: "SEBI SCORES",
  hostnames: [
    "scores.sebi.gov.in",
    // Local test doubles (mock-scores/). Harmless in production: nobody
    // serves real SCORES on loopback, and S15 depends on this match.
    "localhost",
    "127.0.0.1",
  ],
  pathIncludes: ["complaint", "register", "lodge"],
  domMarkers: ["grievance-redressal", "complaint-registration"],
  neverTouch: [
    "Submit button",
    "CAPTCHA",
    "Password / OTP",
    "Any final confirmation",
  ],
  fields: [
    {
      key: "entityName",
      strategy: "text",
      // SCORES uses an entity search box rather than a plain select.
      selector: "input[name*='entity' i], input[id*='entity' i], input[placeholder*='entity' i]",
      label: "Name of the entity (broker / company)",
    },
    {
      key: "entityType",
      strategy: "select",
      selector: "select[name*='entityType' i], select[id*='entityType' i]",
      optionMatchers: [
        "registered intermediary",
        "listed company",
        "market infrastructure",
      ],
      // Our internal labels vs the portal's: a broker IS a registered
      // intermediary on SCORES. RTA/IEPF match nothing on purpose — neither
      // dropdown offers them, so the report says ambiguous and the user
      // chooses instead of us mis-filing.
      valueAliases: {
        broker: "registered intermediary",
        "listed company": "listed company",
      },
      label: "Type of entity",
    },
    {
      key: "complaintCategory",
      strategy: "select",
      selector: "select[name*='categ' i], select[id*='categ' i]",
      optionMatchers: ["non-receipt", "unauthori", "closure", "charge"],
      label: "Category of complaint",
    },
    {
      key: "clientIdFolioNoDpid",
      strategy: "text",
      selector: "input[name*='ucc' i], input[name*='clientId' i], input[id*='ucc' i]",
      label: "UCC / Client ID",
      optional: true,
    },
    {
      key: "incidentDate",
      strategy: "text",
      selector: "input[name*='date' i], input[id*='date' i]",
      label: "Date of cause of action",
    },
    {
      key: "amountInvolved",
      strategy: "text",
      selector: "input[name*='amount' i], input[id*='amount' i]",
      label: "Amount involved",
      optional: true,
    },
    {
      key: "complaintBody",
      strategy: "text",
      selector:
        "textarea[name*='complaint' i], textarea[id*='complaint' i], textarea[name*='detail' i]",
      label: "Details of complaint (English)",
      confirm: true,
    },
  ],
};

export const iepfAdapter: PortalAdapter = {
  id: "iepf",
  displayName: "IEPF nodal officer",
  hostnames: ["iepf.gov.in", "www.iepf.gov.in", "iepfonline.gov.in"],
  pathIncludes: ["nodal", "claim", "unclaimed"],
  domMarkers: ["nodal-officer", "iepfform"],
  neverTouch: ["Submit button", "CAPTCHA", "Declaration checkbox"],
  fields: [
    {
      key: "entityName",
      strategy: "text",
      selector: "input[name*='company' i], input[name*='entity' i], input[id*='company' i]",
      label: "Company name",
    },
    {
      key: "clientIdFolioNoDpid",
      strategy: "text",
      selector: "input[name*='folio' i], input[name*='demat' i], input[id*='folio' i]",
      label: "Folio / DP ID",
      optional: true,
    },
    {
      key: "complaintBody",
      strategy: "text",
      selector: "textarea",
      label: "Claim description (English)",
      confirm: true,
    },
  ],
};

export const ADAPTERS: Record<string, PortalAdapter> = {
  scores: scoresAdapter,
  iepf: iepfAdapter,
};

/** Selectors we are forbidden to interact with, regardless of adapter config. */
export const FORBIDDEN_SELECTORS = [
  "button[type='submit']",
  "input[type='submit']",
  "input#captcha",
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  ".g-recaptcha",
  ".h-captcha",
  "input[autocomplete='one-time-code']",
];

export function adapterFor(hostname: string): PortalAdapter | null {
  const h = hostname.toLowerCase();
  for (const a of Object.values(ADAPTERS)) {
    if (a.hostnames.some((x) => h === x || h.endsWith(`.${x}`))) return a;
  }
  return null;
}

/** The English text that goes into a portal textarea. */
export function buildComplaintBody(state: GrievanceState): string {
  const lines: string[] = [];
  lines.push(state.issueSummaryEnglish ?? state.issueSummaryOriginal ?? "");

  const facts: string[] = [];
  if (state.entityName) facts.push(`Entity: ${state.entityName}`);
  if (state.clientIdFolioNoDpid)
    facts.push(`UCC / Client ID / Folio: ${state.clientIdFolioNoDpid}`);
  if (state.incidentDate) facts.push(`Date of cause of action: ${state.incidentDate}`);
  if (state.amountInvolved) facts.push(`Amount involved: INR ${state.amountInvolved}`);
  if (state.reliefSought) facts.push(`Relief sought: ${state.reliefSought}`);
  if (facts.length) lines.push("", ...facts);

  if (state.priorContactProof === "rejected") {
    lines.push(
      "",
      "The entity rejected my complaint without resolving the issue.",
    );
  } else if (state.priorContactDate) {
    lines.push(
      "",
      `I first complained to the entity by email on ${state.priorContactDate} and ` +
        `awaited a response as required. Supporting documents are attached.`,
    );
  } else {
    lines.push(
      "",
      "Supporting documents, including proof of my prior contact with the entity, are attached.",
    );
  }

  return lines.filter((l) => l !== undefined).join("\n").trim();
}