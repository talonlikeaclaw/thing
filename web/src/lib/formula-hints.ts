/** One completion the formula field offers under the caret. */
export type FormulaHintKind = "property" | "function" | "keyword";

export interface FormulaHint {
  /** The token inserted into the expression. */
  value: string;
  /** The words a reader scans: a property's display name, or the token. */
  label: string;
  kind: FormulaHintKind;
}

/** The formula language's function names, in the order the help lists them. */
export const FORMULA_FUNCTIONS = [
  "if",
  "round",
  "abs",
  "min",
  "max",
  "length",
  "lower",
  "upper",
  "days",
  "today",
] as const;

/** The literals and operators the lexer reads as words. */
export const FORMULA_KEYWORDS = ["and", "or", "not", "true", "false"] as const;

const HINT_LIMIT = 8;

/** A reference a formula may name: a stored property or `title`. */
export interface FormulaReference {
  key: string;
  name: string;
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[a-z0-9_]/.test(char);
}

/** Whether the caret sits inside a double-quoted string literal. */
export function insideString(expression: string, caret: number): boolean {
  let quoted = false;
  const end = Math.min(Math.max(caret, 0), expression.length);
  for (let index = 0; index < end; index += 1) {
    const char = expression[index];
    if (char === "\\") {
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    }
  }
  return quoted;
}

/** The identifier around the caret, and the span a suggestion replaces. */
export function formulaToken(
  expression: string,
  caret: number,
): { start: number; end: number; token: string } {
  const at = Math.min(Math.max(caret, 0), expression.length);
  let start = at;
  while (start > 0 && isIdentifierChar(expression[start - 1])) {
    start -= 1;
  }
  let end = at;
  while (end < expression.length && isIdentifierChar(expression[end])) {
    end += 1;
  }
  const token = expression.slice(start, end);
  return /^[a-z][a-z0-9_]*$/.test(token) || token === ""
    ? { start, end, token }
    : { start: at, end: at, token: "" };
}

/**
 * The completions for the token under the caret: the type's stored properties
 * first, then functions and keywords. A name a function or keyword owns is not
 * offered as a property, matching the lexer's shadowing rule.
 */
export function formulaHints(
  references: readonly FormulaReference[],
  expression: string,
  caret: number,
): FormulaHint[] {
  if (insideString(expression, caret)) {
    return [];
  }
  const { token } = formulaToken(expression, caret);
  const needle = token.toLowerCase();
  const reserved = new Set<string>([...FORMULA_FUNCTIONS, ...FORMULA_KEYWORDS]);
  const hints: FormulaHint[] = [];
  for (const reference of references) {
    if (reserved.has(reference.key)) {
      continue;
    }
    hints.push({
      value: reference.key,
      label: reference.name,
      kind: "property",
    });
  }
  for (const name of FORMULA_FUNCTIONS) {
    hints.push({ value: name, label: name, kind: "function" });
  }
  for (const name of FORMULA_KEYWORDS) {
    hints.push({ value: name, label: name, kind: "keyword" });
  }
  return hints
    .filter((hint) => hint.value.toLowerCase().startsWith(needle))
    .slice(0, HINT_LIMIT);
}

/**
 * Inserts one completion over the token under the caret. A function opens its
 * parenthesis and leaves the caret inside; a property replaces the token as-is.
 */
export function insertHint(
  expression: string,
  caret: number,
  hint: FormulaHint,
): { expression: string; caret: number } {
  const { start, end } = formulaToken(expression, caret);
  const needsParen =
    hint.kind === "function" && expression[end] !== "(";
  const inserted = needsParen ? `${hint.value}(` : hint.value;
  return {
    expression: `${expression.slice(0, start)}${inserted}${expression.slice(end)}`,
    caret: start + inserted.length,
  };
}
