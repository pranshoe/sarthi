# S3 One message fills entity, amount, date, issue, category — run 1 (live) — FAIL

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, here to help you file your complaint on SEBI SCORES or IEPF easily. Please tell me what happened so we can get started.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March
AGENT:    I understand how worrying it is to wait for your funds. What specific outcome are you seeking from Zerodha regarding this amount?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"entityName":"Zerodha","entityType":"broker","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March","soldDescription":"Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: FAIL (amount numeric: null; date resolved: null; issue captured: issue missing; category inferred: null)
