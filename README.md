# Sarthi — conversational grievance agent for SEBI SCORES & IEPF

A Manifest V3 Chrome extension. The user talks to Sarthi in their own language;
Sarthi prepares the complaint and fills the government portal. The user always
reviews, solves any CAPTCHA, and clicks Submit.

## The rules the code enforces

**The LLM writes every message the user sees.** There is no scripted question
list, no question order, and no per-field prompt string anywhere in
`src/agent/`. Only `src/agent/systemPrompt.ts` describes what to ask.

**Code decides what is allowed; the model decides what to say.**
- `src/state/grievanceState.ts` — the single source of truth for what is missing
- `src/state/stateReducer.ts` — merges model output, enforces phase order
- `src/agent/guardrails.ts` — strips legal advice and outcome promises
- `src/agent/turnRunner.ts` — suppresses an action the current phase forbids

**Two things it will never do** (spec §7): click Submit, touch a CAPTCHA.
Enforced by `FORBIDDEN_SELECTORS` in `src/portal/adapter.ts`, checked on every
field in `src/portal/fillEngine.ts`.

**Keys never enter the bundle.** `proxy/server.ts` holds them; the extension
calls `http://127.0.0.1:8787`.

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

State is split deliberately: the LLM sees `knownView(state)` plus a computed
`missing[]` list, so it is told what it already knows and cannot re-ask for it.

## Provider setup

Conversation is **Gemini** (free tier, the most reliable for schema-constrained
JSON). Spoken replies are **Sarvam** Bulbul v3 TTS because it is built for
Indian languages. There is no voice input; users type. Sarvam translation is deliberately unused — the LLM emits both
the English and the user's-language summary in one call.

Swap the conversation model by changing `VITE_LLM_PROVIDER`. Agent code does not
change.

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

### Mock mode (default, zero credits)

`.env` ships with `VITE_MOCK_MODE=true`, so nothing hits the network:

```powershell
copy .env.example .env
npm run build
```

The mock LLM answers in English, Hindi, Tamil and Kannada (native and
romanized) so you can rehearse the demo with no spend at all.

### Going live

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