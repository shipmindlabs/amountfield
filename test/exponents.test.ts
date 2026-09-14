import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPONENTS,
  exponentOf,
  MissingCurrency,
  UnknownCurrency,
} from "../src/exponents.ts";
import { parse } from "../src/money.ts";

test("the bundled table knows that two decimals is not a law", () => {
  assert.equal(exponentOf("EUR"), 2);
  assert.equal(exponentOf("JPY"), 0);
  assert.equal(exponentOf("KWD"), 3);
  assert.equal(exponentOf("CLF"), 4);
  // A code is a code, however it was typed or pasted.
  assert.equal(exponentOf("jpy"), 0);
  assert.equal(exponentOf(" eur "), 2);
});

test("every row of the table is a plausible one", () => {
  for (const [code, exponent] of Object.entries(EXPONENTS)) {
    assert.match(code, /^[A-Z]{3}$/);
    assert.ok(Number.isInteger(exponent) && exponent >= 0 && exponent <= 4, code);
  }
});

// The override is a parameter, not a hole in the table.
test("the table cannot be edited in place", () => {
  assert.throws(() => {
    (EXPONENTS as Record<string, number>)["XYZ"] = 2;
  });
});

test("a currency code is required rather than defaulted", () => {
  for (const bad of ["", "   ", "EU", "EURO", "E1R", "\u20AC", undefined as unknown as string]) {
    assert.throws(() => exponentOf(bad), MissingCurrency, `"${bad}" was accepted`);
  }
});

test("a currency the table does not carry is refused, never given two decimals", () => {
  assert.throws(() => exponentOf("XYZ"), UnknownCurrency);
  assert.throws(() => exponentOf("XYZ", () => undefined), UnknownCurrency);
  assert.throws(() => exponentOf("XYZ", {}), UnknownCurrency);
});

test("the override answers in whichever shape the caller has", () => {
  assert.equal(exponentOf("XYZ", 3), 3);
  assert.equal(exponentOf("XYZ", { XYZ: 3 }), 3);
  assert.equal(exponentOf("xyz", (code) => (code === "XYZ" ? 3 : undefined)), 3);
  // An override outranks the table when it has something to say.
  assert.equal(exponentOf("JPY", 2), 2);
  assert.equal(exponentOf("EUR", { EUR: 0 }), 0);
  // And a lookup with nothing to say defers to the table, not to two.
  assert.equal(exponentOf("JPY", () => undefined), 0);
});

test("an implausible override is refused rather than used", () => {
  for (const bad of [2.5, -1, 7, Number.NaN]) {
    assert.throws(() => exponentOf("XYZ", bad), RangeError, `${bad} was accepted`);
  }
});

test("parsing carries the override all the way to the amount", () => {
  const result = parse("1.234", { currency: "xyz", exponent: { XYZ: 3 } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.money.minor, 1234n);
  assert.equal(result.money.exponent, 3);
  assert.equal(result.money.currency, "XYZ");
});

test("parsing refuses a missing currency as loudly as an unknown one", () => {
  assert.throws(() => parse("10.00", { currency: "" }), MissingCurrency);
  assert.throws(() => parse("10.00", { currency: "XYZ" }), UnknownCurrency);
});
