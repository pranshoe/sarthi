# S10 State integrity: untouched date stays, explicit correction applies cleanly — run 3 (live) — PASS

Turn 1
USER:     The weather is nice today
AGENT:    It certainly is! I understand it can be worrying when your funds are stuck, so let's get this sorted out quickly. Could you please tell me the exact date when your funds got stuck?
lang: mr | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"priorContactConfirmed":true}
missing: [incidentDate, reliefSought]
asked-about: - | assertions: 

Turn 2
USER:     Actually it was 25,000 rupees
AGENT:    I have updated the amount to 25,000 rupees. Could you please tell me the exact calendar date when your funds got stuck?
lang: mr | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"amountInvolved":25000}
missing: [incidentDate, reliefSought]
asked-about: - | assertions: PASS
