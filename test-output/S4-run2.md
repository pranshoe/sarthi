# S4 Regression: August dates, no year/category/summary interrogation — run 2 (live) — PASS

Turn 1
USER:     HI
AGENT:    Hello! I am Saathi, here to help you file your complaint smoothly on SEBI SCORES or IEPF. Please tell me what happened so we can get started.
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August
AGENT:    I completely understand how worrying it is when your sale proceeds are delayed. What is the total amount involved in rupees?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","entityName":"Zerodha","entityType":"broker","issueSummaryEnglish":"Investor complaint regarding against Zerodha. The investor's own description: \"Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August\"","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August","incidentDate":"2026-08-01"}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     2026
AGENT:    Thank you. What kind of relief or resolution are you seeking from Zerodha?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"amountInvolved":2026}
missing: [reliefSought, priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I already told you, the sale was on 1st August 2026 and the money hasn't come
AGENT:    I understand your frustration about the delayed sale proceeds. What specific resolution are you seeking from Zerodha?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [reliefSought, priorContact]
asked-about: - | assertions: 

Turn 5
USER:     You should be able to tell the category from what I said
AGENT:    You are completely right, and I apologize for asking. Have you already contacted Zerodha about this issue before reaching out here?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [reliefSought, priorContact]
asked-about: - | assertions: 

Turn 6
USER:     Yes continue
AGENT:    Could you please tell me the exact date when you contacted them?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"skippedFields":["reliefSought"]}
missing: [priorContact]
asked-about: - | assertions: PASS
