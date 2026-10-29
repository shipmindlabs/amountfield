/**
 * The state machine behind a money input.
 *
 * All of it is a pure function, and the React hook is a thin wrapper over it.
 * That is not architectural taste: an input's awkward cases — a half-typed
 * "12.", a pasted "1 234,56", a caret in the middle of the number — are exactly
 * what nobody tests when the logic only exists inside a component.
 */

import { CurrencyMismatch, ExponentMismatch } from "./arithmetic.ts";
import { exponentOf, normalizeCurrency, type ExponentOverride } from "./exponents.ts";
import {
  format,
  isIncomplete,
  parse,
  separatorsFor,
  withoutBidi,
  type Money,
  type ParseFailure,
  type Separators,
} from "./money.ts";

/**
 * Why the field does not accept what it holds: a text that is not an amount, or
 * an amount outside the field's own bounds.
 */
export type FieldProblem = ParseFailure | "above-maximum" | "below-minimum";

export type FieldState = {
  /** What the input element shows. Always what the person typed, until blur. */
  readonly text: string;
  /**
   * The exact amount, when the text is a complete one. A bound is a rule about
   * an amount rather than a reason there is none, so an amount outside one is
   * still here and `problem` says the field does not accept it.
   */
  readonly money: Money | null;
  /** Why there is no amount, or why this one is not accepted. */
  readonly problem: FieldProblem | null;
  /**
   * True when the text is a prefix of a valid amount rather than wrong — and
   * when the amount is still short of the field's minimum, which more typing
   * can reach.
   */
  readonly incomplete: boolean;
  /** Where the caret belongs in `text`, after whatever rewrote it. */
  readonly caret: number;
};

export type FieldOptions = {
  readonly currency: string;
  readonly locale?: string;
  readonly exponent?: ExponentOverride;
  /** The smallest amount the field accepts, in its own currency. */
  readonly min?: Money;
  /** The largest amount the field accepts, in its own currency. */
  readonly max?: Money;
};

/** A fresh field, optionally holding an amount already. */
export function initial(options: FieldOptions, money?: Money): FieldState {
  const limits = bounds(options);
  if (!money) return { text: "", money: null, problem: null, incomplete: true, caret: 0 };
  const text = format(money, { locale: options.locale });
  // An amount handed in has stopped moving, so a bound it misses is reported at
  // once rather than held back the way a half-typed one is.
  return { text, money, problem: settled(money, limits), incomplete: false, caret: text.length };
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
  const limits = bounds(options);
  const text = sanitise(raw, options);
  const at = caretAfter(raw, caret, text, options);

  const result = parse(text, options);
  if (result.ok) {
    // The two bounds are not symmetrical, because typing is not. Past the
    // maximum is wrong at once: more digits only make the number larger. Short
    // of the minimum is unfinished — "1" is on the way to "100" — so it waits
    // for blur instead of reddening the field under the caret.
    const outside = settled(result.money, limits);
    if (outside === "below-minimum") {
      return { text, money: result.money, problem: null, incomplete: true, caret: at };
    }
    return { text, money: result.money, problem: outside, incomplete: false, caret: at };
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
 * moving, so rewriting it cannot fight the person entering it. It is also where
 * an amount that never reached the minimum becomes a problem.
 */
export function blurred(state: FieldState, options: FieldOptions): FieldState {
  const limits = bounds(options);
  if (!state.money) return state;
  const text = format(state.money, { locale: options.locale });
  return {
    ...state,
    text,
    problem: settled(state.money, limits),
    incomplete: false,
    caret: caretAfter(state.text, state.caret, text, options),
  };
}

/**
 * Strip what a paste carries and an amount does not: the field's own currency,
 * a minus sign that is not the ASCII one, the bidi marks Intl writes around a
 * number in right-to-left text, a space in front of the number.
 *
 * The digits stay as they were written, in the locale's own numbering system or
 * in ASCII, because parsing reads both and rewriting someone's digits under
 * their caret is not sanitising.
 *
 * Only the field's own currency is removed. The currency is never read out of
 * the text, so a dollar sign in a EUR field stays in the string and is refused
 * there rather than quietly taken for euros.
 */
export function sanitise(text: string, options: FieldOptions): string {
  const currency = normalizeCurrency(options.currency);
  const locale = options.locale ?? "en-US";
  const { minus } = separatorsFor(locale);

  let cleaned = withoutBidi(text).replace(MINUS, "-");
  if (minus !== "-" && minus !== "") cleaned = cleaned.split(minus).join("-");
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

  const locale = separatorsFor(options.locale ?? "en-US");
  const upto = Math.max(0, Math.min(caret, before.length));

  let wanted = 0;
  for (let index = 0; index < upto; index++) {
    if (meaningful(before[index], locale)) wanted++;
  }

  if (wanted === 0) {
    for (let index = 0; index < after.length; index++) {
      if (meaningful(after[index], locale)) return index;
    }
    return 0;
  }

  let seen = 0;
  for (let index = 0; index < after.length; index++) {
    if (!meaningful(after[index], locale)) continue;
    seen++;
    if (seen === wanted) return index + 1;
  }
  return after.length;
}

function meaningful(char: string, locale: Separators): boolean {
  return (
    char === "-" ||
    char === locale.minus ||
    char === locale.decimal ||
    (char >= "0" && char <= "9") ||
    locale.digits.includes(char)
  );
}

type Bounds = { readonly min: Money | null; readonly max: Money | null };

const UNBOUNDED: Bounds = { min: null, max: null };

/**
 * The field's bounds, checked against the currency they are compared in.
 *
 * A bound in another currency, or with an exponent an override moved, is
 * refused the way `add` refuses two such amounts: the counts are a factor of a
 * hundred apart, and it is a mistake in the calling code rather than something
 * the person typing can fix. So it throws, and it throws on an empty field too.
 */
function bounds(options: FieldOptions): Bounds {
  const { min, max } = options;
  if (!min && !max) return UNBOUNDED;

  const unit: Money = {
    minor: 0n,
    currency: normalizeCurrency(options.currency),
    exponent: exponentOf(options.currency, options.exponent),
  };
  return {
    min: min ? comparable(unit, min) : null,
    max: max ? comparable(unit, max) : null,
  };
}

function comparable(unit: Money, bound: Money): Money {
  if (bound.currency !== unit.currency) throw new CurrencyMismatch(unit, bound);
  if (bound.exponent !== unit.exponent) throw new ExponentMismatch(unit, bound);
  return bound;
}

/** Which bound a settled amount misses, if either. */
function settled(money: Money, limits: Bounds): FieldProblem | null {
  if (limits.max && money.minor > limits.max.minor) return "above-maximum";
  if (limits.min && money.minor < limits.min.minor) return "below-minimum";
  return null;
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
    for (const part of parts) {
      if (part.type !== "currency") continue;
      // Without the bidi marks, because the text these are removed from has had
      // its own dropped already.
      const mark = withoutBidi(part.value);
      if (mark) found.add(mark);
    }
  }

  // Longest first, so "F CFA" is not left as a stray "F" by removing "CFA".
  const list = [...found].sort((left, right) => right.length - left.length);
  marks.set(key, list);
  return list;
}
