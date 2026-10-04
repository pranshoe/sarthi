# Sarthi · Viraasat — Demo Script

**Track B · Investor Awareness, Rights & Grievance Redressal**
**Target length: ~3.5 minutes** · Voice: warm, confident, plain English
**Device:** laptop (Viraasat portal) — extension is an optional closing beat.

---

## The 4-word pitch (say this first, before any screen)

> "India's wealth is trapped in accounts no one can find. Sarthi finds them — and
> makes sure they reach the right hands."

---

## FLOW + VOICEOVER

### Scene 1 · The hook (0:00 – 0:20)
**Screen:** Landing page hero — "Your family should never lose your wealth."

> "Every year, crores of rupees sit unclaimed in India — in bank accounts, demat
> folios, and mutual funds. Not because people forget them, but because their
> families *don't know they exist*, and don't know who the nominee is."

*(beat)*

> "That's the problem we're solving."

---

### Scene 2 · What it is (0:20 – 0:40)
**Screen:** Scroll landing "How it works" (Give consent → We map → Fix & secure).

> "Sarthi is your family's financial guardian. It builds a single, secure map of
> everything you own, flags what's unprotected, and locks it into a vault your
> family can open."

*(beat)*

> "No stock tips. No portfolio advice. Just one job: protecting your wealth."

---

### Scene 3 · Connect via Account Aggregator (0:40 – 1:20)
**Screen:** Click "Connect via Account Aggregator" → consent flow.
**Actions:** Pick OneMoney → review scopes → enter OTP → "Approve & connect".

> "Connect through the RBI-regulated **Account Aggregator** framework. You give
> consent — you never share a password. Sarthi pulls your banks, demat, mutual
> funds, and insurance in one go."

*(as the wealth map loads)*

> "In seconds, here's your **Legacy Wealth Map**."

---

### Scene 4 · The "aha" — Nominee Health Score (1:20 – 1:50)
**Screen:** Wealth Map — gauge shows **56/100**, red "Action needed" banner.

> "This is the number that matters: your **Nominee Health Score**. These red
> accounts have **no nominee** — which means if something happens to you, they
> become unclaimed wealth and trap your family in years of legal paperwork."

*(point)*

> "Look — one tap, and it takes you straight to CDSL to register the nominee.
> No hunting, no forms."

---

### Scene 5 · Family Vault (1:50 – 2:20)
**Screen:** Open Family Vault → name pre-filled → enter passphrase → "Encrypt" →
Download.

> "Next — the **Family Vault**. One passphrase, AES-encrypted, and your whole
> financial footprint is locked into a file you hand to your family."

*(show the downloaded .html being opened + decrypted)*

> "When they need it, they just open the file, type the passphrase, and see every
> account — instantly. No lawyer, no phone calls."

---

### Scene 6 · Transmission Copilot (2:20 – 2:50)
**Screen:** Transmission → "Pull from your Wealth Map" dropdown → pick CDSL →
fields auto-fill → "Generate affidavit (PDF)" → show the official PDF.

> "Now the hard part of every inheritance: **transmitting shares** after a
> death. Normally you handwrite a legal affidavit and hope it's right."

*(click generate)*

> "Sarthi pulls the account from your Wealth Map, fills in the deceased, the
> applicant, the heirs — and generates the **exact SEBI format affidavit**, with
> the heirs table and signature block, ready to print on stamp paper."

---

### Scene 7 · IEPF Pre-Validator (2:50 – 3:20)
**Screen:** IEPF → upload KYC + certificate → "Run AI OCR check" → mismatch
detected → generate name-discrepancy affidavit → Nodal Officer router → checklist.

> "And for old unclaimed dividends — the **IEPF Pre-Validator**. It reads your KYC
> and your decades-old share certificate with AI, and catches the subtle name
> mismatch that gets most IEPF claims rejected."

*(as it flags the mismatch)*

> "It even drafts the fixing affidavit, and routes you to the correct **Nodal
> Officer** — so you mail documents to the right place the first time."

---

### Scene 8 · Bharat-first close (3:20 – 3:35)
**Screen:** Language selector → switch to **Tamil** (or Hindi) — hero + nav switch.

> "And it speaks your language — **23 Indian languages**. Because protection
> shouldn't require perfect English."

*(beat)*

> "Sarthi: protecting India's wealth, one family at a time."

---

## The "wow" beats to land with judges

1. **56/100 score + red flags** — makes the problem instantly visible.
2. **AA consent is consent-based, no passwords** — hits the "public digital
   infrastructure" constraint.
3. **AES-GCM vault decrypts in-browser** — real security, demoable in 5 seconds.
4. **Official SEBI-format affidavit PDF** — the "we did the legal homework" moment.
5. **AI OCR catching "RAMESH SHARMA" vs "RAMESH SHARM"** — the subtle one-letter
   mismatch that actually gets claims rejected.
6. **23-language switch** — the "Bharat-first" emotional beat.

---

## Demo prep checklist

- [ ] Engine running (`python run.py` in `sarthi-engine`) — mock AA, live Gemini OCR.
- [ ] Portal running (`npm run dev` in `sarthi-portal`).
- [ ] Rehearse the AA flow once (consent → OTP → fetch) so it's muscle memory.
- [ ] Have a sample KYC + certificate image ready for the OCR beat.
- [ ] Pre-check the "Download PDF" opens cleanly (affidavit + vault).
- [ ] Optional: load the Chrome extension (Saathi) as the closing "grievance"
      beat — but the portal stands alone if it's not ready.

---

## Optional extension beat (if the teammate's Saathi loads)

> "And for *active* grievances — say a broker hasn't credited your sale proceeds —
> Saathi, our browser agent, talks to you in your language, drafts the email to the
> broker, and fills the SEBI SCORES form for you. You only review and submit."
