/**
 * The transitions an input actually goes through: a rewrite under the caret,
 * and a paste that carries more than a number.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { blurred, caretAfter, initial, sanitise, typed, type FieldOptions } from "../src/field.ts";
import { parse, type Money } from "../src/money.ts";

const eur: FieldOptions = { currency: "EUR", locale: "en-US" };
const de: FieldOptions = { currency: "EUR", locale: "de-DE" };
const usd: FieldOptions = { currency: "USD", locale: "en-US" };
const jpy: FieldOptions = { currency: "JPY", locale: "ja-JP" };

function amount(text: string, options: FieldOptions): Money {
  const result = parse(text, options);
  assert.equal(result.ok, true, `expected "${text}" to parse`);
  return (result as { ok: true; money: Money }).money;
}

test("a caret nothing rewrote stays where the browser put it", () => {
  const state = typed("1234.5", eur, 3);
  assert.equal(state.text, "1234.5");
  assert.equal(state.caret, 3);
  // With no caret to go on, it is at the end — where typing leaves it.
  assert.equal(typed("12.34", eur).caret, 5);
});

test("grouping applied on blur takes the caret along with its digits", () => {
  const end = blurred(typed("1234.5", eur, 6), eur);
  assert.equal(end.text, "1,234.50");
  // After the "5" the person typed, not after the cent it gained.
  assert.equal(end.caret, 7);

  const middle = blurred(typed("1234.5", eur, 4), eur);
  assert.equal(middle.text.slice(0, middle.caret), "1,234");
});

test("a caret behind a trailing separator stays behind it", () => {
  const state = blurred(typed("12.", eur, 3), eur);
  assert.equal(state.text, "12.00");
  assert.equal(state.caret, 3);
});

test("a caret in front of the number stays in front of it", () => {
  const state = blurred(typed("1234", eur, 0), eur);
  assert.equal(state.text, "1,234.00");
  assert.equal(state.caret, 0);
});

test("the caret follows the digits rather than the characters", () => {
  assert.equal(caretAfter("1234", 2, "1,234", eur), 3);
  assert.equal(caretAfter("1234", 4, "1,234", eur), 5);
  assert.equal(caretAfter("12", 2, "", eur), 0);
});

test("a paste loses the field's own currency and the space in front", () => {
  const pasted = typed("\u20AC 1.234,56", de);
  assert.equal(pasted.text, "1.234,56");
  assert.equal(pasted.money?.minor, 123456n);
  assert.equal(pasted.caret, pasted.text.length);

  assert.equal(typed("\u20AC\u00A01.234,56", de).money?.minor, 123456n);
  assert.equal(typed("1.234,56 EUR", de).money?.minor, 123456n);
  assert.equal(typed("$12.34", usd).money?.minor, 1234n);
  assert.equal(typed("1200 JPY", jpy).money?.minor, 1200n);
  assert.equal(sanitise("  12.34", eur), "12.34");
});

// The currency belongs to the field, so only the field's own is stripped.
test("a currency that is not the field's stays in the text, and is refused", () => {
  const foreign = typed("$12.34", eur);
  assert.equal(foreign.text, "$12.34");
  assert.equal(foreign.money, null);
  assert.equal(foreign.incomplete, false);
  assert.equal(foreign.problem, "not-a-number");
});

test("a minus that is not the ASCII one is still a minus", () => {
  assert.equal(typed("\u221245,60", de).money?.minor, -4560n);
  assert.equal(typed("\uFF0D45,60", de).money?.minor, -4560n);
  assert.equal(sanitise("\u201312", eur), "-12");
});

test("the caret keeps its place while a paste is cleaned up", () => {
  // Dropped after the "1.2" of "€ 1.234,56".
  const state = typed("\u20AC 1.234,56", de, 5);
  assert.equal(state.text, "1.234,56");
  assert.equal(state.text.slice(0, state.caret), "1.2");
});

// A space inside the number is grouping, and a half-typed group is unfinished
// rather than wrong — so sanitising must not touch it.
test("a space inside the number survives sanitising", () => {
  assert.equal(typed("1 234.56", eur).money?.minor, 123456n);
  const half = typed("1 2", eur);
  assert.equal(half.text, "1 2");
  assert.equal(half.incomplete, true);
  assert.equal(half.problem, null);
});

test("a field that starts with an amount starts with the caret after it", () => {
  assert.equal(initial(de).caret, 0);
  const start = initial(de, amount("1234.56", eur));
  assert.equal(start.text, "1.234,56");
  assert.equal(start.caret, start.text.length);
});
