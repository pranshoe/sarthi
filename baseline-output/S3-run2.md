# S3 One message fills entity, amount, date, issue, category — run 2 (live) — FAIL

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, here to help you file your complaint on SEBI SCORES smoothly. I will guide you through gathering the right details step by step so your grievance reaches the right place. Please tell me what happened with your investment.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March
AGENT:    I understand how worrying it is to wait for your funds. Which company or broker is this regarding?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"entityName":"Zerodha","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March","incidentDate":"2026-03-03","reliefSought":"Receive sale proceeds of 40,000 rupees"}
missing: [issueSummaryEnglish, amountInvolved, priorContact]
asked-about: - | assertions: FAIL (amount numeric: null; relief holds no digits: Receive sale proceeds of 40,000 rupees; issue captured: issue missing; category inferred: null)
