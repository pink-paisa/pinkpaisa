const PUBLISHABLE_FIELD_RULES = Object.freeze({
  hooks: { maxLength: 180, prose: false },
  hookOptions: { maxLength: 180, prose: false },
  caption: { maxLength: 2200, prose: true },
  cta: { maxLength: 180, prose: false },
  hashtags: { maxLength: 60, prose: false },
  altText: { maxLength: 500, prose: true },
  financialDisclaimer: { maxLength: 500, prose: true },
  affiliateDisclosure: { maxLength: 500, prose: true },
  selectedHeadline: { maxLength: 80, prose: false },
  supportingCopy: { maxLength: 160, prose: true },
  supportingText: { maxLength: 160, prose: true },
  interactionCopy: { maxLength: 160, prose: true },
  headline: { maxLength: 80, prose: false },
  body: { maxLength: 160, prose: true },
  coverHeadline: { maxLength: 80, prose: false },
  voiceover: { maxLength: 700, prose: true },
  onScreenText: { maxLength: 80, prose: false },
  copy: { maxLength: 160, prose: true },
  interactionPrompt: { maxLength: 300, prose: false },
});

const LETTER = /\p{Letter}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_MODIFIER = /\p{Emoji_Modifier}/u;
const UNSAFE_DEFAULT_IGNORABLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/u;
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;
const DANGLING_FINAL_WORD = /\b(?:a|an|the|and|or|but|because|so|to|of|for|with|without|from|into|on|in|at|by|your|our|this|that|these|those|if|when|while|as|than|which|who|where|how|is|are|was|were|be|been|being|can|could|would|should|will|may|might|must|not)\s*$/iu;
const INCOMPLETE_TRAILING_PUNCTUATION = /[-,;:\/\\\u2013\u2014]\s*$/u;
const SENTENCE_TERMINATOR = /[.!?\u2026)\]}"'\u2019\u201D]\s*$/u;

function structuredOutputError(message, validationErrors) {
  const error = new Error(message);
  error.code = "structured_output_invalid";
  error.validation_errors = validationErrors;
  error.transient = true;
  return error;
}

function codePointLabel(character) {
  return `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function isEmojiComponent(character) {
  return EXTENDED_PICTOGRAPHIC.test(character) || EMOJI_MODIFIER.test(character);
}

function isAllowedEmojiIgnorable(characters, index) {
  const character = characters[index];
  const codePoint = character.codePointAt(0);
  const previous = characters[index - 1] || "";
  const previousPrevious = characters[index - 2] || "";
  const next = characters[index + 1] || "";
  if (codePoint === 0x200D) {
    return (isEmojiComponent(previous) || isEmojiComponent(previousPrevious))
      && EXTENDED_PICTOGRAPHIC.test(next);
  }
  if (codePoint === 0xFE0E || codePoint === 0xFE0F) {
    return EXTENDED_PICTOGRAPHIC.test(previous) || /^[#*0-9]$/u.test(previous);
  }
  return false;
}

function unicodeIntegrityErrors(text, path) {
  const errors = [];
  const characters = Array.from(text);
  if (UNPAIRED_SURROGATE.test(text)) {
    errors.push(`${path} contains an unpaired Unicode surrogate`);
  }
  characters.forEach((character, index) => {
    if (LETTER.test(character) && !LATIN_LETTER.test(character)) {
      errors.push(`${path} contains unexpected non-Latin script character ${codePointLabel(character)}`);
    }
    if (UNSAFE_DEFAULT_IGNORABLE.test(character)
      && !isAllowedEmojiIgnorable(characters, index)) {
      errors.push(`${path} contains disallowed default-ignorable Unicode ${codePointLabel(character)}`);
    }
    if (character === "\uFFFD") {
      errors.push(`${path} contains the Unicode replacement character U+FFFD`);
    }
  });
  return errors;
}

function delimitersAreBalanced(text) {
  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
  return pairs.every(([opening, closing]) => (
    text.split(opening).length - 1 === text.split(closing).length - 1
  ));
}

function nearLimitTruncationErrors(text, path, rule) {
  const maximum = Number(rule.maxLength || 0);
  const nearLimitThreshold = maximum - Math.max(2, Math.ceil(maximum * 0.05));
  if (!maximum || text.length < nearLimitThreshold) return [];
  const trimmed = text.trim();
  const errors = [];
  if (DANGLING_FINAL_WORD.test(trimmed)) {
    errors.push(`${path} appears semantically incomplete near its ${maximum}-character limit (dangling final word)`);
  }
  if (INCOMPLETE_TRAILING_PUNCTUATION.test(trimmed)) {
    errors.push(`${path} appears semantically incomplete near its ${maximum}-character limit (unfinished punctuation)`);
  }
  if (!delimitersAreBalanced(trimmed)) {
    errors.push(`${path} appears semantically incomplete near its ${maximum}-character limit (unclosed delimiter)`);
  }
  if (rule.prose && text.length >= maximum - 1 && !SENTENCE_TERMINATOR.test(trimmed)) {
    errors.push(`${path} reaches its character limit without a complete sentence ending; rewrite it rather than truncating`);
  }
  return errors;
}

function inspectPublishableValue(value, key, path, errors) {
  const rule = PUBLISHABLE_FIELD_RULES[key];
  if (!rule) return;
  const values = Array.isArray(value) ? value : [value];
  values.forEach((entry, index) => {
    if (entry == null || typeof entry !== "string") return;
    const entryPath = Array.isArray(value) ? `${path}[${index}]` : path;
    errors.push(...unicodeIntegrityErrors(entry, entryPath));
    errors.push(...nearLimitTruncationErrors(entry, entryPath, rule));
  });
}

function collectPublishableIntegrityErrors(value, path = "$", errors = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return errors;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectPublishableIntegrityErrors(entry, `${path}[${index}]`, errors, seen));
    return errors;
  }
  Object.entries(value).forEach(([key, entry]) => {
    const entryPath = `${path}.${key}`;
    inspectPublishableValue(entry, key, entryPath, errors);
    if (!PUBLISHABLE_FIELD_RULES[key] || (entry && typeof entry === "object")) {
      collectPublishableIntegrityErrors(entry, entryPath, errors, seen);
    }
  });
  return errors;
}

function validatePublishableCopyIntegrity(value) {
  const errors = [...new Set(collectPublishableIntegrityErrors(value))];
  if (errors.length) {
    throw structuredOutputError(
      `Publishable copy integrity validation failed: ${errors.slice(0, 12).join("; ")}`,
      errors,
    );
  }
  return value;
}

module.exports = {
  validatePublishableCopyIntegrity,
  _private: {
    collectPublishableIntegrityErrors,
    nearLimitTruncationErrors,
    unicodeIntegrityErrors,
  },
};
