/**
 * Money as an exact integer count of minor units.
 *
 * Three things go wrong in every money input, and only the first one is well
 * known:
 *
 *   1. Floats. 0.1 + 0.2, and a total that is a cent off for reasons the user
 *      cannot see.
 *   2. Minor units. Not every currency has two decimals — JPY has none, KWD has
 *      three — so code that multiplies by 100 is wrong in Tokyo and Kuwait.
 *   3. Separators. "1.234,56" and "1,234.56" are the same amount written by two
 *      people, and a parser that assumes one of them silently reads the other
 *      off by a factor of a hundred.
 */

import { exponentOf, normalizeCurrency, type ExponentOverride } from "./exponents.ts";

/** An exact amount: minor units, and how many of them make one major unit. */
export type Money = {
  /** Cents, satoshi, yen — whatever the currency's smallest unit is. */
  readonly minor: bigint;
  readonly currency: string;
  readonly exponent: number;
};

/** How a locale writes numbers. */
export type Separators = {
  /** Between the whole part and the fraction. */
  readonly decimal: string;
  /** Between groups of thousands. May be empty. */
  readonly group: string;
};

const separators = new Map<string, Separators>();

/**
 * Read the separators a locale actually uses, from the platform rather than a
 * table this library would have to maintain and get wrong.
 */
export function separatorsFor(locale: string): Separators {
  // Parsing runs on every keystroke, and building the formatter is the
  // expensive half of this function.
  const known = separators.get(locale);
  if (known) return known;

  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.8);
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const group = parts.find((part) => part.type === "group")?.value ?? "";
  const found = { decimal, group };
  separators.set(locale, found);
  return found;
}

export type ParseOptions = {
  /** Required: the exponent follows from it, and there is no default. */
  readonly currency: string;
  readonly locale?: string;
  /** For a currency the bundled table does not carry, or to overrule it. */
  readonly exponent?: ExponentOverride;
};

export type ParseResult =
  | { readonly ok: true; readonly money: Money }
  | { readonly ok: false; readonly reason: ParseFailure };

export type ParseFailure =
  | "empty"
  | "not-a-number"
  | "too-many-decimals"
  | "too-many-separators"
  /**
   * The group separator is there but the digits are not grouped: "12.34" in
   * de-DE. Nine times out of ten this is a decimal written with the wrong
   * separator, and stripping it would read the amount off by a factor of a
   * hundred — so it is refused instead.
   */
  | "bad-grouping";

/**
 * Read typed text into exact minor units.
 *
 * Everything is done on the digits as text, so no float ever exists: "12.34"
 * becomes 1234 by moving the decimal point, not by multiplying. The currency is
 * the caller's, never read out of the text: "$12.34" in a EUR field is refused
 * rather than quietly turned into dollars.
 */
export function parse(text: string, options: ParseOptions): ParseResult {
  const currency = normalizeCurrency(options.currency);
  const exponent = exponentOf(currency, options.exponent);
  const { decimal, group } = separatorsFor(options.locale ?? "en-US");

  let cleaned = text.trim();
  if (cleaned === "") return { ok: false, reason: "empty" };

  const negative = cleaned.startsWith("-");
  if (negative) cleaned = cleaned.slice(1).trim();

  // A space groups thousands in several locales — fr-FR writes "1 234,56" with
  // a narrow no-break space — and is a stray one elsewhere. It is never a
  // decimal point, so it is read as grouping and then judged by the grouping
  // rule below, rather than silently removed.
  cleaned = cleaned.replace(/\s+/g, group);

  // The decimal separator is meaning, so it is split off first — before group
  // separators are touched, or "1.234,56" and "12.34" would be indistinguishable.
  const pieces = cleaned.split(decimal);
  if (pieces.length > 2) return { ok: false, reason: "too-many-separators" };

  let [whole = "", fraction = ""] = pieces;

  // A group separator after the decimal point is never a number.
  if (group && fraction.includes(group)) return { ok: false, reason: "not-a-number" };

  // Group separators are decoration, but only where the digits are actually
  // grouped. "1.234" in de-DE is a thousand; "12.34" in de-DE is almost always
  // a decimal written with the wrong separator, and silently stripping the dot
  // would read it as 1234.00 — off by a factor of a hundred, which is the exact
  // failure this module exists to prevent. The rule that separates the two:
  // the final group must be exactly three digits, and no group may exceed
  // three. (Groups of one or two before the last accommodate lakh-style
  // grouping, which several locales really use.)
  if (group && whole.includes(group)) {
    const groups = whole.split(group);
    const plausible =
      groups.every((piece) => /^\d+$/.test(piece)) &&
      groups.every((piece) => piece.length <= 3) &&
      groups[groups.length - 1]!.length === 3;
    if (!plausible) return { ok: false, reason: "bad-grouping" };
    whole = groups.join("");
  }

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return { ok: false, reason: "not-a-number" };
  if (whole === "" && fraction === "") return { ok: false, reason: "not-a-number" };
  if (fraction.length > exponent) return { ok: false, reason: "too-many-decimals" };

  const digits = (whole || "0") + fraction.padEnd(exponent, "0");
  const minor = BigInt(digits) * (negative ? -1n : 1n);
  return { ok: true, money: { minor, currency, exponent } };
}

/**
 * Whether text that does not parse is a prefix of an amount rather than a wrong
 * one: "-" on the way to "-5", "1 2" on the way to "1 234". Half-typed input is
 * a transient state, and a field that shows an error for it turns red between
 * the "." and the "5" of "12.50".
 *
 * A complete amount is not incomplete, so "12." — which is twelve — is false.
 */
export function isIncomplete(text: string, options: ParseOptions): boolean {
  if (parse(text, options).ok) return false;

  const exponent = exponentOf(options.currency, options.exponent);
  const { decimal, group } = separatorsFor(options.locale ?? "en-US");

  let rest = text.trim();
  if (rest === "") return true;
  if (rest.startsWith("-")) rest = rest.slice(1).trim();
  if (rest === "") return true;

  const pieces = rest.replace(/\s+/g, group).split(decimal);
  if (pieces.length > 2) return false;

  const [whole = "", fraction = ""] = pieces;
  // More typing only ever adds decimals, so a fraction that is already too long
  // is wrong rather than unfinished.
  if (!/^\d*$/.test(fraction) || fraction.length > exponent) return false;
  return isPrefixOfGrouping(whole, group);
}

/** Whether a whole part could still grow into a correctly grouped one. */
function isPrefixOfGrouping(whole: string, group: string): boolean {
  if (!group || !whole.includes(group)) return /^\d*$/.test(whole);
  const groups = whole.split(group);
  // Every group but the last is finished, so it has to be one to three digits.
  // The last one is still being typed: it may be short, or not there at all.
  return groups.every(
    (piece, index) =>
      /^\d*$/.test(piece) &&
      piece.length <= 3 &&
      (piece.length > 0 || index === groups.length - 1),
  );
}

export type FormatOptions = {
  readonly locale?: string;
  /** Include the currency symbol or code. Off by default: an input field that
   * writes a symbol into its own value fights the person typing. */
  readonly withCurrency?: boolean;
};

/** Render an exact amount the way the locale writes it. */
export function format(money: Money, options: FormatOptions = {}): string {
  const locale = options.locale ?? "en-US";
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: money.exponent,
    maximumFractionDigits: money.exponent,
    ...(options.withCurrency ? { style: "currency", currency: money.currency } : {}),
  });
  // Formatted from the decimal string, not from a number: Number(minor) / 100
  // would reintroduce the float this module exists to avoid.
  //
  // Intl.NumberFormat has accepted a string since the NumberFormat V3 proposal
  // landed, and formats it exactly — the runtime does the right thing, and
  // there is a test for it. TypeScript's bundled lib still declares only the
  // number overload, hence the cast rather than a float.
  const exactly = formatter.format as (value: string) => string;
  return exactly(toDecimalString(money));
}

/** The amount as a plain decimal string: "1234.56". Never a float. */
export function toDecimalString(money: Money): string {
  const negative = money.minor < 0n;
  const digits = (negative ? -money.minor : money.minor).toString().padStart(money.exponent + 1, "0");
  const whole = digits.slice(0, digits.length - money.exponent);
  const fraction = money.exponent > 0 ? "." + digits.slice(digits.length - money.exponent) : "";
  return (negative ? "-" : "") + whole + fraction;
}
