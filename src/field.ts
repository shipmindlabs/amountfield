/**
 * The state machine behind a money input.
 *
 * All of it is a pure function, and the React hook is a thin wrapper over it.
 * That is not architectural taste: an input's awkward cases — a half-typed
 * "12.", a pasted "1 234,56", a caret in the middle of the number — are exactly
 * what nobody tests when the logic only exists inside a component.
 */

import { normalizeCurrency, type ExponentOverride } from "./exponents.ts";
import {
  format,
  isIncomplete,
  parse,
  separatorsFor,
  type Money,
  type ParseFailure,
} from "./money.ts";

export type FieldState = {
  /** What the input element shows. Always what the person typed, until blur. */
  readonly text: string;
  /** The exact amount, when the text is a complete one. */
  readonly money: Money | null;
  /** Why there is no amount. Null while the field is simply incomplete. */
  readonly problem: ParseFailure | null;
  /** True when the text is a prefix of a valid amount rather than wrong. */
  readonly incomplete: boolean;
  /** Where the caret belongs in `text`, after whatever rewrote it. */
  readonly caret: number;
};

export type FieldOptions = {
  readonly currency: string;
  readonly locale?: string;
  readonly exponent?: ExponentOverride;
};

/** A fresh field, optionally holding an amount already. */
export function initial(options: FieldOptions, money?: Money): FieldState {
  if (!money) return { text: "", money: null, problem: null, incomplete: true, caret: 0 };
  const text = format(money, { locale: options.locale });
  return { text, money, problem: null, incomplete: false, caret: text.length };
}

/**
 * Someone typed, or pasted.
 *
 * The text is kept exactly as entered apart from what a money field cannot hold
 * at all — its own currency written beside the number, a unicode minus, a space
 * in front. Regrouping mid-typing is what makes a field jump the caret and eat
 * a digit, so that is left to blur.
 *
 * `caret` is where the input element left the caret, and comes back adjusted
 * for whatever the sanitising removed in front of it.
 */
export function typed(raw: string, options: FieldOptions, caret: number = raw.length): FieldState {
  const text = sanitise(raw, options);
  const at = caretAfter(raw, caret, text, options);

  const result = parse(text, options);
  if (result.ok) {
    return { text, money: result.money, problem: null, incomplete: false, caret: at };
  }

  // "1 2" and "" are not errors, they are unfinished. Showing a red border to
  // someone who is still typing is the most common bug in these components.
  if (isIncomplete(text, options)) {
    return { text, money: null, problem: null, incomplete: true, caret: at };
  }
  return { text, money: null, problem: result.reason, incomplete: false, caret: at };
}

/**
 * The field lost focus. This is where reformatting belongs: the value stops
 * moving, so rewriting it cannot fight the person entering it.
 */
export function blurred(state: FieldState, options: FieldOptions): FieldState {
  if (!state.money) return state;
  const text = format(state.money, { locale: options.locale });
  return { ...state, text, caret: caretAfter(state.text, state.caret, text, options) };
}

/**
 * Strip what a paste carries and an amount does not: the field's own currency,
 * a minus sign that is not the ASCII one, a space in front of the number.
 *
 * Only the field's own currency is removed. The currency is never read out of
 * the text, so a dollar sign in a EUR field stays in the string and is refused
 * there rather than quietly taken for euros.
 */
export function sanitise(text: string, options: FieldOptions): string {
  const currency = normalizeCurrency(options.currency);
  const locale = options.locale ?? "en-US";

  let cleaned = text.replace(MINUS, "-");
  for (const mark of marksFor(currency, locale)) cleaned = cleaned.split(mark).join("");
  cleaned = cleaned.replace(new RegExp(currency, "gi"), "");

  // A space in front of the number is grouping in no locale, and leaving it
  // there would have it read as a group separator with nothing before it.
  return cleaned.replace(/^\s+/, "");
}

/**
 * Where the caret goes when the text under it is rewritten.
 *
 * The digits, the sign and the decimal point are what the person is aiming at;
 * grouping, spaces and symbols move around them. So the caret is put back after
 * the same count of those, which keeps it still when "1234" becomes "1,234" and
 * when a pasted symbol in front of it disappears.
 */
export function caretAfter(
  before: string,
  caret: number,
  after: string,
  options: FieldOptions,
): number {
  if (before === after) return Math.max(0, Math.min(caret, after.length));

  const { decimal } = separatorsFor(options.locale ?? "en-US");
  const upto = Math.max(0, Math.min(caret, before.length));

  let wanted = 0;
  for (let index = 0; index < upto; index++) {
    if (meaningful(before[index], decimal)) wanted++;
  }

  if (wanted === 0) {
    for (let index = 0; index < after.length; index++) {
      if (meaningful(after[index], decimal)) return index;
    }
    return 0;
  }

  let seen = 0;
  for (let index = 0; index < after.length; index++) {
    if (!meaningful(after[index], decimal)) continue;
    seen++;
    if (seen === wanted) return index + 1;
  }
  return after.length;
}

function meaningful(char: string, decimal: string): boolean {
  return char === "-" || char === decimal || (char >= "0" && char <= "9");
}

// The minus a spreadsheet, a PDF or a Japanese keyboard writes.
const MINUS = /[\u2212\u2012\u2013\u2014\uFF0D]/g;

const marks = new Map<string, readonly string[]>();

/** The ways this locale writes this currency: the symbol, its narrow form, the code. */
function marksFor(currency: string, locale: string): readonly string[] {
  const key = `${locale} ${currency}`;
  const known = marks.get(key);
  if (known) return known;

  const found = new Set<string>();
  for (const currencyDisplay of ["symbol", "narrowSymbol", "code"] as const) {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay,
    }).formatToParts(0);
    for (const part of parts) if (part.type === "currency") found.add(part.value);
  }

  // Longest first, so "F CFA" is not left as a stray "F" by removing "CFA".
  const list = [...found].sort((left, right) => right.length - left.length);
  marks.set(key, list);
  return list;
}
