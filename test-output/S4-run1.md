# S4 Regression: August dates, no year/category/summary interrogation — run 1 (live) — PASS

Turn 1
USER:     HI
AGENT:    Hello! I am Saathi, here to help you file your complaint with SEBI SCORES or IEPF easily and quickly. Please tell me what happened so we can get started.
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August
AGENT:    I understand how worrying it is to wait for your sale proceeds. Could you please let me know the exact date when this issue happened?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","entityName":"Zerodha","entityType":"broker","issueSummaryEnglish":"Investor complaint regarding against Zerodha. The investor's own description: \"Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August\"","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August","soldDescription":"50 Infosys shares"}
missing: [incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     2026
AGENT:    Thank you for the date, what is the total amount involved in this transaction?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"incidentDate":"2026-08-04"}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I already told you, the sale was on 1st August 2026 and the money hasn't come
AGENT:    I understand your frustration about the delayed funds; could you please let me know the total amount involved?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 5
USER:     You should be able to tell the category from what I said
AGENT:    I apologize for repeating that, and since the category is already noted as non-receipt of funds, could you please share the total amount involved?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 6
USER:     Yes continue
AGENT:    Have you contacted Zerodha about this issue yet?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"skippedFields":["amountInvolved"]}
missing: [reliefSought, priorContact]
asked-about: - | assertions: PASS
