# S1 Greeting gets greeting + invite, no field question — run 3 (live) — FAIL

Turn 1
USER:     hi
AGENT:    Hello! I can help you file your complaint smoothly on SEBI SCORES or IEPF. Please tell me briefly what happened so we can get started.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: FAIL (mentions saathi: Hello! I can help you file your complaint smoothly on SEBI SCORES or IEPF. Please tell me briefly what happened so we ca)
