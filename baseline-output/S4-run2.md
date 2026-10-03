# S4 Regression: August dates, no year/category/summary interrogation — run 2 (live) — FAIL

Turn 1
USER:     HI
AGENT:    Hello! I am Saathi, here to help you file your complaint smoothly on SEBI SCORES or IEPF. Please tell me what happened so we can get started.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August
AGENT:    I understand how worrying it is to wait for your sale proceeds. Could you please let me know which year you sold those shares on 1st August?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {"entityName":"Zerodha","entityType":"broker","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August","soldDescription":"50 Infosys shares"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     2026
AGENT:    Thank you. What is the total amount in rupees that is pending from this sale?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"issueSummaryEnglish":"Sale proceeds of 50 Infosys shares sold on 1st August 2026 not received from Zerodha, amount was due on 4th August 2026.","issueSummaryOriginal":"Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August 2026 and the money was due on 4th August 2026.","incidentDate":"2026-08-01"}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I already told you, the sale was on 1st August 2026 and the money hasn't come
AGENT:    I understand your frustration about the delayed payment. Could you please let me know the total amount in rupees that is pending?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 5
USER:     You should be able to tell the category from what I said
AGENT:    You are completely right, my apologies. Could you please let me know the total amount in rupees involved?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds"}
missing: [amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 6
USER:     Yes continue
AGENT:    Could you please let me know what specific resolution or relief you are seeking from Zerodha?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {"skippedFields":["amountInvolved"]}
missing: [reliefSought, priorContact]
asked-about: - | assertions: FAIL (T2 never asks for the year: I understand how worrying it is to wait for your sale proceeds. Could you please let me know which year you sold those shares on 1st August?)
