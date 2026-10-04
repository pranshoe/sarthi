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
extension (Saathi) @ MV3          portal (Viraasat) @ :3000
  · voice/text side panel            · nominee audit / wealth map
  · DOM autofill                     · legal docs / IEPF pre-checker
        │  http://127.0.0.1:8787           │  http://127.0.0.1:8787
        └──────────────┬──────────────────┘
                       ▼
      SARTHI CORE ENGINE  (FastAPI)  @ :8787
        /stt /tts  Sarvam STT/TTS          (keys here)
        /gemini/*  Gemini (extension's LLM) (keys here)
        /docs/*    OCR · fuzzy · affidavit
        /aa/*      AA mock (Setu/Finvu shape)
        /data/*    SEBI rules + brokers + nodal officers
        /health
```

**Ports:** engine `8787` · portal `3000` · mock SCORES `8788`.

**Keys never reach the browser.** The engine holds Sarvam + Gemini keys and
proxies the vendors. Extension and portal only ever talk to `127.0.0.1:8787`.

## The contract flow (how teams stay compatible)

`sarthi-contracts` is the physical guarantee that the three codebases agree.
Everything a component sends or receives is defined there once:

```
sarthi-contracts/
  schemas/            apiEnvelope, holding, aaConsent, aaFetchResponse,
                      grievanceState, affidavit
  types/index.ts      TS types mirroring the schemas (extension + portal)
  config.json         ports, URLs, provider flags
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

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the full locked-down architecture.
- Each repo's `README.md` for its own run instructions.
