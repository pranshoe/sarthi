# S3 One message fills entity, amount, date, issue, category — run 3 (live) — FAIL

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, here to help you file your complaint on SEBI SCORES or IEPF step by step. Please tell me what happened so we can get started.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March
AGENT:    I understand your frustration regarding the pending funds from Zerodha. Could you please tell me what kind of relief or resolution you are seeking for this issue?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {"entityName":"Zerodha","entityType":"broker","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March","incidentDate":"2026-03-03"}
missing: [issueSummaryEnglish, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: FAIL (amount numeric: null; issue captured: issue missing; category inferred: null)
