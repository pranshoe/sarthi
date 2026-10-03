# S7 Email flow: draft + Gmail same turn, done asks date, date confirms — run 1 (live) — PASS

Turn 1
USER:     I haven't contacted them
AGENT:    No problem at all. Want me to draft that email for you?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"priorContactProof":"none"}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 2
USER:     yes draft it
AGENT:    Here is the email draft — please review it below.
lang: en | phase: INTAKE -> INTAKE | nextAction: draft_email
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 
draft: shown | gmail: https://mail.google.com/mail/?view=cm&to=&su=Grievance%20redressal%20request%20-%20%5BBroker%20%2F%20company%20name%5D&body=To%20the%20Grievance%20%2F%20Compliance%20Officer%2C%20%5BBroker%20%2F%20company%20name%5D%2C%0A%0AI%20am%20writing%20to%20formally%20raise%20the%20following%20grievance%20regarding%20my%20account.%0A%0AClient%20ID%20%2F%20UCC%20%2F%20Folio%3A%20%5Byour%20client%20ID%20%2F%20UCC%20%2F%20folio%20number%5D%0ADate%20of%20the%20incident%3A%20%5Bdate%20of%20the%20incident%5D%0AAmount%20involved%3A%20%5Bamount%20in%20INR%5D%0AWhat%20this%20is%20about%3A%20%5Bdescribe%20what%20went%20wrong%5D%0AWhat%20was%20bought%20or%20sold%3A%20%5Bdescribe%20what%20was%20bought%20or%20sold%20%E2%80%94%20e.g.%20shares%20of%20___%5D%0A%0AI%20request%20you%20to%20look%20into%20this%20matter%20and%20resolve%20it.%0A%0AYou%20are%20requested%20to%20resolve%20this%20at%20the%20earliest.%20If%20it%20is%20not%20resolved%2C%20I%20will%20escalate%20the%20matter%20by%20lodging%20a%20complaint%20on%20SEBI%20SCORES.%0A%0APlease%20share%20a%20reference%20or%20ticket%20number%20for%20this%20complaint%20for%20my%20records.%0A%0ARegards%2C%0A%5BYour%20name%5D%0A%5BYour%20contact%20number%5D

Turn 3
USER:     Done, I sent it
AGENT:    When exactly did you send it? For example, 'yesterday' or '12th March'.
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: 

Turn 4
USER:     yesterday
AGENT:    Sorry, I'm having trouble reaching my service right now. Could you please repeat that?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"priorContactDate":"2026-10-02","priorContactConfirmed":true,"skippedFields":["entityName"]}
missing: [issueSummaryEnglish, incidentDate, amountInvolved, reliefSought]
asked-about: - | assertions: PASS
