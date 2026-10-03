# S1 Greeting gets greeting + invite, no field question — run 2 (live) — PASS

Turn 1
USER:     hi
AGENT:    Hello! I am Saathi, your guide for filing complaints on SEBI SCORES and IEPF. I can help you easily organize your details and prepare your complaint step by step. Please tell me what happened with your investment.
lang: mr | phase: GREETING -> GREETING | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: PASS
