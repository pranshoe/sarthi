# S6 HARD review: card same turn, confirm is free, one follow-up continues — run 1 (live) — PASS

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, your guide for filing complaints on SEBI SCORES and IEPF. I can help you draft and organize your grievance quickly and easily. Please tell me what happened so we can get started.
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha has not credited my 40000 rupees sale proceeds since 3rd March
AGENT:    I understand how worrying it is to wait for your funds. Have you contacted Zerodha about this yet, and if so, when?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","entityName":"Zerodha","entityType":"broker","issueSummaryEnglish":"Investor complaint regarding INR 40,000 against Zerodha, on or around 2026-03-03. The investor's own description: \"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March\"","issueSummaryOriginal":"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March","incidentDate":"2026-03-03","amountInvolved":40000}
missing: [reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     I want a full refund of the amount
AGENT:    I have noted that you are seeking a full refund. Have you contacted Zerodha about this issue yet?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"reliefSought":"Refund of the amount"}
missing: [priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I have not contacted Zerodha about this
AGENT:    Want me to draft that email for you?
lang: en | phase: INTAKE -> CONFIRM | nextAction: none
state diff: {"priorContactProof":"none"}
missing: []
asked-about: - | assertions: 

Turn 5
USER:     Please show me a summary to review
AGENT:    Here is the summary of your complaint details for your review.
lang: en | phase: CONFIRM -> PREFLIGHT_EMAIL | nextAction: show_summary
state diff: {}
missing: []
asked-about: - | assertions: PASS
review: shown

Scenario assertions:
- note: confirm turn phase: PREFLIGHT_EMAIL
