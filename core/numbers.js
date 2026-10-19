/*
 * QCNumbers — "Numbers as digits": turns spoken number words into digits
 * with Indian grouping (4,500 and 1,50,000), locally, at no Sarvam cost.
 *
 * Understands English everywhere, and Hindi in Devanagari and in Roman
 * letters (Hinglish) when the spoken language is Hindi or auto-detect.
 * Other languages keep Sarvam's own output for now.
 *
 * Deliberately conservative, because a wrong number in a caption is worse
 * than a number left as words:
 * - a lone small number (one to ten) stays a word: "दो" also means "give",
 *   and "ek baat" reads better than "1 baat";
 * - a scale word needs a number in front ("सौ बात की एक बात" is left alone);
 * - crore, million and billion stay words ("500 करोड़", not 12 digits);
 * - "साढ़े चार" on its own (half past four) is left alone.
 */
window.QCNumbers = (function () {
  const nfc = function (s) { return typeof s.normalize === "function" ? s.normalize("NFC") : s; };

  // Hindi 1–99 are irregular, so they're listed. "|" separates spellings.
  const HI = [
    "", "एक", "दो", "तीन", "चार", "पांच|पाँच", "छह|छः|छे|छ", "सात", "आठ", "नौ", "दस",
    "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह|पन्द्रह", "सोलह", "सत्रह", "अठारह|अट्ठारह", "उन्नीस", "बीस",
    "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस|अठाईस", "उनतीस|उन्तीस", "तीस",
    "इकतीस|इकत्तीस", "बत्तीस", "तैंतीस|तेंतीस", "चौंतीस|चौतीस", "पैंतीस|पेंतीस", "छत्तीस", "सैंतीस|सेंतीस", "अड़तीस", "उनतालीस|उनचालीस", "चालीस",
    "इकतालीस", "बयालीस", "तैंतालीस|तेंतालीस", "चवालीस|चौवालीस", "पैंतालीस|पेंतालीस", "छियालीस", "सैंतालीस|सेंतालीस", "अड़तालीस", "उनचास", "पचास",
    "इक्यावन", "बावन", "तिरेपन|तिरपन", "चौवन|चव्वन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ", "साठ",
    "इकसठ", "बासठ", "तिरेसठ|तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ|सरसठ", "अड़सठ", "उनहत्तर", "सत्तर",
    "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी|उनासी", "अस्सी",
    "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी", "नब्बे",
    "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे|निन्यानबे",
  ];
  // Hinglish spellings vary; these are the common ones. "saath" (60) is
  // left out on purpose: it also means "with".
  const HI_ROM = [
    "", "ek", "do", "teen|tin", "char|chaar", "paanch|panch", "chhe|chhah|chah|che", "saat|sat", "aath|ath", "nau", "das",
    "gyarah|gyaarah|gyara", "barah|baarah|bara", "terah|tera", "chaudah|chauda", "pandrah|pandra", "solah|sola", "satrah|satra", "atharah|athaarah|athara", "unnees|unnis", "bees|bis",
    "ikkees|ikkis", "baees|bais|baais", "teis|teyis|teees", "chaubees|chaubis", "pachees|pachchees|pachis|pachchis", "chhabbees|chhabbis", "sattaees|sattais", "atthaees|atthais", "untees|untis", "tees|tis",
    "iktees|ikattis|iktis", "battees|battis", "taintees|taintis", "chauntees|chontis|chauntis", "paintees|paintis", "chhattees|chhattis", "saintees|saintis", "adtees|adtis|artis", "untaalees|untalis|unchalis", "chaalees|chalees|chalis",
    "iktaalees|iktalis", "bayaalees|bayalis", "taintaalees|taintalis", "chavaalees|chawalis|chauvalis", "paintaalees|paintalis", "chhiyaalees|chhiyalis", "saintaalees|saintalis", "adtaalees|adtalis", "unchaas|unchas", "pachaas|pachas",
    "ikyaavan|ikyavan", "baavan|bavan|bawan", "tirepan|tirpan", "chauvan|chauwan|chauvvan", "pachpan", "chhappan", "sattaavan|sattavan", "atthaavan|atthavan", "unsath", "",
    "iksath", "baasath|basath", "tiresath|tirsath", "chaunsath|chausath", "painsath|pensath", "chhiyaasath|chhiyasath", "sadsath|sarsath", "adsath|arsath", "unhattar", "sattar",
    "ikhattar|ikahattar", "bahattar", "tihattar", "chauhattar", "pachhattar|pachattar", "chhihattar", "sathattar|satattar", "athhattar|athattar", "unyaasi|unasi|unaasi", "assi|assee",
    "ikyaasi|ikyasi", "bayaasi|bayasi", "tiraasi|tirasi", "chauraasi|chaurasi", "pachaasi|pachasi", "chhiyaasi|chhiyasi", "sattaasi|sattasi", "atthaasi|atthasi", "navaasi|navasi|nawasi", "nabbe",
    "ikyaanve|ikyanve", "baanve|banve", "tiraanve|tiranve", "chauraanve|chauranve", "pachaanve|pachanve", "chhiyaanve|chhiyanve", "sattaanve|sattanve", "atthaanve|atthanve", "ninyaanve|ninyanve",
  ];
  const EN_UNITS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  // kind: unit (a number word), tens (English twenty…ninety, may take a
  // unit after it), hundred, big (thousand / lakh), scale (kept as a
  // word), frac (डेढ़ = 1.5, needs a scale), mod (साढ़े: +0.5 to the next
  // number, needs a scale), and (English "and" inside a number).
  function buildTable(withHindi) {
    const t = {};
    const add = function (spellings, entry) {
      spellings.split("|").forEach(function (s) { if (s) t[nfc(s)] = entry; });
    };
    EN_UNITS.forEach(function (w, i) { if (w) add(w, { kind: "unit", v: i, en: true }); });
    EN_TENS.forEach(function (w, i) { if (w) add(w, { kind: "tens", v: i * 10, en: true }); });
    add("hundred", { kind: "hundred", v: 100 });
    add("thousand", { kind: "big", v: 1000 });
    add("lakh|lakhs|lac|lacs", { kind: "big", v: 100000 });
    add("crore|crores", { kind: "scale" });
    add("million|billion", { kind: "scale" });
    add("and", { kind: "and" });
    if (withHindi) {
      HI.forEach(function (w, i) { if (w) add(w, { kind: "unit", v: i }); });
      HI_ROM.forEach(function (w, i) { if (w) add(w, { kind: "unit", v: i }); });
      add("सौ|sau", { kind: "hundred", v: 100 });
      add("हज़ार|हजार|hazaar|hazar|hajar|hajaar", { kind: "big", v: 1000 });
      add("लाख|laakh", { kind: "big", v: 100000 });
      add("करोड़|करोड|karod|karor|karodh", { kind: "scale" });
      add("डेढ़|डेढ|dedh|derh|dedd", { kind: "frac", v: 1.5 });
      add("ढाई|dhai|dhaai", { kind: "frac", v: 2.5 });
      add("साढ़े|साढे|saadhe|sadhe|saade|sade", { kind: "mod", v: 0.5 });
      add("सवा|sava|sawa", { kind: "mod", v: 0.25 });
      add("पौने|paune|pone", { kind: "mod", v: -0.25 });
    }
    return t;
  }
  const TABLES = { en: buildTable(false), hi: buildTable(true) };

  function tableFor(lang) {
    return lang === "hi-IN" || lang === "unknown" ? TABLES.hi : TABLES.en;
  }

  // 150000 -> "1,50,000"
  function groupIndian(n) {
    const s = String(Math.round(Math.abs(n)));
    const sign = n < 0 ? "-" : "";
    if (s.length <= 3) return sign + s;
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    return sign + rest + "," + last3;
  }

  const LEAD = /^[^\p{L}\p{N}]+/u;
  const TRAIL = /[^\p{L}\p{N}\p{M}]+$/u;
  const NUMERIC = /^\d[\d,]*(?:\.\d+)?$/;

  // A word -> { lead, trail, atoms } or null when it isn't a number word.
  function readWord(text, table) {
    const raw = nfc(String(text || ""));
    const lead = (raw.match(LEAD) || [""])[0];
    const rest = raw.slice(lead.length);
    const trail = (rest.match(TRAIL) || [""])[0];
    const core = rest.slice(0, rest.length - trail.length);
    if (!core) return null;
    if (NUMERIC.test(core)) {
      return { lead: lead, trail: trail, atoms: [{ kind: "num", v: parseFloat(core.replace(/,/g, "")) }] };
    }
    const parts = core.toLowerCase().split("-");
    const atoms = [];
    for (let i = 0; i < parts.length; i++) {
      const a = table[parts[i]];
      if (!a || (parts.length > 1 && a.kind !== "unit" && a.kind !== "tens")) return null;
      atoms.push(a);
    }
    return { lead: lead, trail: trail, atoms: atoms };
  }

  function freshState() {
    return {
      total: 0, group: 0, lastBig: Infinity,
      hasUnit: false, hasHundred: false, lastTens: false,
      mod: 0, hasMult: false, words: 0, nums: 0, hundredLead: 0,
    };
  }

  // Applies one atom; returns false when it can't continue the number.
  function apply(st, a) {
    switch (a.kind) {
      case "unit":
      case "frac":
      case "num":
        if (st.hasUnit) {
          // English "twenty five": a tens word may take one unit after it.
          if (!st.lastTens || a.kind !== "unit" || !a.en || a.v >= 10) return false;
          st.group += a.v;
          st.lastTens = false;
          return true;
        }
        st.group += a.v + st.mod;
        st.mod = 0;
        st.hasUnit = true;
        st.lastTens = false;
        if (a.kind === "num") st.nums++;
        else st.words++;
        return true;
      case "tens":
        if (st.hasUnit || st.mod) return false;
        st.group += a.v;
        st.hasUnit = true;
        st.lastTens = true;
        st.words++;
        return true;
      case "mod":
        if (st.hasUnit || st.mod) return false;
        st.mod = a.v;
        return true;
      case "hundred":
        if (st.hasHundred || !st.hasUnit || st.mod) return false;
        st.hundredLead = st.group;
        st.group *= 100;
        st.hasHundred = true;
        st.hasUnit = false;
        st.lastTens = false;
        st.hasMult = true;
        return true;
      case "big":
        if (a.v >= st.lastBig || !st.group || st.mod) return false;
        st.total += st.group * a.v;
        st.group = 0;
        st.lastBig = a.v;
        st.hasUnit = false;
        st.hasHundred = false;
        st.lastTens = false;
        st.hasMult = true;
        return true;
      default:
        return false;
    }
  }

  function clone(st) {
    return Object.assign({}, st);
  }

  // Longest number phrase starting at words[i] -> { end, text } or null.
  function readPhrase(words, i, table) {
    let st = freshState();
    let good = null; // last complete state: { end, st }
    let scaleNext = false;
    for (let j = i; j < words.length; j++) {
      const w = readWord(words[j].text, table);
      if (!w) break;
      if (j > i && w.lead) break;
      const first = w.atoms[0];
      if (first.kind === "scale") {
        scaleNext = !!good && good.end === j;
        break;
      }
      if (first.kind === "and") {
        // "two hundred and five": only inside a number, before more of it.
        const next = j + 1 < words.length ? readWord(words[j + 1].text, table) : null;
        if (!st.hasMult || st.hasUnit || !next || (next.atoms[0].kind !== "unit" && next.atoms[0].kind !== "tens")) break;
        continue;
      }
      const trial = clone(st);
      let ok = true;
      for (let k = 0; k < w.atoms.length && ok; k++) ok = apply(trial, w.atoms[k]);
      if (!ok) break;
      st = trial;
      if (!st.mod) good = { end: j + 1, st: clone(st), trail: w.trail };
      if (w.trail) break; // a comma or full stop ends the number
    }
    if (!good) return null;
    const s = good.st;
    const value = s.total + s.group;
    const lead = readWord(words[i].text, table).lead;
    const hasWords = s.words > 0;
    const qualifies = scaleNext ? hasWords || s.nums > 0 : s.hasMult || (hasWords && value >= 11);
    if (!qualifies) return null;
    if (!scaleNext && Math.round(value) !== value) return null; // "साढ़े चार" = 4:30
    if (!scaleNext && !hasWords && !s.hasMult) return null; // already digits
    let text;
    if (scaleNext) {
      text = String(Math.round(value * 100) / 100);
    } else if (isYear(s, value)) {
      text = String(value);
    } else {
      text = groupIndian(value);
    }
    return { end: good.end, text: lead + text + good.trail };
  }

  // "उन्नीस सौ सैंतालीस" -> 1947 and "two thousand twenty five" -> 2025
  // read as years, so no comma.
  function isYear(s, value) {
    if (s.lastBig === Infinity && s.hasMult && s.hundredLead >= 11 && value < 10000) return true;
    return s.lastBig === 1000 && s.total === 2000 && s.group > 0 && s.group < 100 && !s.hasHundred;
  }

  // words: [{text, start, end}] -> same shape, number phrases merged into
  // one word that spans the phrase's time.
  function wordsToDigits(words, lang) {
    const table = tableFor(lang);
    const out = [];
    for (let i = 0; i < words.length; ) {
      const p = readPhrase(words, i, table);
      if (p) {
        out.push({ text: p.text, start: words[i].start, end: words[p.end - 1].end });
        i = p.end;
      } else {
        out.push(words[i]);
        i++;
      }
    }
    return out;
  }

  // Convenience for plain text (tests, previews).
  function textToDigits(text, lang) {
    const words = String(text).split(/\s+/).filter(Boolean).map(function (t, i) {
      return { text: t, start: i, end: i + 1 };
    });
    return wordsToDigits(words, lang).map(function (w) { return w.text; }).join(" ");
  }

  // True when this language's own number words are understood.
  function coversLanguage(lang) {
    return lang === "hi-IN" || lang === "unknown" || lang === "en-IN";
  }

  return {
    wordsToDigits: wordsToDigits,
    textToDigits: textToDigits,
    groupIndian: groupIndian,
    coversLanguage: coversLanguage,
  };
})();
