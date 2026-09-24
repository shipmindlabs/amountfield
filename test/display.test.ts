/**
 * Showing an amount: where the locale puts the currency, how it writes a
 * negative one, and the fact that none of it comes back.
 *
 * The assertions are about placement and shape rather than whole strings where
 * the whole string is CLDR's to change: whether de-DE separates the symbol with
 * a no-break space is not this library's decision.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { display, placementOf } from "../src/display.ts";
import { blurred, typed, type FieldOptions } from "../src/field.ts";
import { parse, type Money } from "../src/money.ts";

const eur: FieldOptions = { currency: "EUR", locale: "en-US" };

function amount(text: string, currency = "EUR"): Money {
  const result = parse(text, { currency });
  assert.equal(result.ok, true, `expected "${text}" to parse`);
  return (result as { ok: true; money: Money }).money;
}

test("the currency goes where the locale puts it, not where a table says", () => {
  const price = amount("1234.50");
  const american = display(price, { locale: "en-US" });
  const german = display(price, { locale: "de-DE" });

  assert.ok(american.startsWith("\u20AC"), american);
  assert.ok(american.includes("1,234.50"), american);
  assert.ok(german.endsWith("\u20AC"), german);
  assert.ok(german.includes("1.234,50"), german);

  assert.equal(placementOf("EUR", { locale: "en-US" }).position, "before");
  assert.equal(placementOf("EUR", { locale: "de-DE" }).position, "after");
  assert.equal(placementOf("EUR", { locale: "de-DE" }).mark, "\u20AC");
  // en-US writes nothing between the two; de-DE writes a space of its choosing.
  assert.equal(placementOf("EUR", { locale: "en-US" }).spacing, "");
  assert.match(placementOf("EUR", { locale: "de-DE" }).spacing, /\s/);
});

test("a narrow symbol is the one without the country in front of it", () => {
  const fee: Money = { minor: 123450n, currency: "CAD", exponent: 2 };

  assert.ok(display(fee, { locale: "en-US" }).startsWith("CA$"));
  const narrow = display(fee, { locale: "en-US", currencyDisplay: "narrowSymbol" });
  assert.ok(narrow.startsWith("$"), narrow);
  assert.ok(!narrow.includes("CA"), narrow);
  assert.ok(display(fee, { locale: "en-US", currencyDisplay: "code" }).includes("CAD"));
  assert.equal(placementOf("CAD", { locale: "en-US", currencyDisplay: "narrowSymbol" }).mark, "$");
});

// Brackets on a German balance sheet would be an American habit imposed on it.
test("an accounting negative is the locale's convention, not parentheses everywhere", () => {
  const refund = amount("-1234.50");

  const brackets = display(refund, { locale: "en-US", negative: "accounting" });
  assert.ok(brackets.startsWith("(") && brackets.endsWith(")"), brackets);
  assert.ok(!brackets.includes("-"), brackets);
  assert.ok(brackets.includes("1,234.50"), brackets);

  const german = display(refund, { locale: "de-DE", negative: "accounting" });
  assert.ok(!german.includes("("), german);
  assert.match(german, /[-\u2212]/);

  // The sign is the default, and neither style touches a positive amount.
  assert.match(display(refund, { locale: "en-US" }), /[-\u2212]/);
  assert.equal(
    display(amount("1234.50"), { locale: "en-US", negative: "accounting" }),
    display(amount("1234.50"), { locale: "en-US" }),
  );
});

test("the decimals shown are the amount's, not what Intl assumes about the code", () => {
  const yen = display({ minor: 1200n, currency: "JPY", exponent: 0 }, { locale: "ja-JP" });
  assert.ok(yen.includes("1,200"), yen);
  assert.ok(!yen.includes("."), yen);

  assert.ok(display(amount("1.234", "KWD"), { locale: "en-US" }).includes("1.234"));

  // An override is the caller saying this currency is not the usual two.
  const whole = display({ minor: 1234n, currency: "EUR", exponent: 0 }, { locale: "en-US" });
  assert.ok(whole.includes("1,234"), whole);
  assert.ok(!whole.includes(".00"), whole);
});

test("display goes through the decimal string too, so nothing is a float", () => {
  const big = display(amount("999999999999.99"), { locale: "en-US" });
  assert.ok(big.includes("999,999,999,999.99"), big);
  assert.ok(display(amount("1234.50"), { locale: "en-US", grouping: false }).includes("1234.50"));
});

// The one-way rule: what is shown is for reading, and the value it came from is
// untouched by it.
test("what is shown never feeds back into the value", () => {
  const shown = display(amount("-1234.50"), { locale: "en-US", negative: "accounting" });
  const back = typed(shown, eur);
  assert.equal(back.money, null, shown);
  assert.equal(back.incomplete, false, `"${shown}" is wrong rather than unfinished`);
  assert.ok(back.problem !== null);

  // And the field's own text never grows a currency of its own on blur.
  assert.equal(blurred(typed("1234.5", eur), eur).text, "1,234.50");
});
