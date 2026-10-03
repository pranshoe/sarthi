# S6 HARD review: card same turn, confirm is free, one follow-up continues — run 2 (live) — PASS

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, and I can help you file your complaint with SEBI SCORES or IEPF step by step. Please tell me what happened so we can get started.
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha has not credited my 40000 rupees sale proceeds since 3rd March
AGENT:    I understand how worrying it is when your funds are delayed. Have you already contacted Zerodha about this issue, and if so, do you remember the date?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","entityName":"Zerodha","entityType":"broker","issueSummaryEnglish":"Investor complaint regarding INR 40,000 against Zerodha, on or around 2026-03-03. The investor's own description: \"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March\"","issueSummaryOriginal":"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March","incidentDate":"2026-03-03","amountInvolved":40000}
missing: [reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     I want a full refund of the amount
AGENT:    I have noted that you want a full refund. Have you already contacted Zerodha about this issue, and if so, do you remember the date?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"reliefSought":"Refund of the amount"}
missing: [priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I have not contacted Zerodha about this
AGENT:    I understand. SEBI only accepts a complaint if you first approached the company. Want me to draft that email for you?
lang: en | phase: INTAKE -> CONFIRM | nextAction: none
state diff: {"priorContactProof":"none"}
missing: []
asked-about: - | assertions: 

Turn 5
USER:     Please show me a summary to review
AGENT:    Here is the summary of your complaint for your review.
lang: en | phase: CONFIRM -> PREFLIGHT_EMAIL | nextAction: show_summary
state diff: {}
missing: []
asked-about: - | assertions: PASS
review: shown

Scenario assertions:
- note: confirm turn phase: PREFLIGHT_EMAIL
