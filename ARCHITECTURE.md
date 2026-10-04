# Sarthi — Final Architecture (v2 · locked)

SEBI Track B · Investor Awareness, Rights & Grievance Redressal

One system, three codebases (extension · engine · portal), one contract. This
document is the single source of truth for how the pieces fit together. If a
shape, URL, or port changes, it changes **here** first.

---

## 0. Locked decisions

| Decision | Final |
|---|---|
| Speech | **Sarvam only** (Saaras v4 STT, Bulbul v3 TTS). Bhashini dropped (govt 404). |
| Conversation LLM | **Gemini** default, **Sarvam-30b** as swap. Both proxied by the engine. |
| Backend | **FastAPI (Python 3.12)** — single backend. Node proxy retired. |
| Keys | Live only in the engine. Never in the extension or portal bundle. |
| AA data source | **Mock** (Setu/Finvu-shaped JSON) served by the engine at `/aa/*`. |
| Shared data | SEBI rules + broker directory live in the **engine repo**, served at `/data/*`. |
| Repos | **Separate repos** per component. `contracts/` shared as one versioned repo. |

---

## 1. Topology

```
                     ┌──────────────────────────────┐
                     │          CLIENTS             │
                     │       (no secrets)           │
                     │                              │
                     │  extension (Saathi)  @ MV3   │  Team A
                     │  · side panel (voice/text)   │
                     │  · content script / autofill │
                     └──────────────┬───────────────┘
                                    │  HTTP  http://127.0.0.1:8787
                     ┌──────────────┴───────────────┐
                     │                              │
                     │  portal (Viraasat) @ :3000   │  Team C (me)
                     │  · nominee audit             │
                     │  · legal docs / IEPF check   │
                     └──────────────┬───────────────┘
                                    │  HTTP  http://127.0.0.1:8787
                                    ▼
     ┌──────────────────────────────────────────────────────────────┐
     │               SARTHI CORE ENGINE  (FastAPI)  @ :8787        │
     │                                                              │
     │   /speech/*   Sarvam STT/TTS                 (keys here)     │
     │   /llm/chat   Gemini / Sarvam-30b adapter    (keys here)     │
     │   /docs/*     OCR · fuzzy match · affidavit   Team B         │
     │   /aa/*       AA mock (Setu/Finvu shape)      Team C (me)    │
     │   /data/*     SEBI rules + broker directory  (canonical)     │
     │   /health     liveness + live provider flags                 │
     └──────────────┬───────────────────────────────────────────────┘
                    │
          ┌─────────┼──────────────────┐
          ▼         ▼                  ▼
      Sarvam     Gemini /       mock AA sandbox
      (speech)   Sarvam-30b     (Setu/Finvu JSON)  @ /aa/*
      api.sarvam.ai  generativelanguage   (real sandbox swap later)
```

---

## 2. Ports & services

| Service | Tech | Port | Owner |
|---|---|---|---|
| Sarthi Core engine | FastAPI (Python 3.12) | **8787** | shared |
| Web portal (Viraasat) | Next.js 14 | 3000 | Team C |
| Mock SCORES + IEPF | static HTML | **8788** | Team A |
| AA mock | engine route `/aa/*` | 8787 | Team C |

All port/URL/provider values live in **`contracts/config.json`** — one file, read
by every repo. Nothing is hardcoded elsewhere.

---

## 3. Contracts (the compatibility mechanism)

```
contracts/
  schemas/
    apiEnvelope.schema.json        # { ok, data, meta, error } — every response
    grievanceState.schema.json     # Team A's canonical complaint state
    holding.schema.json            # AA account record (portal ↔ engine ↔ AA)
    aaConsent.schema.json          # consent artefact request/response
    aaFetchResponse.schema.json    # FIP fetch response (Setu/Finvu shape)
    affidavit.schema.json          # Team B's legal doc payload
  types/                           # committed TS types generated from schemas
  config.json                      # ports, URLs, provider flags
```

**Distribution (separate repos):** `contracts/` is its own repo
(`sarthi-contracts`), the single source of truth. Each consumer repo pulls it in as
a **git submodule** at `contracts/` (I provide a one-line `sync` script as the
fallback if submodules feel heavy). Generated types are committed per-repo. Bump =
update the submodule pointer; nothing else to remember.

Rules of the contract:

1. **Every** response is wrapped in the envelope.
2. Teams derive their types from these schemas (extension/portal → TS, engine →
   Pydantic). Nobody redefines a shared field name locally.
3. `/data/rules` + `/data/brokers` are **fetched at runtime** by both extension and
   portal — the JSON lives only in the engine repo, so the "30-day rule" and broker
   emails can never diverge. Clients may keep a bundled copy only as an offline
   fallback; the engine copy is canonical.

**Envelope:**

```json
{ "ok": true, "data": { "…": "…" },
  "meta": { "tokens": { "in": 120, "out": 40 }, "costEstimateInr": 0.002, "mock": true },
  "error": null }
```

`meta` carries token/cost estimates every turn (credit-budget visibility).

---

## 4. Engine API (FastAPI @ :8787)

One backend serves **both** surfaces: the portal's envelope routes and the
extension's proxy routes (the extension's old Node `proxy/server.ts` is retired —
the engine absorbs it, so the extension's `proxyUrl` needs no change).

| Endpoint | Method | Input → Output | Shape | Consumer |
|---|---|---|---|---|
| `/health` | GET | → `{ ok, data: { version, providers, mockMode, spendInr, capINR }, meta, error }` | envelope | portal (+ extension logs it) |
| `/stt` | POST multipart | audio → `{ text, detectedLang }` (Sarvam Saaras v4) | flat | extension |
| `/tts` | POST | `{ text, language_code, … }` → `{ audios[] }` (Bulbul v3) | passthrough | extension |
| `/gemini/{model}:generateContent` | POST | Gemini body → raw `candidates[]` | passthrough | extension |
| `/sarvam/v1/chat/completions` | POST | Sarvam body → raw | passthrough | extension |
| `/docs/ocr` | POST multipart | image/PDF → `{ text, fields }` | envelope | portal |
| `/docs/match` | POST | `{ a, b }` → `{ score, match }` (rapidfuzz) | envelope | portal |
| `/docs/affidavit` | POST | `{ familyTree, … }` → `{ pdfBase64 }` | envelope | portal |
| `/aa/aggregators` | GET | → aggregator list | envelope | portal |
| `/aa/consent` | POST | `{ aggregatorId, scopes[] }` → `{ consentId, artefact }` | envelope | portal |
| `/aa/verify` | POST | `{ consentId, otp }` → `{ verified }` | envelope | portal |
| `/aa/fetch` | POST | `{ consentId }` → `{ holdings[] }` | envelope | portal |
| `/data/rules` | GET | → SEBI timelines (canonical) | envelope | both |
| `/data/brokers` | GET | `?name=` → grievance emails | envelope | both |
| `/data/nodal` | GET | `?company=` → company + RTA + lookup URL | envelope | portal |

CORS allows `http://localhost:3000` (portal) and `chrome-extension://` (extension).

**Envelope vs flat:** `/aa/*`, `/docs/*`, `/data/*`, `/health` use the envelope.
`/stt`, `/tts`, `/gemini/*`, `/sarvam/*` are exact passthroughs of the vendor
shapes the extension already parses.

---

## 5. AA mock (Team C)

Mirrors the real AA framework's shape so swapping to a Setu/Finvu sandbox is an
engine-only change (same `/aa/*` contract, different data source).

Flow: `/aa/consent` (artefact) → `/aa/verify` (OTP) → `/aa/fetch` (FIP records).

```json
{ "ok": true, "data": { "consentId": "ca-…", "fips": [
  { "fipId": "HDFC", "type": "DEPOSIT",
    "data": [ { "accountType": "bank", "provider": "HDFC Bank",
                "maskedNumber": "••••4521", "value": 185400,
                "nominee": { "name": "Priya Sharma", "relationship": "Spouse",
                             "verified": true } } ] },
  { "fipId": "CDSL", "type": "INVESTMENTS",
    "data": [ { "accountType": "demat", "provider": "CDSL", "nominee": null } ] }
] } }
```

Seed data lives in `engine/app/aa/mock_data.py` (Pydantic `Holding` models).

---

## 6. Web portal (Team C)

Built on the existing Next.js app; refactored to be an engine client:

1. `lib/api.ts` — `API_BASE = NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8787"`,
   with `NEXT_PUBLIC_MOCK_AA=true` as an offline fallback (portal demos with zero
   backend).
2. `fetchWealthSnapshot` → calls `/aa/consent` → `/aa/verify` → `/aa/fetch`
   (the consent wizard UI is unchanged).
3. Import `Holding` etc. from `contracts/types/` (drop the local duplicate).
4. `/transmission` + `/iepf` pages call `/docs/ocr`, `/docs/match`,
   `/docs/affidavit` (Team B's engine) — no more stubs.
5. A `/health` status footer on every page, so the demo visibly proves
   portal ↔ engine connectivity.

---

## 7. Cross-component data flows

**A. Grievance (extension → engine):** side panel → `/gemini/*` (conversation) +
`/stt` + `/tts` (voice) → in-extension extraction → portal adapter autofills mock
SCORES `:8788`. Engine proxies Gemini/Sarvam (holds the keys) and serves
`/data/rules` + `/data/brokers`. Keys never touch the extension.

**B. Wealth map (portal → engine → AA):** consent wizard → `/aa/consent` →
`/aa/verify` → `/aa/fetch` → nominee audit renders.

**C. Legal/IEPF (portal → engine):** cert/KYC upload → `/docs/ocr` → `/docs/match`
(name-mismatch check) → `/docs/affidavit` → printable doc.

**D. Shared truth:** `/data/rules` + `/data/brokers` fetched by extension **and**
portal.

---

## 8. Ownership matrix

| Area | Owner |
|---|---|
| Chrome extension (Saathi) | Team A |
| `/stt`, `/tts`, `/gemini/*`, `/sarvam/*` (Sarvam/Gemini passthrough) | shared (engine) |
| `/docs/*` (OCR, fuzzy match, affidavit) | Team B |
| Web portal (Viraasat) | Team C (me) |
| `/aa/*` (AA mock) | Team C (me) |
| `sarthi-contracts` repo (schemas, config) | Team C (me), reviewed by all |
| `/data/*` (rules, brokers) | shared, canonical JSON in the engine repo |

---

## 9. Repo layout (separate repos)

```
sarthi-contracts/   # me · JSON Schemas + config.json + generated TS/Pydantic types
                    #       consumed by every repo as a git submodule at contracts/

sarthi-engine/      # shared · FastAPI @ :8787
  app/main.py
  app/routers/{speech,llm,docs,aa,data}.py
  app/models/       # Pydantic, generated from contracts/schemas
  app/services/     # sarvam + gemini clients
  app/aa/mock_data.py
  app/data/scoresRules.json + brokerDirectory.json   # canonical, served at /data/*

sarthi-extension/   # Team A · Manifest V3   (contracts/ submodule)
sarthi-portal/      # me · Next.js 14 @ :3000 (contracts/ submodule)
sarthi-mock-scores/ # Team A · static SCORES/IEPF @ :8788
```

Each repo also keeps its own `.env` (copy of `.env.example`) with `API_BASE`,
`MOCK_MODE`, etc. — values duplicated from `contracts/config.json`, which remains
the documented canonical list.

---

## 10. Testing & demo

- **Contract tests** — sample payloads validated against `contracts/schemas/*`;
  runnable from any repo (`npm test` / `pytest`). A broken field fails before the demo.
- **Smoke script** — boots engine → hits `/health`, `/aa/fetch`, `/docs/match` →
  prints "all green" in <5s.
- **Mock-first everywhere** — `VITE_MOCK_MODE` (extension), `NEXT_PUBLIC_MOCK_AA`
  (portal), `MOCK_MODE` (engine) all default `true` → full stack demos with zero
  keys and zero spend.

---

## 11. Build order

1. **`sarthi-contracts` repo** — `config.json` + core schemas (`holding`,
   `aaFetchResponse`, `apiEnvelope`) + generated TS & Pydantic types.
2. **`sarthi-engine` repo** — skeleton (`/health`, CORS, envelope) + `/aa/*` + seed
   data + `/data/rules` + `/data/brokers`.
3. **`sarthi-portal` repo** — refactor: `lib/api.ts` + swap `fetchWealthSnapshot` →
   `/aa/fetch`, wire `/transmission` + `/iepf` → `/docs/*`, add `/health` footer.
4. Contract tests + smoke script (validates every repo against the contracts).
5. Teams A & B add the `contracts/` submodule and point their clients at the same
   endpoints.
