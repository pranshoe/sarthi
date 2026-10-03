# S4 Regression: August dates, no year/category/summary interrogation — run 1 (live) — PASS

Turn 1
USER:     HI
AGENT:    Hello! I am Saathi, your helpful assistant for filing complaints on SEBI SCORES and IEPF. I can guide you step-by-step through the entire process quickly and easily. Please tell me what happened with your investment.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August
AGENT:    I understand this is concerning. Which company or broker did this happen with, and approximately how much money is involved?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"entityName":"Zerodha","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August","incidentDate":"2026-08-01","soldDescription":"50 Infosys shares"}
missing: [issueSummaryEnglish, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     2026
AGENT:    Could you please tell me the total amount of money involved in this transaction?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {"issueSummaryEnglish":"Zerodha has not paid the sale proceeds for 50 Infosys shares sold on 1st August 2026, which were due on 4th August 2026."}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I already told you, the sale was on 1st August 2026 and the money hasn't come
AGENT:    I understand your frustration, and I apologize for asking again. Could you please tell me the exact amount of money involved?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 5
USER:     You should be able to tell the category from what I said
AGENT:    Sorry, I didn't catch that clearly. Could you tell me what happened, in your own words?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 6
USER:     Yes continue
AGENT:    Have you already tried contacting Zerodha about this issue?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","skippedFields":["amountInvolved"]}
missing: [reliefSought, priorContact]
asked-about: - | assertions: PASS
