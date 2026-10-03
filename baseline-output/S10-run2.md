# S10 State integrity: untouched date stays, explicit correction applies cleanly — run 2 (live) — PASS

Turn 1
USER:     The weather is nice today
AGENT:    It certainly is! To help you get your ₹40,000 back from Zerodha, could you please tell me the exact date when your funds first got stuck?
lang: mr | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"priorContactConfirmed":true}
missing: [incidentDate, reliefSought]
asked-about: - | assertions: 

Turn 2
USER:     Actually it was 25,000 rupees
AGENT:    Noted, I have updated the amount to ₹25,000. Could you please tell me the exact date when your funds first got stuck?
lang: mr | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"amountInvolved":25000}
missing: [incidentDate, reliefSought]
asked-about: - | assertions: PASS
