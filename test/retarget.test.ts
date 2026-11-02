/**
 * The options changing under a live field.
 *
 * Locale is presentation and currency is meaning, so the two changes do
 * opposite things to the text: one writes the amount again, the other reads the
 * text again. Getting that backwards is either a language switch that empties
 * the form or a currency switch that charges a hundred times too much.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CurrencyMismatch } from "../src/arithmetic.ts";
import { blurred, initial, retarget, typed, type FieldOptions } from "../src/field.ts";
import { parse, type Money } from "../src/money.ts";

const eur: FieldOptions = { currency: "EUR", locale: "en-US" };
const de: FieldOptions = { currency: "EUR", locale: "de-DE" };
const fr: FieldOptions = { currency: "EUR", locale: "fr-FR" };
const jpy: FieldOptions = { currency: "JPY", locale: "ja-JP" };

function amount(text: string, options: FieldOptions): Money {
  const result = parse(text, options);
  assert.equal(result.ok, true, `expected "${text}" to parse`);
  return (result as { ok: true; money: Money }).money;
}

const bounded: FieldOptions = {
  ...eur,
  min: amount("10.00", eur),
  max: amount("1000.00", eur),
};

// Reading the text again under the new locale would refuse it — "1.234,56" is
// not an en-US number — so the amount is written again instead.
test("a locale change writes the same amount the new way, caret and all", () => {
  const start = blurred(typed("1234,56", de, 7), de);
  assert.equal(start.text, "1.234,56");
  assert.equal(start.caret, 8);
  assert.equal(parse(start.text, eur).ok, false, "the text only reads in de-DE");

  const moved = retarget(start, de, eur);
  assert.equal(moved.money?.minor, 123456n);
  assert.equal(moved.text, "1,234.56");
  assert.equal(moved.problem, null);
  assert.equal(moved.incomplete, false);
  assert.equal(moved.caret, 8);

  // The caret keeps its digits rather than its index: it was behind the decimal
  // separator, whichever character that is now.
  const middle = retarget({ ...start, caret: 6 }, de, eur);
  assert.equal(middle.text.slice(0, middle.caret), "1,234.");

  const french = retarget(start, de, fr);
  assert.match(french.text, /^1\s234,56$/);
  assert.equal(french.money?.minor, 123456n);
});

// The same digits mean something else in another currency, so they are read
// again rather than carried over.
test("a currency change reads the text again rather than keeping the amount", () => {
  const price = blurred(typed("12.50", eur, 5), eur);
  assert.equal(price.money?.minor, 1250n);

  const yen = retarget(price, eur, { currency: "JPY", locale: "en-US" });
  assert.equal(yen.text, "12.50");
  assert.equal(yen.money, null, '"12.50" is not 1250 yen');
  assert.equal(yen.problem, "too-many-decimals");
  assert.equal(yen.incomplete, false);

  // Digits a yen field can read are read, in its own exponent.
  const thousand = retarget(typed("1250", eur), eur, jpy);
  assert.equal(thousand.money?.minor, 1250n);
  assert.equal(thousand.money?.exponent, 0);
});

test("an exponent an override moved is a change of unit too", () => {
  const whole: FieldOptions = { ...eur, exponent: 0 };
  const cents = blurred(typed("12.34", eur, 5), eur);

  const moved = retarget(cents, eur, whole);
  assert.equal(moved.money, null);
  assert.equal(moved.problem, "too-many-decimals");

  const back = retarget(typed("12", whole), whole, eur);
  assert.equal(back.money?.minor, 1200n);
  assert.equal(back.money?.exponent, 2);
});

test("a retarget with nothing complete in it leaves the text to be read again", () => {
  const half = typed("1,", eur);
  assert.equal(half.money, null);
  assert.equal(half.incomplete, true);

  // The same characters are one euro in de-DE, and nothing is rewritten to say so.
  const german = retarget(half, eur, de);
  assert.equal(german.text, "1,");
  assert.equal(german.money?.minor, 100n);
  assert.equal(german.problem, null);

  const empty = retarget(typed("", eur), eur, de);
  assert.equal(empty.text, "");
  assert.equal(empty.money, null);
  assert.equal(empty.incomplete, true);
  assert.equal(empty.problem, null);
});

test("a retarget is judged by the bounds of the field it lands in", () => {
  const germanBounds: FieldOptions = { ...bounded, locale: "de-DE" };

  // An amount that has stopped moving carries its problem into the new locale.
  const low = retarget(initial(bounded, amount("5.00", eur)), bounded, germanBounds);
  assert.equal(low.text, "5,00");
  assert.equal(low.problem, "below-minimum");
  assert.equal(low.incomplete, false);

  const high = retarget(initial(bounded, amount("2000.00", eur)), bounded, germanBounds);
  assert.equal(high.text, "2.000,00");
  assert.equal(high.problem, "above-maximum");

  // One still on its way to the minimum stays calm, as it does while typing.
  const typing = retarget(typed("9", bounded), bounded, germanBounds);
  assert.equal(typing.text, "9,00");
  assert.equal(typing.problem, null);
  assert.equal(typing.incomplete, true);

  // And a bound is an amount in the field's own currency, wherever it is going.
  assert.throws(
    () => retarget(typed("12.34", bounded), bounded, { ...jpy, max: amount("1000.00", eur) }),
    CurrencyMismatch,
  );
});
