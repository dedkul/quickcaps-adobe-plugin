/*
 * QCLangs — the spoken languages Sarvam's Saaras v4 understands (22 Indian
 * languages + English), and how the caption-script choices are named for
 * each one. Host-agnostic.
 *
 * Script keys stay the same for every language so saved settings and
 * drafts keep working: 'hi' = the language's own script (the key predates
 * other languages), 'rom' = Roman letters, 'mix' = own script with English
 * words left in English, 'en' = English translation.
 */
window.QCLangs = (function () {
  // `top`: shown first in the menu. `rom`: a friendlier name for Roman
  // text where people have one. `sample`: preview lines per script key.
  const LIST = [
    { code: "hi-IN", name: "Hindi", native: "हिंदी", rom: "Hinglish", top: true,
      sample: {
        hi: "नमस्ते दोस्तों, आज हम बात करेंगे एक ऐसे टूल के बारे में जो आपका घंटों का काम मिनटों में कर देगा। चलिए शुरू करते हैं।",
        rom: "namaste doston, aaj hum baat karenge ek aise tool ke baare mein jo aapka ghanton ka kaam minton mein kar dega. chaliye shuru karte hain.",
        mix: "नमस्ते दोस्तों, आज हम बात करेंगे एक ऐसे tool के बारे में जो आपका घंटों का काम minutes में कर देगा। चलिए start करते हैं।",
      } },
    { code: "mr-IN", name: "Marathi", native: "मराठी", top: true,
      sample: { hi: "नमस्कार मित्रांनो, आज आपण बोलणार आहोत", rom: "namaskar mitranno, aaj aapan bolnar aahot", mix: "नमस्कार friends, आज आपण बोलणार आहोत" } },
    { code: "bn-IN", name: "Bengali", native: "বাংলা", top: true,
      sample: { hi: "নমস্কার বন্ধুরা, আজ আমরা কথা বলব", rom: "nomoskar bondhura, aaj amra kotha bolbo", mix: "নমস্কার friends, আজ আমরা কথা বলব" } },
    { code: "gu-IN", name: "Gujarati", native: "ગુજરાતી", top: true,
      sample: { hi: "નમસ્તે મિત્રો, આજે આપણે વાત કરીશું", rom: "namaste mitro, aaje aapne vaat karishu", mix: "નમસ્તે friends, આજે આપણે વાત કરીશું" } },
    { code: "ta-IN", name: "Tamil", native: "தமிழ்", rom: "Tanglish", top: true,
      sample: { hi: "வணக்கம் நண்பர்களே, இன்று நாம் பேசப் போகிறோம்", rom: "vanakkam nanbargale, indru naam pesa pogirom", mix: "வணக்கம் friends, இன்று நாம் பேசப் போகிறோம்" } },
    { code: "te-IN", name: "Telugu", native: "తెలుగు", top: true,
      sample: { hi: "నమస్కారం మిత్రులారా, ఈ రోజు మనం మాట్లాడుకుందాం", rom: "namaskaram mitrulara, ee roju manam maatladukundaam", mix: "నమస్కారం friends, ఈ రోజు మనం మాట్లాడుకుందాం" } },
    { code: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ", top: true,
      sample: { hi: "ನಮಸ್ಕಾರ ಸ್ನೇಹಿತರೇ, ಇಂದು ನಾವು ಮಾತನಾಡೋಣ", rom: "namaskara snehitare, indu naavu maatanaadona", mix: "ನಮಸ್ಕಾರ friends, ಇಂದು ನಾವು ಮಾತನಾಡೋಣ" } },
    { code: "ml-IN", name: "Malayalam", native: "മലയാളം", top: true,
      sample: { hi: "നമസ്കാരം സുഹൃത്തുക്കളേ, ഇന്ന് നമ്മൾ സംസാരിക്കാം", rom: "namaskaram suhruthukkale, innu nammal samsaarikkaam", mix: "നമസ്കാരം friends, ഇന്ന് നമ്മൾ സംസാരിക്കാം" } },
    { code: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ", top: true,
      sample: { hi: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਦੋਸਤੋ, ਅੱਜ ਅਸੀਂ ਗੱਲ ਕਰਾਂਗੇ", rom: "sat sri akal dosto, ajj asi gall karange", mix: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ friends, ਅੱਜ ਅਸੀਂ ਗੱਲ ਕਰਾਂਗੇ" } },
    { code: "od-IN", name: "Odia", native: "ଓଡ଼ିଆ", top: true },
    { code: "en-IN", name: "English", native: "English", top: true, english: true },
    { code: "as-IN", name: "Assamese", native: "অসমীয়া" },
    { code: "ur-IN", name: "Urdu", native: "اردو" },
    { code: "ne-IN", name: "Nepali", native: "नेपाली" },
    { code: "kok-IN", name: "Konkani", native: "कोंकणी" },
    { code: "ks-IN", name: "Kashmiri", native: "کٲشُر" },
    { code: "sd-IN", name: "Sindhi", native: "سنڌي" },
    { code: "sa-IN", name: "Sanskrit", native: "संस्कृतम्" },
    { code: "sat-IN", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ" },
    { code: "mni-IN", name: "Manipuri", native: "মৈতৈলোন্" },
    { code: "brx-IN", name: "Bodo", native: "बड़ो" },
    { code: "mai-IN", name: "Maithili", native: "मैथिली" },
    { code: "doi-IN", name: "Dogri", native: "डोगरी" },
  ];

  const AUTO = { code: "unknown", name: "Detect automatically", native: "", auto: true };
  const ENGLISH_SAMPLE = "Hello friends, today we'll talk about a tool that turns hours of work into minutes. Let's get started.";

  function get(code) {
    if (code === AUTO.code) return AUTO;
    for (let i = 0; i < LIST.length; i++) if (LIST[i].code === code) return LIST[i];
    return null;
  }

  function isKnown(code) {
    return !!get(code);
  }

  // English audio has one sensible output: English, as spoken.
  function effectiveScript(code, script) {
    const l = get(code);
    return l && l.english ? "en" : script;
  }

  // Caption script -> Sarvam speech-to-text mode. All are the same
  // per-second price; Roman uses "translit" (Roman output straight from
  // speech) rather than the separately billed transliteration service.
  // English audio is simply transcribed.
  const MODES = { hi: "transcribe", rom: "translit", mix: "codemix", en: "translate" };
  function modeFor(code, script) {
    const l = get(code);
    if (l && l.english) return "transcribe";
    return MODES[script] || "transcribe";
  }

  // The four script buttons for a language: [{key, title, sub}]. English
  // audio gets just one.
  function scriptOptions(code) {
    const l = get(code) || LIST[0];
    if (l.english) return [{ key: "en", title: "English", sub: "As spoken" }];
    if (l.auto) {
      return [
        { key: "hi", title: "Original", sub: "As spoken" },
        { key: "rom", title: "Roman", sub: "English letters" },
        { key: "mix", title: "Mixed", sub: "+ English" },
        { key: "en", title: "English", sub: "Translated" },
      ];
    }
    return [
      { key: "hi", title: l.native, sub: l.name },
      { key: "rom", title: l.rom || "Roman", sub: l.rom ? "Roman letters" : "English letters" },
      { key: "mix", title: "Mixed", sub: l.native + " + English" },
      { key: "en", title: "English", sub: "Translated" },
    ];
  }

  // Short name of a caption script, e.g. for "<name> track" on review.
  function scriptName(code, script) {
    const s = effectiveScript(code, script);
    const opts = scriptOptions(code);
    for (let i = 0; i < opts.length; i++) if (opts[i].key === s) return opts[i].title;
    return { hi: "Original", rom: "Roman", mix: "Mixed", en: "English" }[s] || "Main";
  }

  // One line under the script buttons saying what the choice produces.
  function scriptHint(code, script) {
    const l = get(code) || LIST[0];
    if (l.english) return "English audio gets English captions.";
    if (l.auto) return "Sarvam works out the language. Pick it yourself for the best results.";
    return {
      hi: "Written in " + l.name + " script, the way it's spoken.",
      rom: (l.rom || "Roman") + ": " + l.name + " typed in English letters.",
      mix: l.name + " in its own script, English words left in English.",
      en: "English subtitles, translated from " + l.name + ".",
    }[script] || "";
  }

  // Preview sentence for the live caption preview.
  function sample(code, script) {
    const l = get(code) || LIST[0];
    const s = effectiveScript(code, script);
    if (s === "en") return ENGLISH_SAMPLE;
    if (l.sample && l.sample[s]) return l.sample[s];
    if (l.auto) return s === "rom" ? "Captions appear in the language Sarvam hears, in English letters." : "Captions appear in the language Sarvam hears.";
    if (s === "rom") return "Sample: " + l.name + " captions in English letters.";
    return "Sample: " + l.name + " captions in " + l.native;
  }

  return {
    LIST: LIST,
    AUTO: AUTO,
    get: get,
    isKnown: isKnown,
    effectiveScript: effectiveScript,
    modeFor: modeFor,
    scriptOptions: scriptOptions,
    scriptName: scriptName,
    scriptHint: scriptHint,
    sample: sample,
  };
})();
