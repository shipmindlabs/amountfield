import { test } from "node:test";
import assert from "node:assert/strict";

import {
  add,
  allocate,
  multiply,
  subtract,
  CurrencyMismatch,
  ExponentMismatch,
  InexactAmount,
  InexactRatio,
  type Rounding,
} from "../src/arithmetic.ts";
import { parse, toDecimalString, type Money } from "../src/money.ts";

function amount(text: string, options: { currency: string; exponent?: number } = { currency: "EUR" }): Money {
  const result = parse(text, options);
  assert.equal(result.ok, true, `expected "${text}" to parse`);
  return (result as { ok: true; money: Money }).money;
}

function cents(minor: bigint): Money {
  return { minor, currency: "EUR", exponent: 2 };
}

function sum(parts: readonly Money[]): bigint {
  return parts.reduce((total, part) => total + part.minor, 0n);
}

test("sums are exact counts of minor units", () => {
  assert.equal(add(amount("0.10"), amount("0.20")).minor, 30n);
  assert.equal(subtract(amount("10.00"), amount("12.34")).minor, -234n);
  assert.equal(add(amount("999999999999.99"), amount("0.01")).minor, 100000000000000n);
  // The currency and its exponent survive the operation.
  const yen = add(amount("1200", { currency: "JPY" }), amount("34", { currency: "JPY" }));
  assert.equal(yen.minor, 1234n);
  assert.equal(yen.exponent, 0);
});

test("two currencies are refused rather than converted", () => {
  assert.throws(() => add(amount("1.00"), amount("100", { currency: "JPY" })), CurrencyMismatch);
  assert.throws(() => subtract(amount("1.00"), amount("100", { currency: "JPY" })), CurrencyMismatch);
  // The same code with a different exponent is a different unit: one of them
  // was given an override, and the numbers are a hundred apart.
  assert.throws(
    () => add(amount("12.34"), amount("12", { currency: "EUR", exponent: 0 })),
    ExponentMismatch,
  );
});

test("a ratio that divides exactly needs no rounding policy", () => {
  assert.equal(multiply(amount("12.50"), 3).minor, 3750n);
  assert.equal(multiply(amount("12.50"), 3n).minor, 3750n);
  assert.equal(multiply(amount("1.00"), "0.5").minor, 50n);
  assert.equal(multiply(amount("1.00"), { numerator: 1, denominator: 4 }).minor, 25n);
  assert.equal(multiply(amount("1.00"), "-0.5").minor, -50n);
  const scaled = multiply(amount("1.00"), 2);
  assert.equal(scaled.currency, "EUR");
  assert.equal(toDecimalString(scaled), "2.00");
});

// Which way half a cent goes is a business decision, and a library that picks
// one silently is where a total drifts away from the sum of its lines.
test("a product that is not whole is refused until a mode is given", () => {
  assert.throws(() => multiply(amount("1.00"), "0.075"), InexactAmount);
  assert.throws(() => multiply(amount("99.99"), "0.19"), InexactAmount);
  assert.equal(multiply(amount("1.00"), "0.075", "half-even").minor, 8n);
  assert.equal(multiply(amount("99.99"), "0.19", "half-even").minor, 1900n);
  assert.throws(
    () => multiply(amount("1.00"), "0.075", "nearest" as Rounding),
    RangeError,
  );
});

test("each rounding mode does what it says, on both signs", () => {
  const expected: Record<string, [bigint, bigint]> = {
    down: [2n, -2n],
    up: [3n, -3n],
    floor: [2n, -3n],
    ceil: [3n, -2n],
    "half-up": [3n, -3n],
    "half-even": [2n, -2n],
  };
  for (const [mode, [positive, negative]] of Object.entries(expected)) {
    assert.equal(multiply(cents(5n), "0.5", mode as Rounding).minor, positive, mode);
    assert.equal(multiply(cents(-5n), "0.5", mode as Rounding).minor, negative, mode);
  }
  // Banker's rounding sends the tie to the even unit, in both directions.
  assert.equal(multiply(cents(100n), "0.085", "half-even").minor, 8n);
  assert.equal(multiply(cents(100n), "0.075", "half-even").minor, 8n);
});

test("a float ratio is refused, with the exact form to write instead", () => {
  assert.throws(() => multiply(amount("1.00"), 0.1), InexactRatio);
  assert.throws(() => multiply(amount("1.00"), "nineteen percent"), InexactRatio);
  assert.throws(() => multiply(amount("1.00"), { numerator: 1, denominator: 0 }), RangeError);
  // The exact forms of the same ratio agree.
  assert.equal(multiply(cents(1000n), "0.1").minor, 100n);
  assert.equal(multiply(cents(1000n), { numerator: 1, denominator: 10 }).minor, 100n);
});

// The classic loss: three thirds of a cent that add up to two.
test("an allocation loses no minor unit and invents none", () => {
  assert.deepEqual(allocate(cents(5n), 3).map((part) => part.minor), [2n, 2n, 1n]);
  assert.deepEqual(allocate(cents(100n), 3).map((part) => part.minor), [34n, 33n, 33n]);
  assert.deepEqual(allocate(cents(5n), [3, 7]).map((part) => part.minor), [2n, 3n]);
  assert.deepEqual(allocate(cents(-5n), 3).map((part) => part.minor), [-2n, -2n, -1n]);
  assert.deepEqual(allocate(cents(0n), 3).map((part) => part.minor), [0n, 0n, 0n]);
  // A weight of zero is a share of nothing, even while units are left over.
  assert.deepEqual(allocate(cents(1n), [0, 1, 1]).map((part) => part.minor), [0n, 1n, 0n]);

  const yen = allocate(amount("1000", { currency: "JPY" }), 3);
  assert.equal(sum(yen), 1000n);
  assert.equal(yen[0].currency, "JPY");
  assert.equal(yen[0].exponent, 0);
});

test("equal parts differ by at most one minor unit", () => {
  const parts = allocate(cents(101n), 4).map((part) => part.minor);
  assert.equal(sum(allocate(cents(101n), 4)), 101n);
  assert.equal(parts[0] - parts[parts.length - 1], 1n);
});

test("an allocation with nothing to divide by is refused", () => {
  assert.throws(() => allocate(cents(100n), 0), RangeError);
  assert.throws(() => allocate(cents(100n), 2.5), RangeError);
  assert.throws(() => allocate(cents(100n), []), RangeError);
  assert.throws(() => allocate(cents(100n), [0, 0]), RangeError);
  assert.throws(() => allocate(cents(100n), [1, -1]), RangeError);
  assert.throws(() => allocate(cents(100n), [1, 0.5]), RangeError);
});

// The property that matters, over more cases than anyone writes by hand.
test("every allocation adds back up to what went into it", () => {
  let seed = 20260917n;
  const next = (limit: bigint): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    return seed % limit;
  };

  for (let round = 0; round < 500; round++) {
    const minor = next(2_000_000n) - 1_000_000n;
    const count = Number(next(9n)) + 1;
    const weights = Array.from({ length: count }, () => Number(next(10n)));
    if (weights.every((weight) => weight === 0)) weights[0] = 1;

    const parts = allocate(cents(minor), weights);
    assert.equal(parts.length, count);
    assert.equal(sum(parts), minor, `weights ${weights.join(",")} of ${minor}`);
  }
});
