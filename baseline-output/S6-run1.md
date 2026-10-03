# S6 HARD review: card same turn, Yes advances with zero LLM calls — run 1 (live) — FAIL

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, your guide for filing complaints on SEBI SCORES and IEPF. I can help you organize your details and prepare your filing easily. Please tell me what happened with your investment.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha has not credited my 40000 rupees sale proceeds since 3rd March
AGENT:    I am sorry to hear about the delay with your sale proceeds. Did you reach out to Zerodha about this issue before coming here?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"entityName":"Zerodha","entityType":"broker","issueSummaryOriginal":"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     I want a full refund of the amount
AGENT:    Thank you. Did you already reach out to Zerodha about this issue before coming here?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"reliefSought":"Full refund of the amount"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I have not contacted Zerodha about this
AGENT:    SEBI rules require us to approach the company first before filing a complaint, so would you like me to draft an email for you to send to them?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"priorContactProof":"none"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved]
asked-about: - | assertions: 

Turn 5
USER:     Please show me a summary to review
AGENT:    I am not sure about this specific requirement, so please check scores.sebi.gov.in for details. Would you like me to draft an email for you to send to Zerodha first?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {"skippedFields":["issueSummaryEnglish"]}
missing: [incidentDate, amountInvolved]
asked-about: - | assertions: FAIL (review card shown: no turn carried a review card; review data complete: missing=[incidentDate,amountInvolved]; no new LLM call on confirm: 1 extra call(s); summary confirmed: not confirmed)

Scenario assertions:
- note: confirm turn phase: GREETING
