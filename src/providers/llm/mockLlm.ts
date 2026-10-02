import type { LLMProvider, ChatMessage } from "../types";
import type { GrievanceState, Phase } from "@/shared/types";
import { detectLanguage, isSmallTalk, type DetectedLang } from "@/agent/detect";
import { findDateInText } from "@/state/dates";
import { SCORES_RULES } from "@/data/scoresRules";
import {
  BARE_DENIAL,
  CONTACT_CLAIM,
  EMAIL_AGREEMENT,
  EXPLICIT_DENIAL,
  isAgreementToDraft,
} from "@/agent/contactPhrases";

/** Day counts in mock replies come from the verified rules, never literals. */
const WAIT = SCORES_RULES.preFilingEntityWaitDays.value;

/**
 * Mock LLM. A test double standing in for the model, so the whole agent and all
 * ten acceptance tests run with zero credits (spec 2c).
 *
 * This file deliberately contains scripted replies: it is simulating what a
 * model would produce. The production agent code contains no question strings
 * at all - in live mode every user-facing message is written by Gemini.
 *
 * NOTE: never round-trip this file through PowerShell. It is full of Indic text
 * and Windows PowerShell's Get-Content/Set-Content mangles non-ASCII.
 */

interface Variant {
  key: string;
  reply: string;
}
/** prompt key -> language -> wordings */
type Bank = Record<string, Record<string, Variant[]>>;

const BANK: Bank = {
  // Greeting shape: greet back + the journey in two sentences + one open
  // invite. Never a field question.
  greet: {
    en: [
      { key: "greet", reply: "Hello, I'm Saathi. Tell me what happened in your own words, and I'll check whether you've already written to the company — if not, I'll draft that email for you. Then I'll fill the SCORES form, so all you do is review and submit. So, what happened?" },
      { key: "greet", reply: "Hi, I'm Saathi. You describe the problem, and I'll make sure the company has been contacted first, drafting that email for you if needed. After that I fill the SCORES form, and you just review and submit. Tell me your story in your own words." },
      { key: "greet", reply: "Hello, and welcome — I'm Saathi. Start by telling me your problem in your own words; I'll sort out the email to the company and then the SCORES paperwork. You stay in control throughout and click submit yourself at the end. Go ahead, I'm listening." },
    ],
    enLatn: [
      { key: "greet", reply: "Hi, I'm Saathi. Tell me what happened in your own words, and I'll handle the email to the company and then the SCORES form. You just review and submit at the end. So, what happened?" },
      { key: "greet", reply: "Hello, I'm Saathi. You tell me the problem, I'll sort the company email and the SEBI paperwork. What went wrong?" },
    ],
    hi: [
      { key: "greet", reply: "नमस्ते, मैं सारथी हूँ। अपनी भाषा में बताइए क्या हुआ था — मैं देखूँगा कि आपने कंपनी को लिखा है या नहीं, ज़रूरत हो तो वह ईमेल बना दूँगा। फिर SCORES फॉर्म भर दूँगा, आपको बस जाँचकर भेजना होगा। तो बताइए, क्या हुआ था?" },
      { key: "greet", reply: "नमस्ते। मैं सारथी हूँ। आप अपनी समस्या बताइए, मैं कंपनी को ईमेल और फिर SCORES का फॉर्म तैयार कर दूँगा। आखिर में आप खुद जाँचकर सबमिट करेंगे। क्या समस्या है?" },
      { key: "greet", reply: "हैलो, मैं सारथी। SEBI SCORES एक सरकारी पोर्टल है जहाँ निवेशक शिकायत करते हैं। पहले आप अपनी बात बताइए, फिर मैं कंपनी का ईमेल और फॉर्म सँभाल लूँगा। क्या हुआ था?" },
    ],
    hiLatn: [
      { key: "greet", reply: "Namaste, main Saathi hoon. Apni bhasha mein bataiye kya hua tha — main dekhunga ki aapne company ko likha hai ya nahi, zaroorat ho to woh email bana dunga. Phir SCORES form bhar dunga, aapko bas check karke bhejna hoga. To bataiye, kya hua tha?" },
      { key: "greet", reply: "Hello, main Saathi. Aap apni samasya bataiye, main company ko email aur phir SCORES ka form taiyaar kar dunga. Aakhir mein aap khud check karke submit karenge. Kya problem hai?" },
    ],
    ta: [
      { key: "greet", reply: "வணக்கம், நான் சாத்தி. உங்கள் சொற்களில் என்ன நடந்தது என்று சொல்லுங்கள் — நீங்கள் நிறுவனத்திற்கு எழுதிவிட்டீர்களா என்று பார்த்து, தேவைப்பட்டால் அந்த மின்னஞ்சலைத் தயாரிக்கிறேன். பிறகு SCORES படிவத்தை நிரப்புகிறேன், நீங்கள் சரிபார்த்து அனுப்பினால் போதும். சொல்லுங்கள், என்ன நடந்தது?" },
      { key: "greet", reply: "வணக்கம், நான் சாத்தி. உங்கள் பிரச்சினையைச் சொல்லுங்கள்; நிறுவனத்திற்கான மின்னஞ்சலையும் SCORES படிவத்தையும் நான் தயாரிக்கிறேன். இறுதியில் நீங்களே சரிபார்த்து அனுப்புவீர்கள். என்ன நடந்தது?" },
    ],
    kn: [
      { key: "greet", reply: "ನಮಸ್ಕಾರ, ನಾನು ಸಾರ್ಥಿ. ನಿಮ್ಮ ಮಾತಿನಲ್ಲಿ ಏನಾಯಿತು ಎಂದು ತಿಳಿಸಿ — ನೀವು ಕಂಪನಿಗೆ ಬರೆದಿದ್ದೀರಾ ಎಂದು ನೋಡಿ, ಬೇಕಾದರೆ ಆ ಇಮೇಲ್ ಸಿದ್ಧಪಡಿಸುತ್ತೇನೆ. ನಂತರ SCORES ಫಾರ್ಮ್ ತುಂಬುತ್ತೇನೆ, ನೀವು ಪರಿಶೀಲಿಸಿ ಕಳುಹಿಸಿದರೆ ಸಾಕು. ಹೇಳಿ, ಏನಾಯಿತು?" },
      { key: "greet", reply: "ನಮಸ್ಕಾರ, ನಾನು ಸಾರ್ಥಿ. ನಿಮ್ಮ ಸಮಸ್ಯೆ ಹೇಳಿ; ಕಂಪನಿಗೆ ಇಮೇಲ್ ಮತ್ತು SCORES ಫಾರ್ಮ್ ನಾನು ಸಿದ್ಧಪಡಿಸುತ್ತೇನೆ. ಕೊನೆಯಲ್ಲಿ ನೀವೇ ಪರಿಶೀಲಿಸಿ ಸಲ್ಲಿಸುವಿರಿ. ಏನಾಗಿದೆ?" },
    ],
    te: [
      { key: "greet", reply: "నమస్కారం, నేను సాథి. మీ మాటల్లో ఏమి జరిగిందో చెప్పండి — మీరు కంపెనీకి రాశారో లేదో చూసి, అవసరమైతే ఆ ఇమెయిల్ సిద్ధం చేస్తాను. తర్వాత SCORES ఫారం నింపుతాను, మీరు పరిశీలించి పంపితే చాలు. చెప్పండి, ఏమి జరిగింది?" },
    ],
  },

  // Never shown before a small talk has happened.
  ask_issue: {
    en: [
      { key: "ask_issue", reply: "I'm sorry that's happened. Tell me what went wrong, in your own words." },
      { key: "ask_issue", reply: "Thanks for telling me. Could you describe it a little more - what happened, and what did you expect instead?" },
      { key: "ask_issue", reply: "Understood. In your own words, what's the issue you'd like the company to fix?" },
    ],
    enLatn: [
      { key: "ask_issue", reply: "Sorry about that. Tell me what went wrong, in your own words." },
    ],
    hi: [
      { key: "ask_issue", reply: "यह सुनकर खेद है। अपनी भाषा में बताइए, क्या समस्या हुई?" },
      { key: "ask_issue", reply: "मुझे समझ आ गया। समस्या थोड़ी विस्तार से बताइए - क्या हुआ, और आपको क्या होना चाहिए था?" },
      { key: "ask_issue", reply: "ठीक है। अपनी भाषा में बताइए, आप किस चीज़ की शिकायत कर रहे हैं?" },
    ],
    hiLatn: [
      { key: "ask_issue", reply: "Yeh sunkar kharash hua. Apni bhasha mein bataiye, kya masla hua?" },
      { key: "ask_issue", reply: "Samajh gaya. Masla thoda vistar se bataiye - kya hua, aur aapko kya hona chahiye tha?" },
    ],
    ta: [
      { key: "ask_issue", reply: "அதற்கு வருந்ததாக நினைக்கிறேன். உங்கள் சொற்களில் பிரச்சினை என்ன என்று சொல்லுங்கள்." },
      { key: "ask_issue", reply: "புரிந்தது. சற்று விரிவாக சொல்லுங்கள் - என்ன நடந்தது, உங்களுக்கு எதிர்பார்த்தது என்ன?" },
    ],
    kn: [
      { key: "ask_issue", reply: "ಅದು ಕೇಳಿ ಹಿಂಗಿದೆ. ನಿಮ್ಮ ಮಾತಿನಲ್ಲೇ ಏನಾಯಿತು ಎಂದು ತಿಳಿಸಿ." },
      { key: "ask_issue", reply: "ಅರ್ಥವಾಯಿತು. ಸಮಸ್ಯೆ ಸ್ವಲ್ಪ ವಿಸ್ತರಿಸಿ ತಿಳಿಸಿ - ಏನಾಯಿತು, ನಿಮಗೆ ಏನಾಗಬೇಕಿತ್ತು?" },
    ],
  },

  ask_entity: {
    en: [
      { key: "ask_entity", reply: "Got it. Which broker or company is this about?" },
      { key: "ask_entity", reply: "Thank you. Now, who is it with - which broker or company?" },
      { key: "ask_entity", reply: "Understood. What's the name of the broker or company you're dealing with?" },
    ],
    hi: [
      { key: "ask_entity", reply: "समझ गया। यह किस ब्रोकर या कंपनी के बारे में है?" },
      { key: "ask_entity", reply: "धन्यवाद। आप किस ब्रोकर या कंपनी के साथ जुड़े हैं?" },
    ],
    hiLatn: [{ key: "ask_entity", reply: "Samajh gaya. Yeh kis broker ya company ke baare mein hai?" }],
    ta: [
      { key: "ask_entity", reply: "அர்த்தம். இது எந்த டீலர் அல்லது நிறுவனத்தைப் பற்றியது?" },
      { key: "ask_entity", reply: "நன்றி. எந்த டீலர் அல்லது நிறுவனத்துடன் சம்பந்தம்?" },
    ],
    kn: [
      { key: "ask_entity", reply: "ಅರ್ಥವಾಯಿತು. ಇದು ಯಾವ ಬ್ರೋಕರ್ ಅಥವಾ ಕಂಪನಿಯ ವಿಷಯವೇ?" },
    ],
  },

  ask_ucc: {
    en: [
      { key: "ask_optional_id", reply: "Do you have your client ID or UCC handy? If you share it with me, I'll put it on the form for you. It's on your contract notes, in the Profile section of your broker's app (for example, the Zerodha Console profile), or in your account-opening email. If you can't find it, no problem - tell me and we'll leave it blank." },
      { key: "ask_optional_id", reply: "If you share your client ID or UCC with me, I can put it on the form for you. You'll find it on any contract note or under Profile in your broker's app. Don't have it to hand? That's fine, we can manage without." },
      { key: "ask_optional_id", reply: "Next, the client ID or UCC if you know it - usually eight characters, printed on your contract note. If you'd rather not dig it out now, we can go on without it." },
    ],
    hi: [
      { key: "ask_optional_id", reply: "क्या आपके पास क्लाइंट आईडी या UCC है? इसे मुझे बता दें, मैं फॉर्म में भर दूँगा। यह कॉन्ट्रैक्ट नोट पर, ब्रोकर ऐप की प्रोफ़ाइल में, या खाता खोलने वाले ईमेल में मिलता है। नहीं मिल रहा? कोई बात नहीं, छोड़ देंगे।" },
    ],
    hiLatn: [
      { key: "ask_optional_id", reply: "Aapke paas client ID ya UCC hai? Yeh contract note par ya app ke profile mein milta hai. Nahi mil raha? Koi baat nahi, chhod denge." },
    ],
    ta: [
      { key: "ask_optional_id", reply: "உங்களிடம் client ID அல்லது UCC உள்ளதா? அது contract note-ல் இருக்கும். இல்லையா? பரவு, விட்டுவிடலாம்." },
    ],
    kn: [
      { key: "ask_optional_id", reply: "ನಿಮ್ಮಲ್ಲಿ client ID ಅಥವಾ UCC ಇದೆಯೇ? ಅದು contract note-ನಲ್ಲಿರುತ್ತದೆ. ಇಲ್ಲದಿದ್ದರೆ ಬಿಡುಗಡೆ ಮಾಡಬಹುದು." },
    ],
  },

  ask_date: {
    en: [
      { key: "ask_date", reply: "When did this first happen? A rough date is fine." },
      { key: "ask_date", reply: "Roughly when did you notice this - what month and day?" },
      { key: "ask_date", reply: "Can you tell me when it started? Even just the month helps." },
    ],
    hi: [
      { key: "ask_date", reply: "यह पहली बार कब हुआ? अनुमानित तारीख चलेगी।" },
      { key: "ask_date", reply: "बताइए, यह कब शुरू हुआ? महीना बता दें तो भी काफ़ी है।" },
    ],
    hiLatn: [{ key: "ask_date", reply: "Yeh pehli baar kab hua? Anumanit tareekh chalegi." }],
    ta: [
      { key: "ask_date", reply: "இது முதலில் எப்போது நடந்தது? தோராயமான தேதி போதும்." },
    ],
    kn: [
      { key: "ask_date", reply: "ಇದು ಮೊದಲ ಬಾರಿ ಯಾವಾಗ ನಡೆಯಿತು? ಸುಮಾರು ದಿನಾಂಕ ಸಾಕ." },
    ],
  },

  ask_amount: {
    en: [
      { key: "ask_amount", reply: "Roughly how much money is involved? It helps the company understand the stakes." },
      { key: "ask_amount", reply: "Any idea of the amount involved? An approximation is fine." },
    ],
    hi: [{ key: "ask_amount", reply: "कितनी राशि का मामला है? अनुमान हो तो भी चलेगा।" }],
  },

  ask_category: {
    en: [
      { key: "ask_category", reply: "What kind of problem is this, in your own words?" },
      { key: "ask_category", reply: "How would you describe what went wrong?" },
    ],
    hi: [{ key: "ask_category", reply: "यह किस तरह की समस्या है, अपने शब्दों में बताइए?" }],
  },

  ask_relief: {
    en: [
      { key: "ask_relief", reply: "And what would you like them to do to sort this out?" },
      { key: "ask_relief", reply: "What outcome are you hoping for - a refund, an explanation, or the reversal of a trade?" },
    ],
    hi: [{ key: "ask_relief", reply: "आप चाहते हैं कि यह ठीक होने के लिए वे क्या करें?" }],
  },

  ask_entity_type: {
    en: [
      { key: "ask_entity_type", reply: "In your own words, who is this company to you?" },
      { key: "ask_entity_type", reply: "Tell me about this company — what do they do for you?" },
    ],
    hi: [{ key: "ask_entity_type", reply: "यह कंपनी कौन है — अपने शब्दों में बताइए?" }],
  },

  explain_scores: {
    en: [
      { key: "explain_scores", reply: "SEBI SCORES is the government's online complaint portal for investors. You file it there and SEBI forwards your complaint to the broker or company, who then have to respond. Where were we?" },
      { key: "explain_scores", reply: `Think of SCORES as SEBI's grievance desk. Your complaint goes in, SEBI passes it to the company, and they must answer within ${SCORES_RULES.atrDays.value} days. Shall we carry on?` },
    ],
    hi: [{ key: "explain_scores", reply: `SEBI SCORES सरकार की ऑनलाइन शिकायत पोर्टल है। आप यहाँ शिकायत करते हैं, SEBI उसे ब्रोकर या कंपनी को भेजता है, और उन्हें ${SCORES_RULES.atrDays.value} दिन में जवाब देना होता है। आगे बढ़ें?` }],
    ta: [{ key: "explain_scores", reply: "SEBI SCORES என்பது அரசின் புகார் இணையதளம். நீங்கள் அங்கு புகார் செய்வீர்கள், SEBI அதை நிறுவனத்திற்கு அனுப்பும். தொடர்போமா?" }],
    kn: [{ key: "explain_scores", reply: "SEBI SCORES ಸರ್ಕಾರಿ ದೂರು ಇಣೆಯತಾನದ್ದು. ನೀವು ಅಲ್ಲಿ ದೂರು ಸಲ್ಲಿಸಿ, SEBI ಅದನ್ನು ಕಂಪನಿಗೆ ಕಳುಹಿಸುತ್ತದೆ. ಮುಂದುವರಿಸೋಣ?" }],
  },

  explain_prereq: {
    en: [
      { key: "explain_prereq", reply: `SEBI discards complaints where the investor hasn't written to the company first. So we email them and give them ${WAIT} days to sort it out. Only if they don't respond can you go to SCORES. Shall I draft that email?` },
      { key: "explain_prereq", reply: "The rule is that the company gets a chance first. That resolves most complaints without any further process. Shall I draft the email for you?" },
    ],
    hi: [{ key: "explain_prereq", reply: `अगर आपने पहले कंपनी को लिखा नहीं है, तो SEBI शिकायत हटा देता है। इसलिए पहले उन्हें ईमेल करते हैं और ${WAIT} दिन देते हैं। मैं वह ईमेल बना दूँ?` }],
    ta: [{ key: "explain_prereq", reply: `நீங்கள் முதலில் நிறுவனத்திற்கு எழுதவில்லை என்றால் SEBI புகாரை நிராகரிக்கும். ஆகவே முதலில் அவருக்கு எழுதி, ${WAIT} நாட்கள் கொடுப்போம். அந்த மின்னஞ்சலை நான் தயாரிக்கவா?` }],
    kn: [{ key: "explain_prereq", reply: `ಮೊದಲು ಕಂಪನಿಗೆ ಬರೆದಿಲ್ಲದಿದ್ದರೆ SEBI ದೂರನ್ನು ತಿರಸುತ್ತದೆ. ಹಾಗಾಗಿ ಮೊದಲು ಅವರಿಗೆ ಕಠಿಸಿ, ${WAIT} ದಿನ ಕೊಡೋಣ. ಆ ಇಮೇಲ್ ನಾನು ಸಿದ್ಧಪಡಿಸಲಿ?` }],
  },

  email_sent: {
    en: [
      { key: "email_sent", reply: `Thanks, that's noted. We count the ${WAIT} days from the day you wrote to them. Anything else to add?` },
      { key: "email_sent", reply: "Noted. The waiting clock starts from the date you sent it. Anything you've forgotten to mention?" },
    ],
    hi: [{ key: "email_sent", reply: `धन्यवाद, यह दर्ज हो गया। इसी तारीख से ${WAIT} दिन गिने जाएंगे। और कुछ बताना है?` }],
    ta: [{ key: "email_sent", reply: `நன்றி, பதிவானது. இந்தத் தேதியிலிருந்தே ${WAIT} நாட்கள் கணக்கிடப்படும். வேறு ஏதாவது சொல்ல வேண்டுமா?` }],
    kn: [{ key: "email_sent", reply: `ಧನ್ಯವಾದ, ದಾಖಲಾಗಿದೆ. ಈ ದಿನಾಂಕದಿಂದಲೇ ${WAIT} ದಿನ ಲೆಕ್ಕಿಸಲಾಗುತ್ತದೆ. ಬೇರೆ ಏನಾದರೂ ಹೇಳಬೇಕೆ?` }],
  },

  wait_notice: {
    en: [
      { key: "wait_notice", reply: `That's everything I need. Because you've written to them, SEBI gives them ${WAIT} days to respond, so we can't file yet. Come back after that and I'll have the SCORES form ready.` },
    ],
    hi: [{ key: "wait_notice", reply: `मुझे जो चाहिए वह सब मिल गया। आपने ईमेल भेजा है, इसलिए SEBI उन्हें ${WAIT} दिन देता है। उसके बाद आइए, फॉर्म तैयार रहेगा।` }],
    ta: [{ key: "wait_notice", reply: `எனக்கு தேவையான அனைத்தும் கிடைத்தது. நீங்கள் எழுதியதால் SEBI அவர்களுக்கு ${WAIT} நாட்கள் தரும். அதன் பிறகு வந்தால் படிவம் தயாராக இருக்கும்.` }],
    kn: [{ key: "wait_notice", reply: `ನನಗೆ ಬೇಕಾದದ್ದೆ ಎಲ್ಲಾ ಸಿಕ್ಕಿತು. ನೀವು ಕಳುಹಿಸಿದ್ದರೆ SEBI ಅವರಿಗೆ ${WAIT} ದಿನ ಕೊಡುತ್ತದೆ. ನಂತರ ಬಂದರೆ ಫಾರ್ಮ್ ಸಿದ್ಧವಾಗಿರುತ್ತದೆ.` }],
  },

  confirm_summary: {
    en: [
      { key: "confirm_summary", reply: "Let me make sure I've got this right. Please read it over and tell me if anything's wrong - you can correct anything just by saying so." },
    ],
    hi: [{ key: "confirm_summary", reply: "मैंने जो समझा है वह यह है। कृपया पढ़कर बताइए कि कहीं गलती है या नहीं।" }],
    ta: [{ key: "confirm_summary", reply: "நான் புரிந்ததை இவ்வாறு கொண்டுள்ளேன். தயவுசெய்து படித்து, ஏதாவது தவறு இருக்குமா என்று சொல்லுங்கள்." }],
    kn: [{ key: "confirm_summary", reply: "ನನಗೆ ಅರ್ಥವಾದದ್ದು ಇದೆ. ದಯವಿಟ್ಟು ಓದಿ, ಏನಾದರೂ ತಪ್ಪಿದೆಯೇ ಎಂದು ಹೇಳಿ." }],
  },

  confirmed: {
    en: [
      { key: "confirmed", reply: "Perfect, that's locked in. Shall we write to the company first - I'll draft the email so you can review and send it?" },
    ],
    hi: [{ key: "confirmed", reply: "बिल्कुल, यह पक्का हो गया। पहले कंपनी को ईमेल करें? मैं ड्राफ्ट बना दूँ, आप देखकर भेज दें।" }],
    ta: [{ key: "confirmed", reply: "சரி, முடிந்தது. முதலில் நிறுவனத்திற்கு எழுதுவோமா? மின்னஞ்சலை நான் தயாரித்து தருகிறேன்." }],
    kn: [{ key: "confirmed", reply: "ಸರಿ, ಖಚಿತವಾಯಿತು. ಮೊದಲು ಕಂಪನಿಗೆ ಬರೆದು? ಇಮೇಲ್ ನಾನು ಸಿದ್ಧಪಡಿಸುತ್ತೇನೆ." }],
  },

  offer_email: {
    en: [
      { key: "offer_email", reply: "No problem at all. Want me to draft that email to the company for you?" },
      { key: "offer_email", reply: "Understood — you haven't written to them yet. Shall I draft that email so you can send it?" },
    ],
    hi: [{ key: "offer_email", reply: "कोई बात नहीं। क्या मैं कंपनी के लिए वह ईमेल बना दूँ?" }],
  },

  ask_email_date: {
    en: [
      { key: "ask_email_date", reply: "When exactly did you send it? For example, 'yesterday' or '12th March'." },
      { key: "ask_email_date", reply: "Got it. What date did you send it on — even a rough one like last Monday works." },
    ],
    hi: [{ key: "ask_email_date", reply: "आपने वह कब भेजा था? जैसे 'कल' या '12 मार्च'।" }],
  },

  ask_proof: {
    en: [
      { key: "ask_proof", reply: "Thanks. Do you have any proof of it — a screenshot, or a ticket or reference number?" },
      { key: "ask_proof", reply: "Noted, thank you. Any proof you can share — a screenshot or a ticket number?" },
    ],
    hi: [{ key: "ask_proof", reply: "धन्यवाद। क्या आपके पास इसका कोई सबूत है — स्क्रीनशॉट या टिकट/रेफरेंस नंबर?" }],
  },

  proof_ack: {
    en: [{ key: "proof_ack", reply: "Noted, thank you. Let's carry on." }],
    hi: [{ key: "proof_ack", reply: "नोट कर लिया, धन्यवाद। आगे बढ़ते हैं।" }],
  },

  proof_screenshot: {
    en: [{ key: "proof_screenshot", reply: "Great — you can attach the screenshot in the review tab later. Anything else to add?" }],
    hi: [{ key: "proof_screenshot", reply: "बढ़िया — स्क्रीनशॉट आप बाद में रिव्यू टैब में लगा सकते हैं। और कुछ बताना है?" }],
  },

  agree_email: {
    en: [{ key: "agree_email", reply: "On it — here is the draft. Review it, send it from your Gmail, and tell me once it's sent." }],
    hi: [{ key: "agree_email", reply: "ठीक है — यह रहा ड्राफ्ट। इसे देखकर अपने Gmail से भेज दें, और भेजने पर बता दें।" }],
  },
};

/** Pre-send placeholder questions, keyed by field then language. */
const DRAFT_FIELD_BANK: Record<string, Record<string, Variant[]>> = {
  clientId: {
    en: [{ key: "draft_field", reply: "What is your client ID or UCC? You can say 'skip' to leave it blank." }],
    hi: [{ key: "draft_field", reply: "आपका क्लाइंट आईडी या UCC क्या है? छोड़ना हो तो 'skip' लिखें।" }],
  },
  amount: {
    en: [{ key: "draft_field", reply: "What amount is involved, in rupees?" }],
    hi: [{ key: "draft_field", reply: "इसमें कितनी राशि है, रुपयों में बताइए?" }],
  },
  incidentDate: {
    en: [{ key: "draft_field", reply: "What date did this first happen?" }],
    hi: [{ key: "draft_field", reply: "यह पहली बार कब हुआ था?" }],
  },
  soldDescription: {
    en: [{ key: "draft_field", reply: "What exactly was bought or sold?" }],
    hi: [{ key: "draft_field", reply: "असल में क्या खरीदा या बेचा गया था?" }],
  },
  userName: {
    en: [{ key: "draft_field", reply: "What is your full name, as it should appear in the email?" }],
    hi: [{ key: "draft_field", reply: "ईमेल में नाम कैसा दिखे — आपका पूरा नाम बताइए?" }],
  },
  userPhone: {
    en: [{ key: "draft_field", reply: "What is your mobile number for the email?" }],
    hi: [{ key: "draft_field", reply: "ईमेल के लिए आपका मोबाइल नंबर बताइए?" }],
  },
  ready: {
    en: [{ key: "draft_ready", reply: "The email draft is complete — review it and hit send when ready." }],
    hi: [{ key: "draft_ready", reply: "ईमेल ड्राफ्ट तैयार है — इसे देखकर भेज दें।" }],
  },
};

/** Most recent assistant message in a chat history, if any. */
function priorAssistant(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i]!.content;
  }
  return null;
}

/** "Earlier you said X, now Y — which is right?" in the user's language. */
function confirmText(det: DetectedLang, oldValue: string, newValue: string): string {
  switch (det.base) {
    case "hi":
      return `एक बात पक्की कर लूँ — पहले आपने कहा था "${oldValue}", अब "${newValue}"। इनमें से सही कौन है?`;
    case "ta":
      return `ஒன்றை உறுதிப்படுத்துகிறேன் — முன்பு "${oldValue}" என்றீர்கள், இப்போது "${newValue}". இதில் சரி எது?`;
    case "kn":
      return `ಒಂದು ವಿಷಯ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳುತ್ತೇನೆ — ಮೊದಲು "${oldValue}" ಎಂದಿರಿ, ಈಗ "${newValue}". ಇವುಗಳಲ್ಲಿ ಸರಿ ಯಾವುದು?`;
    default:
      return `Just to confirm — earlier you said "${oldValue}", now "${newValue}". Which one is right?`;
  }
}

const ACK: Record<string, string> = {
  en: "Got it, I've updated that.",
  hi: "समझ गया, यह अपडेट कर दिया।",
  hiLatn: "Samajh gaya, update kar diya.",
  ta: "புரிந்தது, அதைப் பதிவு செய்தேன்.",
  kn: "ಅರ್ಥವಾಯಿತು, ಅದನ್ನು ನವೀಕರಿಸಿದ್ದೇನೆ.",
  te: "తెలిసింది, అది అప్‌డేట్ చేశాను.",
};

/** Acknowledgement matching the reply's language AND script. */
function ackFor(det: DetectedLang): string {
  return ACK[langKey(det)] ?? ACK[det.base] ?? ACK.en!;
}

function langKey(l: DetectedLang): string {
  return l.latin ? `${l.base}Latn` : l.base;
}

/** Choose wording n for the detected language, falling back to English. */
function pick(byLang: Record<string, Variant[]> | undefined, l: DetectedLang, n: number): string {
  if (!byLang) return "";
  const set = byLang[langKey(l)] ?? byLang[l.base] ?? byLang.en ?? [];
  return set[n % set.length]?.reply ?? set[0]?.reply ?? "";
}

// ---- extraction, mirroring what the model is asked to do ----

const UCC = /\b(?:ucc|client\s*(?:id|code)|folio(?:\s*no)?|dp\s*id)\s*(?:no\.?|#|:|-)?\s*([A-Z0-9]{4,16})\b/i;
/** Rupee prefix optional, so "40000 rupees" and "Rs 40,000" both work. */
const AMOUNT =
  /(?:rs\.?|inr|₹|रु|ரூ|rupees?|rupaye|rupaiya|rupaiye)?\s*(₹?\s*[\d,]{4,}(?:\.\d+)?)\s*(lakh|lac|lacs|lakhs|thousand|hazaar|हजार|ಸಾವಿರ|தொகை)?/i;
const KNOWN_NAMES =
  /\b(zerodha|groww|upstox|angel\s*one|kotak|icici\s*direct|hdfc\s*securities|axis\s*securities|5paisa|indian\s*robin|sbi\s*securities|dhan|icici\s*securities)\b/i;

/** Search the whole message for a date. Shared logic lives in dates.ts. */
function findDateIn(text: string): string | null {
  return findDateInText(text);
}

interface Extracted {
  clientIdFolioNoDpid?: string;
  amountInvolved?: number;
  entityName?: string;
  incidentDate?: string;
  category?: string;
  relief?: string;
  entityType?: string;
  rejected?: boolean;
}

function extract(text: string): Extracted {
  const out: Extracted = {};
  const t = text.trim();

  const ucc = t.match(UCC);
  if (ucc) out.clientIdFolioNoDpid = ucc[1]!.toUpperCase();

  const amt = t.match(AMOUNT);
  if (amt && /[\d]/.test(amt[1]!)) {
    let v = parseFloat(amt[1]!.replace(/[^\d.]/g, ""));
    const unit = (amt[2] || "").toLowerCase();
    if (/lakh|lac/.test(unit)) v *= 100000;
    else if (/thousand|hazaar|हजार|साव/.test(unit)) v *= 1000;
    else if (/தொகை/.test(unit)) v *= 1000;
    if (Number.isFinite(v) && v >= 100) out.amountInvolved = v;
  }

  const named = t.match(KNOWN_NAMES);
  if (named) out.entityName = named[1]!.replace(/\s+/g, " ").trim();

  const date = findDateIn(t);
  if (date) out.incidentDate = date;

  if (/sale proceeds|not credited|didn'?t (come|arrive)|no.?t credited|adavu|paisa nahi|vittam|panam illa|credits? (not|never)|deposit nahi/i.test(t))
    out.category = "Non-receipt of funds";
  else if (/unauthori[sz]ed|without my (consent|permission)|cheating|fraud/i.test(t))
    out.category = "Unauthorized trade";
  else if (/clos(e|ing) (my )?account|band kar|mudhal|village|mattu/i.test(t))
    out.category = "Account closure issue";
  else if (/charges?|commission|fees?/i.test(t)) out.category = "Charges dispute";

  if (/refund|money back|paisa wapas|வாங்க|திரும்ப|ಹಣವನ್ನೂ ಹಿಂದಿಕೊಡೆ|paisa wapas/i.test(t))
    out.relief = "Refund of the amount";
  else if (/explanation|why did|clarif/i.test(t)) out.relief = "An explanation for the delay";
  else if (/revers(e|al) (the|my)? ?trade|cancel/i.test(t)) out.relief = "Reversal of the transaction";

  if (/broker|brokerage|zerodha|groww|upstox|angel/i.test(t)) out.entityType = "broker";
  else if (/nodal officer|iepf|unclaimed|demateriali/i.test(t)) out.entityType = "RTA";
  else if (/rta|registrar|transfer agent/i.test(t)) out.entityType = "RTA";

  if (/reject|refus|mana kar|tiraskal|ತಿರಸಿ|refused/i.test(t)) out.rejected = true;

  return out;
}

/**
 * Confidence per inferred field. Ask about category/entityType only below 0.6:
 * a name-implied broker or an explicit keyword scores high, a vague mention
 * does not. Mirrors what the live model is instructed to report.
 */
export function confidenceOf(text: string, got: Extracted): Record<string, number> {
  const t = text.trim();
  const conf: Record<string, number> = {};
  if (got.entityName) {
    conf.entityName = /\b(zerodha|groww|upstox|angel|kotak|icici|hdfc|axis|5paisa|dhan|sbi)\b/i.test(t) ? 0.9 : 0.7;
  }
  if (got.category) {
    conf.complaintCategory = /sale proceeds|not credited|unauthori[sz]ed|account clos/i.test(t) ? 0.85 : 0.65;
  }
  if (got.entityType) {
    conf.entityType = /\b(zerodha|groww|upstox|angel|rta|registrar|nodal officer|iepf)\b/i.test(t) ? 0.9 : 0.7;
  }
  if (got.amountInvolved) conf.amountInvolved = 0.95;
  if (got.incidentDate) conf.incidentDate = 0.9;
  if (got.clientIdFolioNoDpid) conf.clientIdFolioNoDpid = 0.95;
  if (got.relief) conf.reliefSought = 0.7;
  return conf;
}

// ---- conversation flow ----

interface Ask {
  field: string;
  key: string;
}

/** Optional fields come last so a required one is always asked about first. */
const QUESTION_ORDER: Ask[] = [
  { field: "issueSummaryEnglish", key: "ask_issue" },
  { field: "entityName", key: "ask_entity" },
  { field: "entityType", key: "ask_entity_type" },
  { field: "complaintCategory", key: "ask_category" },
  { field: "incidentDate", key: "ask_date" },
  { field: "reliefSought", key: "ask_relief" },
  { field: "amountInvolved", key: "ask_amount" },
  { field: "clientIdFolioNoDpid", key: "ask_ucc" },
];

/** "I don't know my client ID" and friends. */
const DECLINE = /\b(don'?t know|dont know|do not know|don'?t have|no idea|not sure|can'?t find|couldn'?t find|pata nahi|pata nahi hai|theri|தெரியாது|ಗೊತ್ತಿಲ್ಲ)\b/i;
const CLIENT_ID_MENTION = /\b(client\s*(?:id|code)|ucc|folio|dp\s*id)\b/i;
const CORRECTION = /^(no\b|no,|nope|not right|not correct|actually\b|correction|wrong\b|galat|galat hai|nahi\b|superseeded)/i;

export class MockLLMProvider implements LLMProvider {
  readonly id = "mock";
  private useCount = new Map<string, number>();

  async chat(messages: ChatMessage[]): Promise<string> {
    const system = messages[0]?.content ?? "";
    void system;
    const userTurns = messages.filter((m) => m.role === "user");
    const combined = userTurns[userTurns.length - 1]?.content ?? "";
    // Strip the appended turn instructions to recover the raw message.
    const bare = combined.split("\n\nCURRENT PHASE:")[0] ?? combined;

    const det = detectLanguage(bare);
    // State and phase come from the live instructions block, not from the
    // static system prompt: this keeps the mock in sync with what the model
    // is told, so it will not re-ask known fields or ignore the real phase.
    const state = parseKnownFromInstructions(combined);
    const phase = parsePhase(combined) as Phase;
    const turnNumber = this.bump("__turns");

    const replyText = this.composeReply(bare, det, state, phase, combined, priorAssistant(messages));
    void turnNumber;

    return JSON.stringify({
      detectedLanguage: det.tag,
      reply: replyText.reply,
      stateUpdates: replyText.updates,
      phase: replyText.phase,
      nextAction: replyText.action,
      confidence: replyText.confidence ?? {},
    });
  }

  private composeReply(
    bare: string,
    det: DetectedLang,
    state: GrievanceState,
    phase: Phase,
    full: string,
    priorAssistant: string | null,
  ): {
    reply: string;
    updates: Record<string, unknown>;
    phase: Phase;
    action: string;
    confidence?: Record<string, number>;
  } {
    // 0. Panel-open trigger, not a user message. Greet without learning anything:
    // treating this seed as content is what once filled the issue with garbage.
    if (bare.startsWith("The user has just opened the panel")) {
      return { reply: pick(BANK.greet, det, this.bump("greet")), updates: {}, phase: "INTAKE", action: "none" };
    }
    // Shared agreement context: what the agent said last, and whether
    // anything at all is known yet (mirrors the controller's gate).
    const mockEmpty =
      !state.issueSummaryEnglish &&
      !state.entityName &&
      !state.entityType &&
      !state.complaintCategory &&
      !state.incidentDate &&
      !state.amountInvolved &&
      !state.clientIdFolioNoDpid &&
      !state.reliefSought &&
      !state.priorContactProof;
  // M. Code-directive markers. The Conversation controller has already
    // decided these turns; the mock only renders the words.
    if (full.includes("[CONTACT_DENIED]")) {
      return {
        reply: pick(BANK.offer_email, det, this.bump("offer_email")),
        updates: { priorContactProof: "none" },
        phase,
        action: "none",
      };
    }
    if (full.includes("[EXPECTING_EMAIL_DATE]")) {
      return {
        reply: pick(BANK.ask_email_date, det, this.bump("ask_email_date")),
        updates: {},
        phase,
        action: "none",
      };
    }
    if (full.includes("[EMAIL_DATE_RECORDED]")) {
      return {
        reply: pick(BANK.ask_proof, det, this.bump("ask_proof")),
        updates: {},
        phase,
        action: "none",
      };
    }
    if (full.includes("[PROOF_RECORDED]") || full.includes("[PROOF_DECLINED]")) {
      return {
        reply: pick(BANK.proof_ack, det, this.bump("proof_ack")),
        updates: {},
        phase,
        action: "none",
      };
    }
    if (full.includes("[EXPECTING_PROOF]")) {
      return {
        reply:
          pick(BANK.ask_proof, det, this.bump("ask_proof") + 1) ||
          "Any ticket or reference number for it?",
        updates: {},
        phase,
        action: "none",
      };
    }
    if (full.includes("[PROOF_SCREENSHOT]")) {
      return {
        reply:
          pick(BANK.proof_screenshot, det, this.bump("proof_screenshot")) ||
          "Great — you can attach it in the review tab later. Anything else to add?",
        updates: {},
        phase,
        action: "none",
      };
    }
    const contra = /UNRESOLVED CONTRADICTION on (\w+): recorded "([^"]*)" but the user also said "([^"]*)"/.exec(full);
    if (contra) {
      return {
        reply: confirmText(det, contra[2] ?? "", contra[3] ?? ""),
        updates: {},
        phase,
        action: "none",
      };
    }
    const draftField =
      /\[DRAFT_FIELD_RETRY:(\w+)\]/.exec(full)?.[1] ?? /\[DRAFT_FIELD:(\w+)\]/.exec(full)?.[1];
    const draftByLang = draftField ? DRAFT_FIELD_BANK[draftField] : undefined;
    if (draftField && draftByLang) {
      return {
        reply: pick(draftByLang, det, this.bump(`draft_field:${draftField}`)),
        updates: {},
        phase,
        action: "none",
      };
    }
    if (full.includes("[DRAFT_READY]")) {
      return {
        reply: pick(DRAFT_FIELD_BANK.ready!, det, this.bump("draft_ready")),
        updates: {},
        phase,
        action: "none",
      };
    }

    // 1. Greeting and small talk: greet, explain, invite. Never collect data here.
    if (isSmallTalk(bare) && !state.issueSummaryEnglish) {
      return { reply: pick(BANK.greet, det, this.bump("greet")), updates: {}, phase: "INTAKE", action: "none" };
    }

    // 1b. Bare denial while contact is the open question: they have NOT written.
    if (BARE_DENIAL.test(bare) && phase === "PREFLIGHT_EMAIL") {
      return {
        reply: pick(BANK.offer_email, det, this.bump("offer_email")),
        updates: { priorContactProof: "none" },
        phase,
        action: "none",
      };
    }

    // 1c. Explicit denial anywhere: the safe direction applies at once.
    if (EXPLICIT_DENIAL.test(bare)) {
      return {
        reply: pick(BANK.offer_email, det, this.bump("offer_email")),
        updates: { priorContactProof: "none" },
        phase,
        action: "none",
      };
    }

    // 1d. Agreement to the email, via the shared rule (explicit phrasing,
    // or an affirmation like "Yes sure" right after the offer). Never when
    // the message is really a sent-claim, and never as the very first turn.
    // mockEmpty mirrors the controller's nothingCaptured gate.
    // priorAssistant/mockEmpty are computed at the top of composeReply.
    if (isAgreementToDraft(bare, priorAssistant, mockEmpty) && phase !== "GREETING") {
      return {
        reply: pick(BANK.agree_email, det, this.bump("agree_email")),
        updates: {},
        phase,
        action: "draft_email",
      };
    }

    // 2. Answer a question the user asked before moving on.
    if (/\bwhat (is|are) (sebi )?scores\b|\bwhat.*scores\b|\bscores kya\b/i.test(bare)) {
      return {
        reply: pick(BANK.explain_scores, det, this.bump("explain_scores")),
        updates: {},
        phase,
        action: "none",
      };
    }
    if (/(why|first).*(email|contact|write|complain).*(broker|company|first)|why should i (email|contact)/i.test(bare)) {
      return {
        reply: pick(BANK.explain_prereq, det, this.bump("explain_prereq")),
        updates: {},
        phase,
        action: "draft_email",
      };
    }

    // 3. Pull everything we can out of this message.
    const got = extract(bare);
    const conf = confidenceOf(bare, got);
    const updates: Record<string, unknown> = {};
    // Item 5: inferred category/entityType enter state only at >= 0.6
    // confidence; anything weaker stays missing and gets an open question.
    const CONFIDENT = 0.6;
    if (got.clientIdFolioNoDpid) updates.clientIdFolioNoDpid = got.clientIdFolioNoDpid;
    if (got.amountInvolved) updates.amountInvolved = got.amountInvolved;
    if (got.incidentDate) updates.incidentDate = got.incidentDate;
    if (got.entityName) updates.entityName = got.entityName;
    if (got.category && (conf.complaintCategory ?? 0) >= CONFIDENT) {
      updates.complaintCategory = got.category;
    }
    if (got.entityType && (conf.entityType ?? 0) >= CONFIDENT) {
      updates.entityType = got.entityType;
    }
    if (got.relief) updates.reliefSought = got.relief;

    // Contact claim without a date: record the claim, ask the date.
    // (A date in the message is extracted above and handled with proof next.)
    if (CONTACT_CLAIM.test(bare) && !got.incidentDate && !updates.priorContactDate) {
      const contactDate = findDateIn(bare);
      if (contactDate) {
        updates.priorContactDate = contactDate;
        updates.priorContactProof = "emailed";
      } else {
        updates.priorContactProof = "emailed";
        return {
          reply: pick(BANK.ask_email_date, det, this.bump("ask_email_date")),
          updates,
          phase,
          action: "none",
          confidence: conf,
        };
      }
    }

    // Contact-status messages carry no complaint facts on their own: when
    // they contain nothing else extractable, never file them as the issue.
    const contactMeta =
      EXPLICIT_DENIAL.test(bare) || EMAIL_AGREEMENT.test(bare) || CONTACT_CLAIM.test(bare);
    const hasFacts =
      got.entityName ||
      got.amountInvolved ||
      got.incidentDate ||
      got.category ||
      got.clientIdFolioNoDpid;

    // A short reply that extracted something is a correction, not a new story.
    const isCorrection = CORRECTION.test(bare);
    if (!isCorrection && bare.length > 14 && !state.issueSummaryEnglish && !(contactMeta && !hasFacts)) {
      updates.issueSummaryOriginal = bare;
      updates.issueSummaryEnglish = englishGloss(bare, got);
    }

    // 4. User says they cannot provide something. Explain it, then move on.
    if (DECLINE.test(bare)) {
      const guidance = CLIENT_ID_MENTION.test(bare)
        ? pick(BANK.ask_ucc, det, this.bump("ask_ucc"))
        : "";
      return {
        reply: guidance || `${ackFor(det)} I'll carry on without it.`,
        updates: {},
        phase,
        action: "none",
      };
    }

    // 5. A correction gets a short acknowledgement and no new question.
    if (isCorrection && Object.keys(updates).length > 0) {
      return { reply: ackFor(det), updates, phase: "INTAKE", action: "none" };
    }

    // 6. Otherwise ask about the single most important missing thing.
    // Skipped fields (asked twice, never answered) are never asked again.
    const merged = { ...state, ...updates } as GrievanceState;
    const skipped = new Set(
      Array.isArray((state as unknown as Record<string, unknown>).skippedFields)
        ? ((state as unknown as Record<string, unknown>).skippedFields as string[])
        : [],
    );
    const ask = QUESTION_ORDER.find((a) => !skipped.has(a.field) && isMissing(merged, a.field));
    if (ask) {
      const question = pick(BANK[ask.key], det, this.bump(ask.key));
      // Item 3: new facts get a short acknowledgement clause before the ask.
      const ack = Object.keys(updates).length > 0 ? `${ackFor(det)} ` : "";
      const reply = ack + question;
      // Acceptance test 8: never the same wording twice in a row.
      return { reply: dedupe(reply, this.bump(`${ask.key}#vary`)), updates, phase: "INTAKE", action: "none", confidence: conf };
    }

    if (phase === "PREFLIGHT_EMAIL" && state.priorContactDate) {
      return {
        reply: pick(BANK.wait_notice, det, this.bump("wait_notice")),
        updates,
        phase: "PREFLIGHT_EMAIL",
        action: "none",
      };
    }
    if (phase === "CONFIRM") {
      return {
        reply: pick(BANK.confirm_summary, det, this.bump("confirm_summary")),
        updates,
        phase: "CONFIRM",
        action: "show_summary",
      };
    }
    if (phase === "GREETING") {
      return { reply: pick(BANK.greet, det, this.bump("greet")), updates, phase: "INTAKE", action: "none" };
    }
    return {
      reply: pick(BANK.email_sent, det, this.bump("email_sent")) || "Anything else to add?",
      updates,
      phase,
      action: "none",
    };
  }

  private bump(k: string): number {
    const n = this.useCount.get(k) ?? 0;
    this.useCount.set(k, n + 1);
    return n;
  }
}

/**
 * Vary the lead-in so a repeated question never reads identically.
 * Only touches short conversational replies, not explanations or summaries.
 */
function dedupe(text: string, n: number): string {
  if (n < 2 || text.length > 150) return text;
  const leads = ["One more thing. ", "Sorry to ask again. ", "Back to this one. ", "Quick check. "];
  if (leads.some((l) => text.startsWith(l))) return text;
  return leads[n % leads.length]! + text;
}

function isMissing(state: GrievanceState, field: string): boolean {
  const v = (state as unknown as Record<string, unknown>)[field];
  return v === null || v === undefined || String(v).trim() === "";
}

/** Reads the known/missing lists the turn runner embeds in the instructions. */
function parseKnownFromInstructions(instructions: string): GrievanceState {
  // Anchor on the FIRST "ALREADY KNOWN" (the list header): the rules prose
  // further down mentions the phrase again, so last-occurrence anchoring
  // would land past the lists entirely.
  // The missing block additionally ends at EMAIL FLOW so its "- " lines
  // (which are prose, not fields) can never become phantom entries.
  const knownStart = instructions.indexOf("ALREADY KNOWN");
  const missingStart = instructions.indexOf("STILL MISSING", knownStart);
  const flowStart = instructions.indexOf("EMAIL FLOW", missingStart);
  const endStart = instructions.indexOf("ESCALATION", missingStart);
  const known =
    knownStart === -1 || missingStart === -1 ? "" : instructions.slice(knownStart, missingStart);
  // EMAIL FLOW precedes ESCALATION; bound there so its prose lines stay out.
  const flowEnd = flowStart !== -1 ? flowStart : endStart;
  const missing =
    missingStart === -1 || flowEnd === -1 ? "" : instructions.slice(missingStart, flowEnd);
  const s: Record<string, unknown> = {};

  const alias: Record<string, string> = {
    issueSummary: "issueSummaryEnglish",
    entityName: "entityName",
    entityType: "entityType",
    clientIdFolioNoDpid: "clientIdFolioNoDpid",
    incidentDate: "incidentDate",
    amountInvolved: "amountInvolved",
    reliefSought: "reliefSought",
    complaintCategory: "complaintCategory",
  };

  for (const line of known.split("\n")) {
    const m = line.match(/^\s*-\s*([^:]+):\s*(.+)$/);
    if (!m) continue;
    const key = m[1]!.trim();
    const value = m[2]!.trim();
    if (key === "priorContact") {
      if (/rejected/i.test(value)) s.priorContactProof = "rejected";
      else if (/NOT contacted/i.test(value)) s.priorContactProof = "none";
      else if (/Emailed/i.test(value)) {
        s.priorContactProof = "emailed";
        const d = value.match(/(\d{4}-\d{2}-\d{2})/);
        if (d) s.priorContactDate = d[1];
      }
      continue;
    }
    if (key === "skippedFields") {
      s.skippedFields = value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      continue;
    }
    s[alias[key] ?? key] = value;
  }

  const missList = missing
    .split("\n")
    .map((l) => l.match(/^\s*-\s*(.+)$/)?.[1]?.trim())
    .filter(Boolean) as string[];

  for (const label of missList) {
    if (label === "(nothing required is missing)") continue;
    const key = alias[label] ?? label;
    if (key === "priorContact") {
      s.priorContactDate = null;
      s.priorContactProof = null;
    } else {
      s[key] = null;
    }
  }

  return s as unknown as GrievanceState;
}

function parsePhase(instructions: string): string {
  return instructions.match(/CURRENT PHASE:\s*(\w+)/)?.[1] ?? "INTAKE";
}

/** Simple gloss. The live model produces both summaries properly in one call. */
function englishGloss(text: string, got: Extracted): string {
  const who = got.entityName ?? "the broker/company";
  const money = got.amountInvolved ? `INR ${got.amountInvolved.toLocaleString("en-IN")} ` : "";
  const when = got.incidentDate ? `, on or around ${got.incidentDate}` : "";
  return (
    `Investor complaint regarding ${money}against ${who}${when}. ` +
    `The investor's own description: "${text}"`
  );
}