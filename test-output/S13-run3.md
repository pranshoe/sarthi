# S13 Mid-flow SCORES question answered, then resumes without repeats — run 3 (live) — PASS

Turn 1
USER:     hi
AGENT:    Hello! I'm Saathi. Tell me what happened in your own words, and I'll help you file it on SEBI SCORES or IEPF. So, what happened?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, issueSummaryEnglish, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     Zerodha took my money
AGENT:    Sorry, I'm having trouble reaching my service right now. Could you please repeat that?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"entityName":"Zerodha","entityType":"broker","issueSummaryEnglish":"Investor complaint regarding against Zerodha. The investor's own description: \"Zerodha took my money\"","issueSummaryOriginal":"Zerodha took my money"}
missing: [incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     What is SCORES?
AGENT:    SCORES (scores.sebi.gov.in) is SEBI's online portal for investor complaints. If the company doesn't resolve your email, you can file there — and I'll help you prepare everything for it.
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: PASS
