/**
 * The three things that go wrong in a money input, and what this does instead.
 *
 *   npm run demo
 */

import { format, parse, toDecimalString } from "../src/index.ts";
import { blurred, typed } from "../src/index.ts";

const eur = { currency: "EUR", locale: "en-US" };
const de = { currency: "EUR", locale: "de-DE" };
const fr = { currency: "EUR", locale: "fr-FR" };

console.log("1. floats");
const a = parse("0.10", eur);
const b = parse("0.20", eur);
if (a.ok && b.ok) {
  console.log(`   0.1 + 0.2 as JavaScript numbers : ${0.1 + 0.2}`);
  console.log(`   as minor units                  : ${a.money.minor + b.money.minor} cents`);
}

console.log("\n2. minor units");
for (const [currency, text] of [["EUR", "12.34"], ["JPY", "1200"], ["KWD", "1.234"]] as const) {
  const parsed = parse(text, { currency });
  if (parsed.ok) {
    console.log(
      `   ${currency} ${text.padEnd(6)} -> ${String(parsed.money.minor).padStart(6)} minor units` +
        ` (exponent ${parsed.money.exponent})`,
    );
  }
}
const unknown = (() => {
  try {
    parse("10.00", { currency: "XYZ" });
    return "accepted";
  } catch (error) {
    return (error as Error).message.split(":")[0];
  }
})();
console.log(`   XYZ            -> ${unknown}`);
const overridden = parse("1.234", { currency: "XYZ", exponent: { XYZ: 3 } });
if (overridden.ok) {
  console.log(
    `   XYZ ${"1.234".padEnd(6)} -> ${String(overridden.money.minor).padStart(6)} minor units` +
      ` (exponent ${overridden.money.exponent}, yours)`,
  );
}

console.log("\n3. separators");
const american = parse("1,234.56", eur);
const german = parse("1.234,56", de);
const french = parse("1 234,56", fr);
if (american.ok && german.ok && french.ok) {
  console.log(`   "1,234.56" en-US -> ${toDecimalString(american.money)}`);
  console.log(`   "1.234,56" de-DE -> ${toDecimalString(german.money)}`);
  console.log(`   "1 234,56" fr-FR -> ${toDecimalString(french.money)}`);
  const same =
    american.money.minor === german.money.minor && german.money.minor === french.money.minor;
  console.log(`   same amount: ${same}`);
}

console.log("\n4. typing, then leaving the field");
let state = typed("1234.5", eur);
console.log(`   while typing : text="${state.text}" amount=${state.money?.minor} cents`);
state = blurred(state, eur);
console.log(`   after blur   : text="${state.text}"`);
const halfway = typed("-", eur);
console.log(`   just a minus : incomplete=${halfway.incomplete} error=${halfway.problem}`);
const halfFraction = typed("12,5", de);
console.log(`   "12,5" in de-DE: ${halfFraction.money?.minor} cents, error=${halfFraction.problem}`);
const halfGroup = typed("1 2", fr);
console.log(`   "1 2" in fr-FR : incomplete=${halfGroup.incomplete} error=${halfGroup.problem}`);
const wrong = typed("12.345", eur);
console.log(`   three decimals: error=${wrong.problem}`);
console.log(`\n   formatted with currency: ${state.money ? format(state.money, { locale: "de-DE", withCurrency: true }) : ""}`);
