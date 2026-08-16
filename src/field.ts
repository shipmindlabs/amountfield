/**
 * The state machine behind a money input.
 *
 * All of it is a pure function, and the React hook is a thin wrapper over it.
 * That is not architectural taste: an input's awkward cases — a half-typed
 * "12.", a pasted "1 234,56", a caret in the middle of the number — are exactly
 * what nobody tests when the logic only exists inside a component.
 */

import { format, parse, type Money, type ParseFailure } from "./money.ts";

export type FieldState = {
  /** What the input element shows. Always what the person typed, until blur. */
  readonly text: string;
  /** The exact amount, when the text is a complete one. */
  readonly money: Money | null;
  /** Why there is no amount. Null while the field is simply incomplete. */
  readonly problem: ParseFailure | null;
  /** True when the text is a prefix of a valid amount rather than wrong. */
  readonly incomplete: boolean;
};

export type FieldOptions = {
  readonly currency: string;
  readonly locale?: string;
  readonly exponent?: number;
};

/** A fresh field, optionally holding an amount already. */
export function initial(options: FieldOptions, money?: Money): FieldState {
  if (!money) return { text: "", money: null, problem: null, incomplete: true };
  return {
    text: format(money, { locale: options.locale }),
    money,
    problem: null,
    incomplete: false,
  };
}

/**
 * Someone typed. The text is kept exactly as entered — reformatting mid-typing
 * is what makes a field jump the caret and delete a digit the user is halfway
 * through — and only the derived amount changes.
 */
export function typed(text: string, options: FieldOptions): FieldState {
  const result = parse(text, options);
  if (result.ok) {
    return { text, money: result.money, problem: null, incomplete: false };
  }

  // "12." and "" are not errors, they are unfinished. Showing a red border to
  // someone who is still typing is the most common bug in these components.
  if (result.reason === "empty" || isPrefixOfAnAmount(text, options)) {
    return { text, money: null, problem: null, incomplete: true };
  }
  return { text, money: null, problem: result.reason, incomplete: false };
}

/**
 * The field lost focus. This is where reformatting belongs: the value stops
 * moving, so rewriting it cannot fight the person entering it.
 */
export function blurred(state: FieldState, options: FieldOptions): FieldState {
  if (!state.money) return state;
  return { ...state, text: format(state.money, { locale: options.locale }) };
}

/** Whether the text could still become a valid amount with more typing. */
function isPrefixOfAnAmount(text: string, options: FieldOptions): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "-") return true;
  // A trailing separator: "12." or "12,". Parsing it as-is fails, parsing it
  // with a zero appended tells us whether the rest was sound.
  const withZero = parse(trimmed + "0", options);
  return withZero.ok;
}
