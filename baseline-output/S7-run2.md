# S7 Email flow: draft + Gmail same turn, done asks date, date confirms — run 2 (live) — FAIL

Turn 1
USER:     I haven't contacted them
AGENT:    Namaste! I am Saathi, and I am here to help you file your complaint with SEBI SCORES or IEPF step by step. We will get this sorted out together, so please tell me the name of the company or broker you are dealing with.
lang: hi | phase: GREETING -> GREETING | nextAction: none
state diff: {"priorContactProof":"none"}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 2
USER:     yes draft it
AGENT:    
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 3
USER:     Done, I sent it
AGENT:    Sorry, I didn't catch that clearly. Could you tell me what happened, in your own words?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 4
USER:     yesterday
AGENT:    Thank you for confirming. Do you have any proof, like a screenshot or a ticket or reference number from that email?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"priorContactDate":"2026-10-02","skippedFields":["entityName"]}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: FAIL (draft shown on agree: no draft card on turn 2; gmail URL opened same turn: null; done asks the date: Sorry, I didn't catch that clearly. Could you tell me what happened, in your own words?; confirmed after date: false)
