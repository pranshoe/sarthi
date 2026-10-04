# Sarthi 🛡️

**SEBI Track B — Investor Awareness, Rights & Grievance Redressal.**

Sarthi is a public-good platform that makes investor rights *usable* for
first-time, Tier-2/3, and senior investors in India. It has three components,
owned by three teams, that plug into one backend through a shared contract.

> ⚠️ Public-good only. No stock tips, no portfolio advice. Sarthi only helps
> investors protect their rights and their family's inheritance.

## The three repos

| Repo | What it is | Owner |
|---|---|---|
| [**sarthi-contracts**](https://github.com/Rigboat27/sarthi-contracts) | JSON Schemas + TS types + `config.json` — the single source of truth | Team C (architect) |
| [**sarthi-engine**](https://github.com/Rigboat27/sarthi-engine) | FastAPI core backend @ `:8787` — speech, LLM, docs, AA mock, shared data | shared |
| [**sarthi-portal**](https://github.com/Rigboat27/sarthi-portal) | Viraasat web app (Next.js) @ `:3000` — nominee audit, legal docs, IEPF pre-checker | Team C |
| *sarthi-extension* (Team A) | Chrome MV3 "Saathi" grievance agent — talks to the engine | Team A |
| *sarthi-mock-scores* (Team A) | Static SCORES/IEPF replicas @ `:8788` for demo | Team A |

## Architecture

```
side panel (React)          conversation.ts      turnRunner.ts
  Chat                          │                      │
  UnderstoodCard                │            ┌─────────┴─────────┐
  ReviewChecklist               │            │                   │
        │                       │      LLMProvider        TTSProvider
        │  chrome.runtime       │      Gemini (live)     Bulbul (spoken replies)
        ▼                       │      Mock  (free)      Mock    (free)
  background/index.ts  ─────────┘           registry.ts
        │                                    swaps by config
        ▼
  proxy/server.ts   ──►  api.sarvam.ai / generativelanguage.googleapis.com

content/detector.ts  ──►  portal/adapter.ts  ──►  fillEngine.ts
   sees SCORES/IEPF         field config          sets values, never submits
```

**Ports:** engine `8787` · portal `3000` · mock SCORES `8788`.

**Keys never reach the browser.** The engine holds Sarvam + Gemini keys and
proxies the vendors. Extension and portal only ever talk to `127.0.0.1:8787`.

Conversation is **Gemini** (free tier, the most reliable for schema-constrained
JSON). Spoken replies are **Sarvam** Bulbul v3 TTS because it is built for
Indian languages. There is no voice input; users type. Sarvam translation is deliberately unused — the LLM emits both
the English and the user's-language summary in one call.

`sarthi-contracts` is the physical guarantee that the three codebases agree.
Everything a component sends or receives is defined there once:

Verified Sarvam endpoint shapes (docs.sarvam.ai, Oct 2026):

| Purpose | Endpoint | Model | Auth |
|---|---|---|---|
| TTS | `POST /text-to-speech` → `{audios: string[]}` | `bulbul:v3` | `api-subscription-key` |
| Chat | `POST /v1/chat/completions` | `sarvam-30b` / `sarvam-105b` | header or Bearer |

Auth failures return **403, not 401**. `sarvam-m` is deprecated.

## Running it

```powershell
# 1. Toolchain (already installed on this machine)
node --version

# 2. Secrets. Copy the example and fill in.
copy proxy\.env.example proxy\.env
#    SARVAM_API_KEY  -> https://dashboard.sarvam.ai
#    GEMINI_API_KEY  -> https://aistudio.google.com/apikey

# 3. Start the proxy (holds the keys)
npm run proxy
#    expect: "sarvam key : loaded"

# 4. Build the extension
npm run build

# 5. Load it
#    chrome://extensions -> Developer mode -> Load unpacked -> pick sarthi\dist
```

Rules:

1. **Every** response is wrapped in the envelope:
   `{ ok, data, meta:{tokens, costEstimateInr, mock}, error }`.
2. A component **derives** its types from these files — extension/portal use the
   TS types, the engine keeps Pydantic models in lockstep (`engine/app/models`).
   Nobody redefines a shared field name locally.
3. **Bump process** — to change a field:
   1. edit `schemas/*.json` **and** `types/index.ts` in `sarthi-contracts`;
   2. bump `config.json` `version`;
   3. update the engine's Pydantic model;
   4. bump the `contracts/` submodule (or run `npm run sync:contracts`) in each
      consumer repo. Their typecheck breaks loudly if they lag — that's the point.
4. **Runtime data is not a type.** SEBI rules + broker directory live only in the
   engine (`app/data/*.json`) and are fetched at runtime via `/data/rules` and
   `/data/brokers`, so a timeline fix lands in both extension and portal at once.

## Cross-component data flows

- **Grievance (extension → engine):** side panel → `/llm/chat` + `/speech/*` →
  in-extension extraction → portal adapter autofills mock SCORES. The engine
  proxies LLM/speech and serves `/data/rules` + `/data/brokers`.
- **Wealth map (portal → engine → AA):** consent wizard → `/aa/consent` →
  `/aa/verify` → `/aa/fetch` → nominee audit.
- **Legal/IEPF (portal → engine):** upload → `/docs/ocr` → `/docs/match` →
  `/docs/affidavit` → printable doc.

## Run everything locally

```bash
# 1. clone (team repos live under your own org; these are the three public ones)
git clone https://github.com/Rigboat27/sarthi-engine
git clone https://github.com/Rigboat27/sarthi-portal
git clone https://github.com/Rigboat27/sarthi-contracts

# 2. engine (terminal 1)
cd sarthi-engine
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
python run.py                                    # http://127.0.0.1:8787

# 3. portal (terminal 2)
cd sarthi-portal
npm install
NEXT_PUBLIC_MOCK_AA=false npm run dev            # http://localhost:3000
```

Everything defaults to **mock mode** — zero keys, zero spend. Set
`MOCK_MODE=false` + keys in the engine's `.env` only when going live.

## See also

In `.env` set `VITE_MOCK_MODE=false`. Keep `VITE_SPOKEN_REPLIES=false` — TTS is
billed per character.

## Testing

```powershell
npm test          # 15 acceptance tests, all in mock mode, zero credits
npm run typecheck # tsc --noEmit
```

`tests/conversation.test.ts` covers all ten acceptance tests from the spec:
greeting without interrogation, Tamil and romanized-Hindi mirroring,
mid-conversation language switch, multi-field extraction in one message,
answering "what is SCORES?", corrections, question rephrasing, optional client
ID, and the 30-day rule.

For the portal, load `mock-scores/scores-complaint.html` over http (the content
script is registered for `localhost:8788`) and the adapter can be exercised
without the live SEBI site.

## Credit budget (~INR 100)

| Concern | Approach |
|---|---|
| Dev and tests | `VITE_MOCK_MODE=true`, all providers mocked |
| LLM | Gemini free tier; compact state, last 4 turns, older summarised |
| TTS | ~INR 30 per 10k chars — off by default, cached by text hash |
| Guard | `SPEND_CAP_INR` in the proxy refuses requests past the cap |

Per-turn token and cost estimates log to the dev console.

## Verified rules and broker contacts

- `src/data/scoresRules.ts` is the single source for every SEBI timeline
  (pre-filing wait, ATR, reviews, one-year limitation, helpline). Each value
  carries its source URL and last-verified date, and the prompt builder injects
  them into every turn with the instruction to state timelines ONLY from there.
- `src/data/brokerDirectory.json` holds grievance emails verified against the
  brokers' own policy pages (Groww, Upstox). Unlisted brokers get an empty To
  field plus guidance — addresses are never invented.
- Filing deadline (incident + limitation) warns in chat and on the review tab
  when 60 or fewer days remain, or the window has passed.

## Code-owned behavior (never the LLM's call)

- Phase gating: AUTOFILL needs `priorContactConfirmed === true` plus a recorded
  date. The model's phase value is ignored.
- Contradictions: overwrites of known fields are held and confirmed
  ("Earlier you said X, now Y — which is right?") unless explicitly framed as
  a correction. Year inference on dateless messages is recomputed by code.
- Ask limits: two unanswered asks marks a field skipped, permanently.
- Email handshake: claim → date → proof, tracked in `Conversation.emailFlow`.
  Contact denials apply immediately; the Gmail draft opens on agreement.

## Known limitations

- **No voice input.** Users type; spoken replies (Sarvam Bulbul v3, opt-in) are output only.
- **Live portal selectors are unverified.** `src/portal/adapter.ts` uses
  heuristic selectors. Inspect the real SCORES complaint form and replace them;
  the mock replica is built against the same config so it stays honest.
- **10 Indic languages are detected, 5 have full mock wording.** Live mode
  covers the rest via Gemini. `detect.ts` is the single place to extend.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the full locked-down architecture.
- Each repo's `README.md` for its own run instructions.
