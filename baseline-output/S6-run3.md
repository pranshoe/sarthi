# S6 HARD review: card same turn, Yes advances with zero LLM calls — run 3 (live) — FAIL

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, here to help you file your complaint with SEBI SCORES or IEPF easily. Please tell me what happened so we can get started.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha has not credited my 40000 rupees sale proceeds since 3rd March
AGENT:    I understand how worrying it is to wait for your funds. What name is the company or broker you are dealing with?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"issueSummaryOriginal":"Zerodha has not credited my 40000 rupees sale proceeds since 3rd March","incidentDate":"2026-03-03","amountInvolved":40000,"soldDescription":"sale proceeds not credited"}
missing: [entityName, issueSummaryEnglish, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     I want a full refund of the amount
AGENT:    Have you contacted Zerodha about this issue prior to filing, and if so, what date did you reach out to them?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"skippedFields":["entityName"]}
missing: [issueSummaryEnglish, reliefSought, priorContact]
asked-about: incidentDate | assertions: 

Turn 4
USER:     I have not contacted Zerodha about this
AGENT:    I understand you have not contacted them yet. SEBI only accepts a complaint if you first approached the company, so would you like me to draft an email for you to send to Zerodha now?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"priorContactProof":"none","reliefSought":"Full refund of 40000 rupees sale proceeds"}
missing: [issueSummaryEnglish]
asked-about: - | assertions: 

Turn 5
USER:     Please show me a summary to review
AGENT:    I cannot show the summary yet because SEBI only accepts a complaint if you first approached the company. Would you like me to draft an email for you to send to Zerodha?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"skippedFields":["entityName","issueSummaryEnglish"]}
missing: []
asked-about: - | assertions: FAIL (review card shown: no turn carried a review card; review lists the entity: [null,null,"2026-03-03","INR 40000","Full refund of 40000 rupees sale proceeds","No — will email first"]; card markup shows entity: <div class="mt-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3" data-testid="review-card"><p class="mb-2 text-[12px] font-bold uppercase tracking-wide text-brand-700">Please review</p><dl clas; no new LLM call on confirm: 1 extra call(s); summary confirmed: not confirmed)

Scenario assertions:
- note: confirm turn phase: GREETING
