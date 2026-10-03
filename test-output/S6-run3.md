# S6 HARD review: card same turn, confirm is free, one follow-up continues — run 3 (live) — PASS

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, and I can help you file your complaint on the SEBI SCORES portal easily. Please tell me what happened so we can get started.
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha has not credited my 40000 rupees sale proceeds since 3rd March
AGENT:    I understand how worrying it is to wait for your sale proceeds. Have you already contacted Zerodha about this issue, and if so, when?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","entityName":"Zerodha","entityType":"broker","issueSummaryEnglish":"Investor complaint regarding INR 40,000 against Zerodha, on or around 2026-03-03. The investor's own description: \"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March\"","issueSummaryOriginal":"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March","incidentDate":"2026-03-03","amountInvolved":40000}
missing: [reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     I want a full refund of the amount
AGENT:    I have noted that you are seeking a full refund. Have you already contacted Zerodha about this issue, and if so, when?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"reliefSought":"Refund of the amount"}
missing: [priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I have not contacted Zerodha about this
AGENT:    Since you have not contacted them yet, I am not sure about this specific requirement outside of SCORES rules, but you can check scores.sebi.gov.in. Want me to draft that email for you?
lang: en | phase: INTAKE -> CONFIRM | nextAction: none
state diff: {"priorContactProof":"none"}
missing: []
asked-about: - | assertions: 

Turn 5
USER:     Please show me a summary to review
AGENT:    Here is the summary of your complaint against Zerodha for your review.
lang: en | phase: CONFIRM -> PREFLIGHT_EMAIL | nextAction: show_summary
state diff: {}
missing: []
asked-about: - | assertions: PASS
review: shown

Scenario assertions:
- note: confirm turn phase: PREFLIGHT_EMAIL
