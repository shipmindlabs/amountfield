import { test } from "node:test";
import assert from "node:assert/strict";

import {
  exponentOf,
  format,
  parse,
  toDecimalString,
  UnknownCurrency,
  type Money,
} from "../src/money.ts";
import { blurred, initial, typed, type FieldOptions } from "../src/field.ts";

const eur: FieldOptions = { currency: "EUR", locale: "en-US" };
const de: FieldOptions = { currency: "EUR", locale: "de-DE" };
const jpy: FieldOptions = { currency: "JPY", locale: "ja-JP" };

function amount(text: string, options: FieldOptions): Money {
  const result = parse(text, options);
  assert.equal(result.ok, true, `expected "${text}" to parse`);
  return (result as { ok: true; money: Money }).money;
}

test("amounts are exact minor units, never floats", () => {
  assert.equal(amount("12.34", eur).minor, 1234n);
  assert.equal(amount("0.10", eur).minor + amount("0.20", eur).minor, 30n);
  assert.equal(amount("999999999999.99", eur).minor, 99999999999999n);
});

// The bug that multiplying by 100 cannot avoid.
test("currencies without two decimals are handled, not assumed", () => {
  assert.equal(amount("1200", jpy).minor, 1200n);
  assert.equal(exponentOf("JPY"), 0);
  assert.equal(exponentOf("KWD"), 3);

  const kwd = amount("1.234", { currency: "KWD" });
  assert.equal(kwd.minor, 1234n);
  assert.equal(toDecimalString(kwd), "1.234");
});

test("an unknown currency is refused rather than guessed at two decimals", () => {
  assert.throws(() => parse("10.00", { currency: "XYZ" }), UnknownCurrency);
  // Unless the caller supplies the exponent themselves.
  assert.equal(amount("10.00", { currency: "XYZ", exponent: 2 }).minor, 1000n);
});

// "1.234,56" and "1,234.56" are the same amount written by two people.
test("both separator conventions read to the same amount", () => {
  assert.equal(amount("1,234.56", eur).minor, 123456n);
  assert.equal(amount("1.234,56", de).minor, 123456n);
  assert.equal(amount("1234.56", eur).minor, amount("1234,56", de).minor);
});

test("what is not an amount comes back with a reason", () => {
  const cases: Record<string, string> = {
    "": "empty",
    abc: "not-a-number",
    "12.34.56": "too-many-separators",
    "12.345": "too-many-decimals",
    "1,2,3.4.5": "too-many-separators",
  };
  for (const [text, reason] of Object.entries(cases)) {
    const result = parse(text, eur);
    assert.equal(result.ok, false, `"${text}" was accepted`);
    assert.equal((result as { ok: false; reason: string }).reason, reason, `for "${text}"`);
  }
});

test("negative amounts survive the round trip", () => {
  const money = amount("-45.60", eur);
  assert.equal(money.minor, -4560n);
  assert.equal(toDecimalString(money), "-45.60");
});

test("formatting goes through the decimal string, so nothing is a float", () => {
  const money = amount("1234567.89", eur);
  assert.equal(toDecimalString(money), "1234567.89");
  assert.equal(format(money, { locale: "en-US" }), "1,234,567.89");
  assert.equal(format(money, { locale: "de-DE" }), "1.234.567,89");
  assert.equal(format(amount("1200", jpy), { locale: "ja-JP" }), "1,200");
});

// Showing an error to someone who is halfway through typing is the most common
// bug in these components.
test("an unfinished amount is incomplete, not invalid", () => {
  for (const text of ["", "  ", "-"]) {
    const state = typed(text, eur);
    assert.equal(state.incomplete, true, `"${text}" should be incomplete`);
    assert.equal(state.problem, null, `"${text}" should carry no error`);
  }

  const wrong = typed("12.345", eur);
  assert.equal(wrong.incomplete, false);
  assert.equal(wrong.problem, "too-many-decimals");
});

// A separator with nothing after it yet is a complete amount, not a broken one:
// "12." is twelve. Treating it as an error would put a red border on the field
// between the "." and the "5" of "12.50".
test("a trailing separator reads as the whole amount", () => {
  const state = typed("12.", eur);
  assert.equal(state.problem, null);
  assert.equal(state.money?.minor, 1200n);

  const german = typed("12,", de);
  assert.equal(german.money?.minor, 1200n);
});

// Reformatting while someone types is what makes a field jump the caret.
test("typing leaves the text alone and only derives the amount", () => {
  const state = typed("1234.5", eur);
  assert.equal(state.text, "1234.5", "the text must not be rewritten mid-typing");
  assert.equal(state.money?.minor, 123450n);
});

test("reformatting happens on blur, when the value has stopped moving", () => {
  const afterTyping = typed("1234.5", eur);
  const afterBlur = blurred(afterTyping, eur);
  assert.equal(afterBlur.text, "1,234.50");
  assert.equal(afterBlur.money?.minor, 123450n);

  // A trailing separator is completed rather than left ragged.
  assert.equal(blurred(typed("12.", eur), eur).text, "12.00");

  // A field with no amount at all is left exactly as the person left it.
  const empty = typed("-", eur);
  assert.equal(blurred(empty, eur).text, "-");
});

test("a field can start with an amount already in it", () => {
  const state = initial(de, amount("1234.56", eur));
  assert.equal(state.text, "1.234,56");
  assert.equal(state.incomplete, false);
});
