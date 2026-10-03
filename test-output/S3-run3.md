# S3 One message fills entity, amount, date, issue, category — run 3 (live) — PASS

Turn 1
USER:     hi
AGENT:    Hello! I'm Saathi. Tell me what happened in your own words, and I'll help you file it on SEBI SCORES or IEPF. So, what happened?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March
AGENT:    Sorry, I'm having trouble reaching my service right now. Could you please repeat that?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","entityName":"Zerodha","entityType":"broker","issueSummaryEnglish":"Investor complaint regarding INR 40,000 against Zerodha, on or around 2026-03-03. The investor's own description: \"Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March\"","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March","incidentDate":"2026-03-03","amountInvolved":40000}
missing: [reliefSought, priorContact]
asked-about: - | assertions: PASS
