# Sarthi · Technical Deep-Dive (Rubric-Mapped)

Honest, to-the-point explanation of what's actually running, and how it maps to
the judging rubrics. Mock vs. live is called out explicitly — no overclaiming.

---

## 1. Problem Definition

**Target user:** first-time, **Tier-2/3**, and **senior** retail investors in
India — and their **legal heirs / families** (who inherit the mess).

**The specific problem, in one line:** an investor's wealth is spread across 4–6
portals (bank, CDSL/NSDL, MF, insurance) with no single view of **who the nominee
is** — so when the investor dies, the family doesn't know the accounts exist, and
wealth becomes **unclaimed**, or inheritance becomes a **multi-year legal slog**.

**Three concrete failure modes we target:**
1. **Unclaimed wealth** — accounts with no nominee become trapped (SEBI's stated
   reason for mandating nomination).
2. **Transmission** — transferring a deceased person's shares needs a strict
   SEBI-format affidavit + NOCs; a wrong affidavit gets rejected.
3. **IEPF rejection** — recovering unclaimed dividends via IEPF-5 fails mostly on
   **name mismatch** (Aadhaar vs old certificate) and **wrong Nodal Officer
   address**.

---

## 2. Technology — what's actually running

```
sarthi-portal (Next.js 14, TS, Tailwind)  ──┐
                                             │  REST, canonical ApiEnvelope
sarthi-extension (Chrome MV3 "Saathi")  ─────┼──►  sarthi-engine (FastAPI @ :8787)
                                             │     /aa/*  /docs/*  /data/*  /stt /tts /llm/chat /gemini/*
sarthi-contracts (JSON Schema + TS + Pydantic)┘     (keys live ONLY here, in .env)
```

**Services table:**

| Component | Tech | What it does |
|---|---|---|
| **Portal** | Next.js 14, React 18, Tailwind | Wealth Map, nominee audit, vault, transmission, IEPF |
| **Engine** | FastAPI (Python 3.12) | one backend; holds Gemini/Sarvam keys; proxies vendors |
| **Contracts** | JSON Schema → TS types + Pydantic | single source of truth; drift = typecheck failure |
| **AA** | **mock**, Setu/Finvu-shaped | consent artefact (Sahamati fields: consentStart/Expiry, fiTypes, Purpose, DataLife…) → FIP records |

**AI/ML components — and where AI is *deliberately not* used:**

| Feature | Model / Tech | Live or mock |
|---|---|---|
| IEPF OCR (KYC vs certificate) | **Gemini Vision** (multimodal) + exact-match | **live** (Gemini key loaded) |
| Name-discrepancy affidavit | **Gemini text** (JSON-constrained, temp 0.2) | **live** |
| Transmission affidavit | **Deterministic template** (official SEBI format) — *not* LLM | n/a |
| Fuzzy name match | **rapidfuzz** (Levenshtein) | n/a |
| Extension speech | **Sarvam** (Saaras v4 STT, Bulbul v3 TTS) | keys in engine |
| Family Vault encryption | **Web Crypto** — AES-GCM 256 + PBKDF2 (150k iter), **on-device** | n/a |
| PDF rendering | **reportlab** (Times + Noto Sans Devanagari) | n/a |

**Data sources:**
- **AA mock** — 9-account portfolio (bank/demat/MF/insurance/PPF) with nominee flags.
- **Nodal Officer directory** — 119 listed companies (name/ticker/sector/RTA + RTA investor email); addresses never fabricated.
- **Broker directory** — 18 brokers; 10 grievance emails verified against policy pages.
- **SEBI SCORES rules** — verified timelines (30-day pre-filing, 21-day ATR, 365-day limitation) with source URLs.

---

## 3. Key technical decisions (the "why")

1. **One backend, one contract.** The FastAPI engine *absorbed* the extension's
   Node proxy (`/stt`, `/tts`, `/gemini/*`, `/llm/chat`), so three clients talk to
   one service on one port with one envelope. No key ever reaches a browser.
2. **Contract-first.** Field names/shapes live in JSON Schema; the engine
   validates output against them in CI (`jsonschema` + `ajv` on both sides).
3. **Legal documents are deterministic, not LLM-generated.** The transmission
   affidavit is a *template* of the official SEBI format — this is a guardrail,
   not a shortcut: a hallucinated clause in a legal affidavit is unacceptable.
   The LLM is reserved for *extraction* (OCR) and *fill-in* (name-discrepancy),
   where it adds value.
4. **On-device encryption.** The Family Vault encrypts client-side; ciphertext
   never leaves the browser (privacy by construction, not by policy).
5. **Mock-first with a live switch.** `MOCK_MODE` gates all vendor calls; dev and
   tests cost ₹0. Flipping to live is `.env` keys only.
6. **Credit/guardrail instrumentation.** spend cap (₹100), per-turn token/cost
   logs, TTS cache by text-hash, compact LLM state (last turns + summarised
   history).

---

## 4. Rubric mapping

### Resilience & Safety Impact — 30%
- **Measurable:** a 0–100 **Nominee Health Score** computed from `verified
  nominees / total accounts`. It turns "are you protected?" into a number and an
  action list (accounts with no nominee → one-click deep link to register).
- **Loss avoided:** transmission affidavit + IEPF OCR directly attack the two
  top rejection causes (wrong affidavit, name mismatch), i.e. *measurably fewer
  rejected claims*.
- The thesis: **prepare the user to succeed *before* the bureaucracy**, not after.

### Tier-2/3 Usability — Bharat-First — 25%
- **23 Indian languages** (selector + native-script strings, Noto Devanagari in PDFs).
- **Voice** (extension): Sarvam STT/TTS in 10+ Indic languages, romanized/code-mixed.
- **Minimal cognitive load:** "pull from Wealth Map" pre-fills forms instead of
  retyping; a clickable checklist; large senior-friendly type.
- **Low-bandwidth:** lightweight Next.js static pages, no heavy media; the heavy
  AI lives server-side so the client stays thin.

### Guardrail Compliance & Trust — 15%
- **Strictly non-commercial:** no stock tips, no portfolio analysis, no
  recommendations — code-level (the product simply has no such surface).
- **No fabricated data:** Nodal Officer *addresses* are never invented (only the
  RTA's public email + "confirm on page"); broker emails are verified, not guessed.
- **Transparent uncertainty:** SEBI timelines are stated *only* from a verified
  rules file with source URLs; anything unlisted → "not sure, check scores.sebi.gov.in".
- **Privacy:** keys in engine only; PII masked in logs; vault data on-device;
  "clear my data" affordance.

### Technical Execution — 15%
- AI used **where it earns its place**: Gemini Vision for the exact rejection
  cause (name mismatch), not as a novelty wrapper.
- **Deliberate non-use of AI** is a highlight: legal text is deterministic.
- **On-device Web Crypto** (AES-GCM + PBKDF2) for real encryption.
- **Contract-first CI** (json-schema + ajv) proves the pieces actually agree.

### Feasibility & Scalability — 15%
- The AA is a **mock today**, but it's *shaped like a real Sahamati/Setu/Finvu*
  flow (consent artefact → verify → FI records). Going real = register as an FIU
  and swap the data source behind the same `/aa/*` contract — **zero UI change**.
- Speech is provider-abstracted (Sarvam now; Bhashini is a drop-in).
- The engine is stateless-enough to scale (only consent is in-memory; trivially
  moved to Redis/DB), and hosting is standard FastAPI + Next.js.

---

## 5. Honest "what's mock vs live" (so judges aren't misled)

| Piece | Status |
|---|---|
| Account Aggregator | **mock** (real-shaped) |
| OCR / name-discrepancy affidavit | **live** (Gemini) |
| Transmission affidavit | deterministic (always "real") |
| Speech (extension) | live once Sarvam key added |
| Nodal/broker directories | real data, addresses "verify-on-page" |
