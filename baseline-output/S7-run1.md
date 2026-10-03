# S7 Email flow: draft + Gmail same turn, done asks date, date confirms — run 1 (live) — FAIL

Turn 1
USER:     I haven't contacted them
AGENT:    Namaste! I am Saathi, your assistant for SEBI SCORES and IEPF complaints. I am here to help you get your issue sorted out quickly and easily.
lang: hi | phase: GREETING -> GREETING | nextAction: none
state diff: {"priorContactProof":"none"}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 2
USER:     yes draft it
AGENT:    Please tell me your client ID or UCC, or reply 'skip' to leave it blank.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 3
USER:     Done, I sent it
AGENT:    On which exact date did you send the email?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 4
USER:     yesterday
AGENT:    Thank you for sharing the date. Do you have any proof like a screenshot or a ticket number?
lang: en | phase: GREETING -> GREETING | nextAction: none
state diff: {"priorContactDate":"2026-10-02","skippedFields":["entityName"]}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: FAIL (draft shown on agree: no draft card on turn 2; gmail URL opened same turn: null; confirmed after date: false)
