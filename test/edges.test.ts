/**
 * The edges a money field meets in the world: a currency with no decimals, one
 * with three, an amount pasted out of an invoice with the symbol still on it,
 * and digits that are not the ASCII ones.
 *
 * These are the cases a field that assumed two decimals, a dot and Latin digits
 * gets wrong quietly, which is the only way getting it wrong really matters.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { placementOf } from "../src/display.ts";
import { blurred, sanitise, typed, type FieldOptions } from "../src/field.ts";
import { format, isIncomplete, parse, toDecimalString, type Money } from "../src/money.ts";

const eur: FieldOptions = { currency: "EUR", locale: "en-US" };
const de: FieldOptions = { currency: "EUR", locale: "de-DE" };
const fr: FieldOptions = { currency: "EUR", locale: "fr-FR" };
const jpy: FieldOptions = { currency: "JPY", locale: "ja-JP" };
const kwd: FieldOptions = { currency: "KWD", locale: "en-US" };
const kwdInGerman: FieldOptions = { currency: "KWD", locale: "de-DE" };

function amount(text: string, options: FieldOptions): Money {
  const result = parse(text, options);
  assert.equal(result.ok, true, `expected "${text}" to parse`);
  return (result as { ok: true; money: Money }).money;
}

function failure(text: string, options: FieldOptions): string {
  const result = parse(text, options);
  assert.equal(result.ok, false, `"${text}" was accepted`);
  return (result as { ok: false; reason: string }).reason;
}

test("a currency with no decimals has no cents to type", () => {
  const yen = amount("1200", jpy);
  assert.equal(yen.minor, 1200n);
  assert.equal(yen.exponent, 0);
  assert.equal(toDecimalString(yen), "1200");
  assert.equal(amount("1,200", jpy).minor, 1200n);

  // A tenth of a yen does not exist, and more typing cannot turn it into
  // something that does — so it is wrong rather than unfinished.
  assert.equal(failure("12.5", jpy), "too-many-decimals");
  assert.equal(isIncomplete("12.5", jpy), false);
  const state = typed("1200.5", jpy);
  assert.equal(state.money, null);
  assert.equal(state.problem, "too-many-decimals");
  assert.equal(state.incomplete, false);

  // A half-typed group is unfinished in a yen field like any other.
  const group = typed("1,2", jpy);
  assert.equal(group.incomplete, true);
  assert.equal(group.problem, null);
  assert.equal(failure("12 00", jpy), "bad-grouping");
});

test("a separator a yen field has nothing to put after disappears on blur", () => {
  const trailing = typed("1200.", jpy);
  assert.equal(trailing.money?.minor, 1200n);

  const end = blurred(trailing, jpy);
  assert.equal(end.text, "1,200");
  assert.ok(!end.text.includes("."), end.text);
});

test("a currency with three decimals keeps all three", () => {
  const dinar = amount("1.234", kwd);
  assert.equal(dinar.minor, 1234n);
  assert.equal(dinar.exponent, 3);
  assert.equal(toDecimalString(dinar), "1.234");
  assert.equal(amount("1,234.567", kwd).minor, 1234567n);
  assert.equal(failure("1.2345", kwd), "too-many-decimals");

  // The same text, two currencies: 234 fils in Kuwait, and a third decimal
  // the euro does not have.
  assert.equal(failure("1.234", eur), "too-many-decimals");

  // Grouping and decimals are the locale's, the exponent is the currency's.
  assert.equal(amount("1,234", kwd).minor, 1234000n);
  assert.equal(amount("1,234", kwdInGerman).minor, 1234n);
  assert.equal(amount("1.234", kwdInGerman).minor, 1234000n);
});

test("a fraction shorter than the exponent is padded, not refused", () => {
  assert.equal(amount("1.2", kwd).minor, 1200n);
  assert.equal(format(amount("1.2", kwd), { locale: "en-US" }), "1.200");

  // Blur fills the fils in, and the caret stays in front of the ones it gained.
  const end = blurred(typed("1.2", kwd, 3), kwd);
  assert.equal(end.text, "1.200");
  assert.equal(end.caret, 3);
});

// The line copied out of an invoice: grouped with a space, a comma for the
// decimal, and the symbol trailing behind it.
test("a pasted \"1 234,56 \u20AC\" is the amount it looks like", () => {
  const pasted = typed("1 234,56 \u20AC", de);
  assert.equal(pasted.money?.minor, 123456n);
  assert.equal(pasted.problem, null);
  assert.ok(!pasted.text.includes("\u20AC"), pasted.text);
  // The caret lands after the last digit, not where the symbol used to be.
  assert.equal(pasted.text.slice(0, pasted.caret), "1 234,56");

  // The same amount with the spaces a PDF really uses, and the symbol in front.
  assert.equal(typed("1\u00A0234,56\u00A0\u20AC", fr).money?.minor, 123456n);
  assert.equal(typed("1\u202F234,56\u00A0\u20AC", fr).money?.minor, 123456n);
  assert.equal(typed("\u20AC\u00A01 234,56", de).money?.minor, 123456n);
});

test("a paste loses the currency the field already knows, whatever its mark", () => {
  const yenMark = placementOf("JPY", { locale: "ja-JP" }).mark;
  const yen = typed(`${yenMark}1,200`, jpy);
  assert.equal(yen.money?.minor, 1200n);
  assert.ok(!yen.text.includes(yenMark), yen.text);

  const dinarMark = placementOf("KWD", { locale: "en-US" }).mark;
  assert.equal(typed(`${dinarMark} 1.234`, kwd).money?.minor, 1234n);
  assert.equal(typed("1.234 KWD", kwd).money?.minor, 1234n);
});

// Refusing is the point: a digit this parser cannot read must not be dropped or
// half-read, because either one changes the amount without saying so.
test("digits that are not ASCII are refused rather than half-read", () => {
  const arabicIndic = "\u0661\u0662\u0663\u0664\u066B\u0665\u0666";
  const egp: FieldOptions = { currency: "EGP", locale: "ar-EG" };

  for (const options of [eur, de, egp]) {
    const state = typed(arabicIndic, options);
    assert.equal(state.money, null, `${options.locale} accepted Arabic-Indic digits`);
    assert.equal(state.problem, "not-a-number", options.locale);
    assert.equal(state.incomplete, false, options.locale);
    assert.equal(state.text, arabicIndic, "the text is left exactly as it was pasted");
  }

  const fullWidth = typed("\uFF11\uFF12\uFF13\uFF14", jpy);
  assert.equal(fullWidth.money, null);
  assert.equal(fullWidth.problem, "not-a-number");
  assert.equal(fullWidth.incomplete, false);
});

test("a minus from a spreadsheet is a minus in any currency", () => {
  assert.equal(typed("\u22121.234", kwd).money?.minor, -1234n);
  assert.equal(typed("\uFF0D1200", jpy).money?.minor, -1200n);
  assert.equal(sanitise("\u22121200", jpy), "-1200");
  assert.equal(toDecimalString(amount("-1.234", kwd)), "-1.234");
});

test("the caret follows the digits across whatever the exponent adds", () => {
  // Yen gain a group separator on blur and nothing else.
  const yen = blurred(typed("1200", jpy, 2), jpy);
  assert.equal(yen.text, "1,200");
  assert.equal(yen.text.slice(0, yen.caret), "1,2");

  // A caret the element reports past the end of the text is clamped, not
  // trusted: setSelectionRange would throw the field's caret away.
  assert.equal(typed("12.34", eur, 99).caret, 5);
  assert.equal(typed("12.34", eur, -3).caret, 0);
});
