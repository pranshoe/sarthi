# S12 Language mirror + mid-chat switch — run 3 (live) — PASS

Turn 1
USER:     mera paisa nahi aaya
AGENT:    Maaf kijiye, seva se sampark nahi ho pa raha hai. Kripya dohrayein?
lang: hi | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"complaintCategory":"Non-receipt of funds","issueSummaryEnglish":"Investor complaint regarding against the broker/company. The investor's own description: \"mera paisa nahi aaya\"","issueSummaryOriginal":"mera paisa nahi aaya"}
missing: [entityName, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 2
USER:     मेरा पैसा नहीं आया
AGENT:    माफ़ कीजिए, सेवा से संपर्क नहीं हो पा रहा है। कृपया दोहराएँ?
lang: hi | phase: INTAKE -> INTAKE | nextAction: none
state diff: {}
missing: [entityName, incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 3
USER:     vanakkam
AGENT:    Vanakkam! Naan Saathi. SEBI SCORES alladhu IEPF-il pugaar seiya udhavugiren. Enna nadandhadhu endru sollungal.
lang: ta | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"skippedFields":["entityName"]}
missing: [incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: 

Turn 4
USER:     my broker is Zerodha
AGENT:    Sorry, I'm having trouble reaching my service right now. Could you please repeat that?
lang: en | phase: INTAKE -> INTAKE | nextAction: none
state diff: {"entityName":"Zerodha","entityType":"broker","skippedFields":[]}
missing: [incidentDate, amountInvolved, reliefSought, priorContact]
asked-about: - | assertions: PASS
