const { isDeepStrictEqual } = require("node:util");

const CONTENT_WRAPPERS = new Set([
  "content",
  "formatcontent",
  "originalcontent",
  "revisedcontent",
]);
const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MALFORMED_PIPE_MARKER = /\|{3,}>/;
const DEPENDENT_PLACEMENT_PATHS = Object.freeze({
  selectedHeadline: "overlayInstructions.headlinePosition",
  coverHeadline: "overlayInstructions.headlinePosition",
});

function compactKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function structuredOutputError(message, validationErrors = []) {
  const error = new Error(message);
  error.code = "structured_output_invalid";
  error.validation_errors = validationErrors.length ? validationErrors : [message];
  error.transient = true;
  return error;
}

function pathTokens(rawPath) {
  let value = String(rawPath || "").trim();
  if (!value || value.length > 300) return [];
  if ((value.startsWith("`") && value.endsWith("`"))
    || (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  value = value
    .replace(/\[\s*["']([^"']+)["']\s*\]/g, ".$1")
    .replace(/\[\s*(\d+)\s*\]/g, ".$1")
    .replace(/^\$\.?/, "")
    .replace(/^\.+|\.+$/g, "");
  if (!value || /[^a-zA-Z0-9_$.-]/.test(value)) return [];
  return value.split(".").map((part) => part.trim()).filter(Boolean);
}

function normalizeContentPath(rawPath, originalContent) {
  let tokens = pathTokens(rawPath);
  if (!tokens.length || !originalContent || typeof originalContent !== "object") return null;
  const wrapperIndex = tokens.findIndex((token) => CONTENT_WRAPPERS.has(compactKey(token)));
  if (wrapperIndex >= 0) tokens = tokens.slice(wrapperIndex + 1);
  if (!tokens.length) return null;

  let cursor = originalContent;
  const normalized = [];
  for (const token of tokens) {
    if (Array.isArray(cursor)) {
      if (!/^\d+$/.test(token)) return null;
      const index = Number(token);
      if (index < 0 || index >= cursor.length) return null;
      normalized.push(String(index));
      cursor = cursor[index];
      continue;
    }
    if (!cursor || typeof cursor !== "object") return null;
    const matchingKey = Object.keys(cursor).find((key) => compactKey(key) === compactKey(token));
    if (!matchingKey) return null;
    normalized.push(matchingKey);
    cursor = cursor[matchingKey];
  }
  return normalized.join(".");
}

function extractExplicitRequiredChangePaths(requiredChanges, originalContent) {
  const normalized = new Set();
  for (const rawChange of Array.isArray(requiredChanges) ? requiredChanges : []) {
    const change = String(rawChange || "");
    const candidates = [];
    for (const match of change.matchAll(/`([^`]+)`/g)) candidates.push(match[1]);
    for (const match of change.matchAll(/(?:\$\.|format_content\.|formatContent\.|original_content\.|originalContent\.|revisedContent\.)[a-zA-Z0-9_$.[\]'"-]+/g)) {
      candidates.push(match[0].replace(/[.,;:]+$/, ""));
    }
    for (const match of change.matchAll(/(?:field(?:\s+path)?|path)\s*(?:is|=|:)\s*([$.a-zA-Z0-9_[\]'"-]+)/gi)) {
      candidates.push(match[1].replace(/[.,;:]+$/, ""));
    }
    for (const candidate of candidates) {
      const path = normalizeContentPath(candidate, originalContent);
      if (path) normalized.add(path);
    }
  }
  return [...normalized];
}

function revisionScope(complianceFeedback, originalContent) {
  const issues = (Array.isArray(complianceFeedback?.issues) ? complianceFeedback.issues : [])
    .filter((issue) => ["ERROR", "WARNING"].includes(String(issue?.severity || "").toUpperCase()));
  if (!issues.length) return { restricted: false, allowedPaths: [] };
  const issuePaths = issues.map((issue) => normalizeContentPath(issue?.fieldPath, originalContent));
  if (issuePaths.some((path) => !path)) return { restricted: false, allowedPaths: [] };
  const allowedPaths = new Set([
    ...issuePaths,
    ...extractExplicitRequiredChangePaths(complianceFeedback?.requiredChanges, originalContent),
  ]);
  for (const allowedPath of [...allowedPaths]) {
    const dependentPath = DEPENDENT_PLACEMENT_PATHS[allowedPath];
    if (!dependentPath) continue;
    const normalizedDependentPath = normalizeContentPath(dependentPath, originalContent);
    if (normalizedDependentPath) allowedPaths.add(normalizedDependentPath);
  }
  return { restricted: true, allowedPaths: [...allowedPaths] };
}

function changedLeafPaths(before, after, prefix = "") {
  if (isDeepStrictEqual(before, after)) return [];
  const beforeObject = before !== null && typeof before === "object";
  const afterObject = after !== null && typeof after === "object";
  if (!beforeObject || !afterObject || Array.isArray(before) !== Array.isArray(after)) return [prefix || "$.__root"];
  if (Array.isArray(before)) {
    if (before.length !== after.length) return [`${prefix}.length`.replace(/^\./, "")];
    return before.flatMap((value, index) => changedLeafPaths(value, after[index], `${prefix}.${index}`.replace(/^\./, "")));
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.flatMap((key) => changedLeafPaths(before[key], after[key], `${prefix}.${key}`.replace(/^\./, "")));
}

function isWithinPath(path, parent) {
  return path === parent || path.startsWith(`${parent}.`);
}

function collectStringHygieneErrors(value, path = "$", errors = [], seen = new Set()) {
  if (typeof value === "string") {
    if (UNSAFE_CONTROL_CHARACTERS.test(value)) errors.push(`${path} contains a disallowed control character`);
    if (MALFORMED_PIPE_MARKER.test(value)) errors.push(`${path} contains malformed pipe-marker text`);
    return errors;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return errors;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringHygieneErrors(item, `${path}[${index}]`, errors, seen));
  } else {
    Object.entries(value).forEach(([key, item]) => collectStringHygieneErrors(item, `${path}.${key}`, errors, seen));
  }
  return errors;
}

function validateStructuredStringHygiene(value) {
  const errors = collectStringHygieneErrors(value);
  if (errors.length) throw structuredOutputError(`Structured output contains malformed text: ${errors.join("; ")}`, errors);
  return value;
}

function validateScopedContentRevision({ originalContent, complianceFeedback, revision }) {
  validateStructuredStringHygiene(revision);
  if (!originalContent || typeof originalContent !== "object" || !revision?.revisedContent) return revision;

  const actualPaths = changedLeafPaths(originalContent, revision.revisedContent);
  const declaredPaths = (Array.isArray(revision.changedFields) ? revision.changedFields : [])
    .map((path) => normalizeContentPath(path, originalContent));
  const errors = [];
  if (!actualPaths.length) errors.push("$.revisedContent must change at least one field listed in $.changedFields");
  if (declaredPaths.some((path) => !path)) errors.push("$.changedFields contains a path that does not identify a concrete original-content field");
  const normalizedDeclared = declaredPaths.filter(Boolean);
  for (const actualPath of actualPaths) {
    if (!normalizedDeclared.some((declaredPath) => isWithinPath(actualPath, declaredPath))) {
      errors.push(`$.revisedContent.${actualPath} changed but is not declared in $.changedFields`);
    }
  }
  for (const declaredPath of normalizedDeclared) {
    if (!actualPaths.some((actualPath) => isWithinPath(actualPath, declaredPath))) {
      errors.push(`$.changedFields declares ${declaredPath}, but that field did not change`);
    }
  }

  const scope = revisionScope(complianceFeedback, originalContent);
  if (scope.restricted) {
    for (const actualPath of actualPaths) {
      if (!scope.allowedPaths.some((allowedPath) => isWithinPath(actualPath, allowedPath))) {
        errors.push(`$.revisedContent.${actualPath} changed unexpectedly; compliance permits only: ${scope.allowedPaths.join(", ")}`);
      }
    }
    for (const declaredPath of normalizedDeclared) {
      if (!scope.allowedPaths.some((allowedPath) => isWithinPath(declaredPath, allowedPath))) {
        errors.push(`$.changedFields includes unpermitted path ${declaredPath}; compliance permits only: ${scope.allowedPaths.join(", ")}`);
      }
    }
  }

  if (errors.length) {
    throw structuredOutputError(`Content revision exceeded its compliance scope: ${errors.join("; ")}`, errors);
  }
  return revision;
}

module.exports = {
  validateScopedContentRevision,
  validateStructuredStringHygiene,
};
