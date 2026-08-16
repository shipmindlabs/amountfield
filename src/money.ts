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

/** An exact amount: minor units, and how many of them make one major unit. */
export type Money = {
  /** Cents, satoshi, yen — whatever the currency's smallest unit is. */
  readonly minor: bigint;
  readonly currency: string;
  readonly exponent: number;
};

/**
 * ISO 4217 exponents for the currencies this ships with.
 *
 * The list is short on purpose. An unknown currency is refused rather than
 * assumed to have two decimals, because that assumption is exactly what breaks
 * on JPY — and a wrong amount is worse than an error message.
 */
export const EXPONENTS: Readonly<Record<string, number>> = {
  EUR: 2, USD: 2, GBP: 2, CHF: 2, PLN: 2, CZK: 2, SEK: 2, NOK: 2, DKK: 2,
  CAD: 2, AUD: 2, NZD: 2, SGD: 2, HKD: 2, CNY: 2, INR: 2, BRL: 2, MXN: 2,
  ZAR: 2, TRY: 2, AED: 2, SAR: 2, ILS: 2, RON: 2, HUF: 2, BGN: 2, UAH: 2,
  JPY: 0, KRW: 0, CLP: 0, ISK: 0, VND: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};

export class UnknownCurrency extends Error {
  readonly currency: string;
  constructor(currency: string) {
    super(
      `unknown currency "${currency}": pass its ISO 4217 exponent explicitly. ` +
        `Assuming two decimals is what breaks on JPY (0) and KWD (3).`,
    );
    this.currency = currency;
  }
}

export function exponentOf(currency: string, override?: number): number {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 0 || override > 6) {
      throw new RangeError(`exponent ${override} is not a plausible ISO 4217 exponent`);
    }
    return override;
  }
  const known = EXPONENTS[currency.toUpperCase()];
  if (known === undefined) throw new UnknownCurrency(currency);
  return known;
}

/** How a locale writes numbers. */
export type Separators = {
  /** Between the whole part and the fraction. */
  readonly decimal: string;
  /** Between groups of thousands. May be empty. */
  readonly group: string;
};

/**
 * Read the separators a locale actually uses, from the platform rather than a
 * table this library would have to maintain and get wrong.
 */
export function separatorsFor(locale: string): Separators {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.8);
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const group = parts.find((part) => part.type === "group")?.value ?? "";
  return { decimal, group };
}

export type ParseOptions = {
  readonly currency: string;
  readonly locale?: string;
  /** For a currency not in the table, or to override it. */
  readonly exponent?: number;
};

export type ParseResult =
  | { readonly ok: true; readonly money: Money }
  | { readonly ok: false; readonly reason: ParseFailure };

export type ParseFailure =
  | "empty"
  | "not-a-number"
  | "too-many-decimals"
  | "too-many-separators";

/**
 * Read typed text into exact minor units.
 *
 * Everything is done on the digits as text, so no float ever exists: "12.34"
 * becomes 1234 by moving the decimal point, not by multiplying.
 */
export function parse(text: string, options: ParseOptions): ParseResult {
  const exponent = exponentOf(options.currency, options.exponent);
  const { decimal, group } = separatorsFor(options.locale ?? "en-US");

  let cleaned = text.trim();
  if (cleaned === "") return { ok: false, reason: "empty" };

  const negative = cleaned.startsWith("-");
  if (negative) cleaned = cleaned.slice(1);

  // Group separators are decoration; the decimal separator is meaning.
  if (group) cleaned = cleaned.split(group).join("");
  // A space is grouping in several locales, and a stray one otherwise.
  cleaned = cleaned.replace(/[\s  ]/g, "");

  const pieces = cleaned.split(decimal);
  if (pieces.length > 2) return { ok: false, reason: "too-many-separators" };

  const [whole = "", fraction = ""] = pieces;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return { ok: false, reason: "not-a-number" };
  if (whole === "" && fraction === "") return { ok: false, reason: "not-a-number" };
  if (fraction.length > exponent) return { ok: false, reason: "too-many-decimals" };

  const digits = (whole || "0") + fraction.padEnd(exponent, "0");
  const minor = BigInt(digits) * (negative ? -1n : 1n);
  return { ok: true, money: { minor, currency: options.currency.toUpperCase(), exponent } };
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
