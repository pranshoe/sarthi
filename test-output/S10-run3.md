# S10 State integrity: untouched date stays, explicit correction applies cleanly — run 3 (live) — PASS

Turn 1
USER:     The weather is nice today
AGENT:    Sorry, I'm having trouble reaching my service right now. Could you please repeat that?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"priorContactConfirmed":true}
missing: [incidentDate, reliefSought]
asked-about: - | assertions: 

Turn 2
USER:     Actually it was 25,000 rupees
AGENT:    Sorry, I'm having trouble reaching my service right now. Could you please repeat that?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"amountInvolved":25000}
missing: [incidentDate, reliefSought]
asked-about: - | assertions: PASS
