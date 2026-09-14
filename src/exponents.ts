/**
 * How many decimals a currency has.
 *
 * Two is not a law of money. JPY has none, KWD has three, CLF has four, so code
 * that multiplies by 100 is wrong in Tokyo, in Kuwait and in Santiago. This
 * module is the only place the library answers the question, and when it has no
 * answer it says so instead of falling back to two.
 */

/** Currency codes mapped to their ISO 4217 exponent. Keys are uppercase. */
export type Exponents = Readonly<Record<string, number>>;

/**
 * An answer for a currency the bundled table does not carry, or a different
 * answer for one it does: a fixed exponent, a table of them, or a lookup.
 *
 * A lookup that returns undefined defers to the bundled table, so a hook can add
 * currencies without restating the ones that are already right.
 */
export type ExponentOverride = number | Exponents | ((currency: string) => number | undefined);

/**
 * The currencies this ships with.
 *
 * The list is short on purpose: a code that is not here is refused rather than
 * assumed to have two decimals, because a wrong amount is worse than an error.
 */
export const EXPONENTS: Exponents = Object.freeze({
  // Two decimals — the common case, which is still worth writing down.
  AED: 2, ARS: 2, AUD: 2, BDT: 2, BGN: 2, BRL: 2, CAD: 2, CHF: 2, CNY: 2,
  COP: 2, CZK: 2, DKK: 2, EGP: 2, EUR: 2, GBP: 2, HKD: 2, HUF: 2, IDR: 2,
  ILS: 2, INR: 2, KES: 2, LKR: 2, MAD: 2, MXN: 2, MYR: 2, NGN: 2, NOK: 2,
  NZD: 2, PEN: 2, PHP: 2, PKR: 2, PLN: 2, QAR: 2, RON: 2, RSD: 2, RUB: 2,
  SAR: 2, SEK: 2, SGD: 2, THB: 2, TRY: 2, TWD: 2, UAH: 2, USD: 2, UZS: 2,
  VES: 2, ZAR: 2,

  // No decimals at all: a hundredth of one of these does not exist.
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,

  // Three, and four.
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
});

const CODE = /^[A-Za-z]{3}$/;

export class MissingCurrency extends Error {
  readonly received: unknown;
  constructor(received: unknown) {
    super(
      `a three-letter ISO 4217 currency code is required, received ${show(received)}. ` +
        `The exponent follows from the currency, and no default is worth having: ` +
        `two decimals is wrong in Tokyo.`,
    );
    this.received = received;
  }
}

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

/** The code as the table writes it, or a refusal. The currency is never optional. */
export function normalizeCurrency(currency: string): string {
  if (typeof currency !== "string") throw new MissingCurrency(currency);
  const code = currency.trim();
  if (!CODE.test(code)) throw new MissingCurrency(currency);
  return code.toUpperCase();
}

/** How many minor units make one major unit of this currency. */
export function exponentOf(currency: string, override?: ExponentOverride): number {
  const code = normalizeCurrency(currency);

  const chosen = ask(code, override);
  if (chosen !== undefined) return plausible(chosen, code);

  const known = EXPONENTS[code];
  if (known === undefined) throw new UnknownCurrency(code);
  return known;
}

function ask(code: string, override?: ExponentOverride): number | undefined {
  if (override === undefined) return undefined;
  if (typeof override === "number") return override;
  if (typeof override === "function") return override(code);
  return override[code];
}

function plausible(exponent: number, currency: string): number {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) {
    throw new RangeError(
      `exponent ${exponent} for "${currency}" is not a plausible ISO 4217 exponent (0 to 6)`,
    );
  }
  return exponent;
}

function show(received: unknown): string {
  return typeof received === "string" ? `"${received}"` : String(received);
}
