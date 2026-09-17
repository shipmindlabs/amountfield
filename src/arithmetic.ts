/**
 * Arithmetic on exact minor units.
 *
 * Money is counted, not measured: a total is a sum of whole minor units, and
 * splitting one has to give back exactly what went into it. Two things go wrong
 * when it does not. A share is rounded on its own, and three thirds of a cent
 * add up to two; or a share is rounded the other way, and the parts add up to
 * more than anyone paid. Neither can happen here — `allocate` hands out every
 * minor unit and invents none, and `multiply` refuses to round until it is told
 * where the fraction goes.
 */

import { toDecimalString, type Money } from "./money.ts";

const ROUNDINGS = ["down", "up", "floor", "ceil", "half-up", "half-even"] as const;

/**
 * Where a fraction of a minor unit goes. `down` and `up` are toward and away
 * from zero; `floor` and `ceil` are toward minus and plus infinity, which is a
 * different thing for a negative amount.
 */
export type Rounding = (typeof ROUNDINGS)[number];

/** An exact ratio that no decimal string could write, such as one third. */
export type Fraction = {
  readonly numerator: bigint | number | string;
  readonly denominator: bigint | number | string;
};

/**
 * A ratio as text ("0.19"), as a whole number, or as a fraction. A JavaScript
 * number that is not whole is refused: 0.1 is not 0.1, and this library exists
 * because that matters.
 */
export type Ratio = bigint | number | string | Fraction;

export class CurrencyMismatch extends Error {
  readonly left: Money;
  readonly right: Money;
  constructor(left: Money, right: Money) {
    super(
      `${left.currency} and ${right.currency} are different currencies: there is no exchange rate ` +
        `here, and adding the numbers would produce an amount in no currency at all.`,
    );
    this.left = left;
    this.right = right;
  }
}

export class ExponentMismatch extends Error {
  readonly left: Money;
  readonly right: Money;
  constructor(left: Money, right: Money) {
    super(
      `${left.currency} with exponent ${left.exponent} and ${right.currency} with exponent ` +
        `${right.exponent} are not the same unit — one of them came from an override — and adding ` +
        `them would be off by a factor of ${10 ** Math.abs(left.exponent - right.exponent)}.`,
    );
    this.left = left;
    this.right = right;
  }
}

export class InexactRatio extends Error {
  readonly received: unknown;
  constructor(received: unknown) {
    super(
      typeof received === "number"
        ? `the ratio ${received} is a float, and a float is not the number that was written: 0.1 is ` +
          `0.1000000000000000055…. Write it as text ("0.1") or as { numerator: 1, denominator: 10 }.`
        : `${JSON.stringify(String(received))} is not a ratio: write a decimal such as "0.19", a ` +
          `whole number, or { numerator, denominator }.`,
    );
    this.received = received;
  }
}

export class InexactAmount extends Error {
  readonly money: Money;
  readonly ratio: Ratio;
  constructor(money: Money, ratio: Ratio) {
    super(
      `${toDecimalString(money)} ${money.currency} times ${showRatio(ratio)} is not a whole number ` +
        `of minor units; pass a rounding mode (${ROUNDINGS.join(", ")}) to say where the fraction ` +
        `goes, or use allocate() to split a total without losing a unit.`,
    );
    this.money = money;
    this.ratio = ratio;
  }
}

/** The sum, in minor units. Two currencies are refused, never converted. */
export function add(left: Money, right: Money): Money {
  agree(left, right);
  return { ...left, minor: left.minor + right.minor };
}

/** The difference, in minor units. Negative results are amounts like any other. */
export function subtract(left: Money, right: Money): Money {
  agree(left, right);
  return { ...left, minor: left.minor - right.minor };
}

/**
 * An amount scaled by a ratio.
 *
 * The product is worked out as a fraction of integers, so it is exact until the
 * last step. When that step does not land on a whole minor unit — nineteen
 * percent of 99.99 does not — a rounding mode is required rather than assumed:
 * which way the half cent goes is a business decision, and guessing it is how a
 * total ends up a cent away from the sum of its lines.
 */
export function multiply(money: Money, ratio: Ratio, rounding?: Rounding): Money {
  const { n, d } = ratioOf(ratio);
  const numerator = money.minor * n;

  if (numerator % d !== 0n) {
    if (rounding === undefined) throw new InexactAmount(money, ratio);
    if (!ROUNDINGS.includes(rounding)) {
      throw new RangeError(`"${rounding}" is not a rounding mode; the modes are ${ROUNDINGS.join(", ")}`);
    }
  }

  return { ...money, minor: divide(numerator, d, rounding ?? "down") };
}

/**
 * Split an amount into parts that add up to it exactly.
 *
 * `parts` is either a count of equal shares or a list of weights. Every share
 * is floored, and the units that division could not place go to the largest
 * remainders — so the parts differ by at most one minor unit, and their sum is
 * the original amount whatever the weights were.
 */
export function allocate(money: Money, parts: number | readonly (bigint | number)[]): Money[] {
  const weights = weightsOf(parts);
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total === 0n) {
    throw new RangeError("the weights add up to zero, so there are no shares to allocate to");
  }

  // Done on the magnitude and signed back afterwards, so that a negative total
  // is split the same way as the positive one rather than by how division
  // happens to truncate.
  const negative = money.minor < 0n;
  const amount = negative ? -money.minor : money.minor;

  const shares = weights.map((weight) => (amount * weight) / total);
  const remainders = weights.map((weight) => (amount * weight) % total);
  let left = amount - shares.reduce((sum, share) => sum + share, 0n);

  const order = shares
    .map((_, index) => index)
    .sort((a, b) =>
      remainders[a] === remainders[b] ? a - b : remainders[a] > remainders[b] ? -1 : 1,
    );
  for (const index of order) {
    if (left === 0n) break;
    shares[index] += 1n;
    left -= 1n;
  }

  return shares.map((share) => ({ ...money, minor: negative ? -share : share }));
}

function agree(left: Money, right: Money): void {
  if (left.currency !== right.currency) throw new CurrencyMismatch(left, right);
  if (left.exponent !== right.exponent) throw new ExponentMismatch(left, right);
}

type Exact = { readonly n: bigint; readonly d: bigint };

function ratioOf(ratio: Ratio): Exact {
  if (typeof ratio === "object") {
    const top = exactly(ratio.numerator);
    const bottom = exactly(ratio.denominator);
    if (bottom.n === 0n) throw new RangeError("a ratio with a denominator of zero is not a ratio");
    return { n: top.n * bottom.d, d: top.d * bottom.n };
  }
  return exactly(ratio);
}

function exactly(value: bigint | number | string): Exact {
  if (typeof value === "bigint") return { n: value, d: 1n };
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new InexactRatio(value);
    return { n: BigInt(value), d: 1n };
  }

  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new InexactRatio(value);
  const digits = text.replace(/^[+-]/, "");
  const [whole = "", fraction = ""] = digits.split(".");
  const n = BigInt((whole || "0") + fraction);
  return { n: text.startsWith("-") ? -n : n, d: 10n ** BigInt(fraction.length) };
}

function divide(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  const n = denominator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d; // truncated toward zero
  const rest = n % d; // carries the sign of the dividend
  if (rest === 0n) return quotient;

  const negative = rest < 0n;
  const away = negative ? quotient - 1n : quotient + 1n;
  const twice = (negative ? -rest : rest) * 2n;

  if (rounding === "down") return quotient;
  if (rounding === "up") return away;
  if (rounding === "floor") return negative ? away : quotient;
  if (rounding === "ceil") return negative ? quotient : away;
  if (rounding === "half-up") return twice >= d ? away : quotient;
  if (twice !== d) return twice > d ? away : quotient;
  // half-even: an exact tie goes to the even unit, so a long column of them
  // does not drift upwards.
  return quotient % 2n === 0n ? quotient : away;
}

function weightsOf(parts: number | readonly (bigint | number)[]): bigint[] {
  if (typeof parts === "number") {
    if (!Number.isSafeInteger(parts) || parts < 1) {
      throw new RangeError(`allocate() needs a whole number of parts, received ${parts}`);
    }
    return Array.from({ length: parts }, () => 1n);
  }

  if (parts.length === 0) throw new RangeError("allocate() needs at least one part");
  return parts.map((part) => {
    if (typeof part === "number" && !Number.isSafeInteger(part)) {
      throw new RangeError(`weight ${part} is not whole; weights are counts, and 0.1 is not 0.1`);
    }
    const weight = BigInt(part);
    if (weight < 0n) throw new RangeError(`weight ${part} is negative, and a share of a total is not`);
    return weight;
  });
}

function showRatio(ratio: Ratio): string {
  if (typeof ratio === "object") return `${String(ratio.numerator)}/${String(ratio.denominator)}`;
  return String(ratio);
}
