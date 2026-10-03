# S6 HARD review: card same turn, Yes advances with zero LLM calls — run 2 (live) — FAIL

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, your guide for filing complaints on SEBI SCORES and IEPF. I can help you organize your details and prepare your filing easily. Please tell me what happened with your investment.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha has not credited my 40000 rupees sale proceeds since 3rd March
AGENT:    It is stressful when funds are delayed. Which company or broker did this happen with?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"entityName":"Zerodha","entityType":"broker","issueSummaryOriginal":"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     I want a full refund of the amount
AGENT:    I understand you want your full refund. Could you please share the exact date when the sale proceeds were supposed to be credited?
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {"reliefSought":"Full refund of the sale proceeds amount"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, priorContact]
asked-about: - | assertions: 

Turn 4
USER:     I have not contacted Zerodha about this
AGENT:    Since you have not contacted them yet, SEBI requires you to write to Zerodha first before filing a complaint, and I can help draft that email for you. Would you like me to draft this email now?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"priorContactProof":"none"}
missing: [issueSummaryEnglish, incidentDate, amountInvolved]
asked-about: - | assertions: 

Turn 5
USER:     Please show me a summary to review
AGENT:    Sorry, I didn't catch that clearly. Could you tell me what happened, in your own words?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"skippedFields":["issueSummaryEnglish"]}
missing: [incidentDate, amountInvolved]
asked-about: - | assertions: FAIL (review card shown: no turn carried a review card; review data complete: missing=[incidentDate,amountInvolved]; no new LLM call on confirm: 1 extra call(s); summary confirmed: not confirmed)

Scenario assertions:
- note: confirm turn phase: GREETING
