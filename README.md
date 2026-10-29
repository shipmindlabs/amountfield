# amountfield

A money input for React that never holds a float, and never assumes a currency
has two decimals.

Three things go wrong in every money field, and only the first is well known.

```console
$ npm run demo
1. floats
   0.1 + 0.2 as JavaScript numbers : 0.30000000000000004
   as minor units                  : 30 cents

2. minor units
   EUR 12.34  ->   1234 minor units (exponent 2)
   JPY 1200   ->   1200 minor units (exponent 0)
   KWD 1.234  ->   1234 minor units (exponent 3)
   XYZ            -> unknown currency "XYZ"
   XYZ 1.234  ->   1234 minor units (exponent 3, yours)

3. separators
   "1,234.56" en-US -> 1234.56
   "1.234,56" de-DE -> 1234.56
   "1 234,56" fr-FR -> 1234.56
   same amount: true
```

**Floats.** A total that is a cent off for reasons the user cannot see. Amounts
here are `bigint` counts of minor units, and even the formatting goes through a
decimal string rather than a number.

**Minor units.** Code that multiplies by 100 is wrong in Tokyo, where JPY has no
decimals, and in Kuwait, where KWD has three. An unknown currency is **refused**
rather than assumed to have two, because a wrong amount is worse than an error.

**Separators.** `1.234,56` and `1,234.56` are the same amount written by two
people. The separators come from `Intl`, so there is no table here to fall out
of date. A space is grouping too — fr-FR writes `1 234,56` — and it is read as
grouping wherever it is typed, because it is a decimal point in no locale at
all. And a decimal disguised as grouping — `12.34` typed into a de-DE field —
is **refused** rather than read as 1234.00: a group separator is only stripped
where the digits are actually grouped, final group of three, no group longer.

## Use

```tsx
import { useAmountField } from "amountfield";

function PriceField() {
  const field = useAmountField({ currency: "EUR", locale: "de-DE" });
  return (
    <>
      <input {...field.inputProps} />
      {field.problem && <span role="alert">{field.problem}</span>}
    </>
  );
}
```

`field.money` is the exact amount or `null`. `field.incomplete` distinguishes
*not finished yet* from *wrong*, which is the difference between a calm field
and one that turns red between the `.` and the `5` of `12.50`. Spread
`inputProps` rather than picking fields out of it: the `ref` it carries is how
the caret gets put back after the text is rewritten.

## The money model

An amount is three things, and all three travel together:

```ts
type Money = {
  readonly minor: bigint;    // 1234
  readonly currency: string; // "EUR"
  readonly exponent: number; // 2
};
```

**Minor units, because money is counted rather than measured.** There is no such
thing as half a cent in a ledger, so the value is a whole number of the
currency's smallest unit — cents, yen, fils — and never a fraction of a major
one. `0.1 + 0.2` is a famous example, but the expensive version is dull: a
hundred invoice lines, each off by less than a cent, and a total that disagrees
with the sum of its own rows. A sum of integers cannot do that. Nothing in this
library converts an amount to `number`, including `format`, which hands `Intl` a
decimal string.

**The exponent, because the count on its own is ambiguous.** `1234` minor units
is three different amounts:

| currency | exponent | `1234` minor units is | and `"1200"` typed is |
|---|---|---|---|
| JPY | 0 | ¥1,234 | 1200 minor units |
| EUR | 2 | €12.34 | 120000 minor units |
| KWD | 3 | 1.234 KWD | 1200000 minor units |

So the exponent is carried on the amount rather than looked up again wherever the
amount lands. It is also why `add` refuses two amounts whose exponents differ
even when the codes match: one of them came from an override, and the two numbers
are a factor of a hundred apart.

**No default, because the only safe default is an error.** The currency is a
required option, and a code the bundled ISO 4217 table does not carry is refused.
These two refusals `throw` rather than coming back as a parse failure, because
they are mistakes in the calling code and not something the person typing can fix:

```ts
parse("10.00", { currency: "" });    // MissingCurrency
parse("10.00", { currency: "XYZ" }); // UnknownCurrency
```

The table ships JPY 0, KWD 3, CLF 4 and the codes most products meet — one in
three of them is not two decimals, which is the whole reason guessing is not an
option. For a code it does not carry, or to overrule one it does, the override
takes whichever shape the caller has:

```ts
parse("10.000", { currency: "XYZ", exponent: 3 });                    // this one currency
parse("10.000", { currency: "XYZ", exponent: { XYZ: 3 } });           // your own table
parse("10.000", { currency: "XYZ", exponent: (code) => mine[code] }); // your own lookup
```

A lookup that returns `undefined` falls back to the bundled table, so a hook can
add currencies without restating the ones that are already right. `useAmountField`
takes the same `exponent` option and passes it through, so a field for a currency
the table has never heard of needs no fork.

### The JPY bug

Every money field starts life as this line:

```ts
const minor = Math.round(Number(text) * 100); // the bug
```

In a EUR or USD field it is right, which is exactly why it ships. Then the
product opens in Tokyo:

- Someone types `1200` into a JPY field. The line makes it `120000`, and a
  payment API that counts minor units — as they do — charges **¥120,000 for a
  ¥1,200 order**. Not a rounding error: a factor of a hundred.
- The same mistake run backwards is a ¥1,200 balance displayed as `12.00`, and a
  support ticket nobody can reproduce in euros.
- Kuwait is worse because it is quieter. `1.234` KWD is 1234 fils; the line
  computes `123.4`, rounds it to `123`, and the amount is now a tenth of what was
  typed with the rounding politely hiding the lost digit.

Here the exponent comes from the currency before any arithmetic happens, and
`"1200"` in a JPY field is 1200 minor units because JPY's exponent is 0. There is
no `* 100` anywhere in the library, and no `/ 100` on the way back out:
`toDecimalString` moves the decimal point through the digits as text.

JPY is not an exotic case to handle later. The bundled table alone carries
sixteen currencies with no decimals — BIF, CLP, DJF, GNF, ISK, JPY, KMF, KRW,
PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF — and seven with three. A field that
assumes two is wrong in a third of the world and silent about it.

## Wiring it into a form library

The hook owns the text in the input; the form owns the amount. That split is
what keeps the caret and the half-typed states working, and it has one
consequence: `register()`-style uncontrolled binding will not do. The input is
controlled, its `onChange` carries the caret position, and the value the form
wants is a `Money`, not a string. So bind it through a controlled adapter —
`Controller` in react-hook-form, `useField` in Formik, whatever the library calls
it:

```tsx
import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { useAmountField, type Money } from "amountfield";

const same = (left: Money | null, right: Money | null) =>
  left?.minor === right?.minor && left?.currency === right?.currency;

function AmountInput({
  value,
  onChange,
}: {
  value: Money | null;
  onChange: (money: Money | null) => void;
}) {
  const field = useAmountField({ currency: "EUR", locale: "de-DE" }, value ?? undefined);
  const agreed = useRef(value);

  // Outwards: the text turned into a different amount. Comparing first means a
  // keystroke that leaves the amount alone — or the grouping blur adds — does
  // not mark the form dirty.
  useEffect(() => {
    if (same(field.money, agreed.current)) return;
    agreed.current = field.money;
    onChange(field.money);
  }, [field.money, onChange]);

  // Inwards: the form was reset. The second argument to the hook is the initial
  // amount and is read once, so one that arrives later is pushed in.
  useEffect(() => {
    if (same(value, agreed.current)) return;
    agreed.current = value;
    field.setMoney(value);
  }, [value, field.setMoney]);

  return (
    <>
      <input {...field.inputProps} name="price" />
      {field.problem && <span role="alert">{MESSAGES[field.problem]}</span>}
    </>
  );
}

function OrderForm() {
  const { control, handleSubmit } = useForm<{ price: Money | null }>();
  return (
    <form onSubmit={handleSubmit(submit)}>
      <Controller
        name="price"
        control={control}
        defaultValue={null}
        rules={{ validate: (money) => money !== null || "enter an amount" }}
        render={({ field }) => <AmountInput value={field.value} onChange={field.onChange} />}
      />
    </form>
  );
}
```

Spread `inputProps` first and add your own `name`, `id` or `onFocus` after it;
do not replace the `ref`, the `value` or the `onChange`, which are how the caret
survives a rewrite.

**Required is the form's rule, not the field's.** An empty field is unfinished
rather than wrong, so `field.problem` is `null` and nothing is marked invalid
while the person has not started. Emptiness becomes an error when the form is
submitted, which is where `validate` above puts it.

**The messages are yours.** `field.problem` is a reason code, so the copy can be
written and translated where the rest of the copy lives:

| reason | what it means |
|---|---|
| `too-many-decimals` | more decimals than the currency has: `12.5` in JPY, `1.2345` in KWD |
| `too-many-separators` | two decimal points in one number |
| `bad-grouping` | a group separator where the digits are not grouped: `12 3456` |
| `not-a-number` | characters an amount cannot contain, including a currency that is not the field's |
| `empty` | nothing to read — `parse` only; a field reports this as incomplete |
| `above-maximum` | larger than the field's `max`, reported while typing |
| `below-minimum` | smaller than the field's `min`, reported on blur |

**Submit the minor units, not a decimal.** `JSON.stringify` throws on a `bigint`,
which is a useful nudge: send the count as a string and the exponent beside it,
and the other end needs no opinion about how many decimals the currency has.

```ts
const submit = ({ price }: { price: Money }) =>
  post("/orders", {
    amount: String(price.minor), // "123450"
    currency: price.currency,
    exponent: price.exponent,
  });
```

## Four behaviours worth knowing

**The text is never rewritten while you type.** Reformatting mid-entry is what
makes a field jump the caret and eat a digit. Grouping is applied on blur, when
the value has stopped moving:

```
while typing : text="1234.5"   amount=123450 cents
after blur   : text="1,234.50"
```

**Half-typed input is a state, not a mistake.** `12.` is twelve, and becomes
`12.00` on blur. `12,5` in de-DE is twelve fifty while the last digit is still
missing. `1 2` in fr-FR is a group that has not reached three digits yet, so it
is unfinished rather than wrong — and the currency is never read out of the
text, so a pasted `$12.34` in a EUR field is refused rather than believed.

**The caret survives the rewrites there are.** Text does get rewritten — blur
applies grouping, a pasted symbol disappears — and a field that then drops the
caret at the end is worse than one that never reformats at all. The caret is put
back after the same digits it was after before, so `1234.5|` becomes `1,234.5|0`
rather than `1,234.50|`, and a caret in front of the number is still in front of
it once the number has grown a group separator.

**A paste is cleaned up, not translated.** `€ 1.234,56` copied out of an invoice
loses the symbol and the non-breaking space behind it, `−45,60` loses the minus
sign that is not the ASCII one, and the digits are read by the locale as always.
Only the field's own currency is stripped, by symbol or by code: `$12.34` in a
EUR field still has a dollar sign in it, and is refused rather than quietly
taken for euros.

## Min and max

A field can carry its own bounds, as amounts in its own currency:

```ts
useAmountField({ currency: "EUR", locale: "de-DE", min: tenEuros, max: thousandEuros });
```

They are compared as counts of minor units, so a bound in another currency — or
with an exponent an override moved — is refused the way `add` refuses to add two
such amounts: it throws `CurrencyMismatch` or `ExponentMismatch`, because it is
a mistake in the calling code rather than something the person typing can fix.

The two sides are not symmetrical, because typing is not. Above the maximum is
wrong at once: `1000.01` in a field that stops at `1000` cannot be rescued by
typing more digits, which only make the number larger. Below the minimum is
**unfinished** rather than wrong — `1` is on the way to `100` — so
`field.incomplete` is true, nothing is marked invalid, and the field reports
`below-minimum` on blur, when the value has stopped moving.

The amount is there in either case: `field.money` is what the text says, and
`field.problem` is whether the field accepts it. `aria-invalid` follows
`problem`, as it does for a number that cannot be read at all.

## Showing an amount

Holding an amount and showing one are different jobs. A field's own text carries
no currency, because a symbol written into the value fights the person typing; a
table, an invoice or a total is `display`:

```ts
import { display, placementOf } from "amountfield";

display(price, { locale: "en-US" });                          // "€1,234.50"
display(price, { locale: "de-DE" });                          // "1.234,50 €"
display(refund, { locale: "en-US", negative: "accounting" }); // "(1,234.50)"
display(fee, { locale: "en-US", currencyDisplay: "narrowSymbol" });  // CAD as "$"
placementOf("EUR", { locale: "de-DE" });
// { mark: "€", position: "after", spacing: "\u00a0" }
```

Where the mark goes is the locale's answer rather than a table here, and so is
how a negative amount is written: `accounting` asks for the local convention —
parentheses in en-US, a minus in de-DE — rather than putting a German balance
sheet in American brackets. The decimals shown are the amount's own, so a JPY
total is not given the two `Intl` assumes for the code, and an overridden
exponent is shown as the override says. `placementOf` hands back the pieces for a
caller laying them out itself — a symbol in its own column, digits right-aligned
beside it.

It goes one way only. The value stays in minor units, nothing here is ever read
back, and a display string pasted into a field is refused there rather than
half-understood.

## Arithmetic

Amounts add up as whole minor units, so a total cannot drift. Splitting one is
where money is usually lost:

```ts
import { add, allocate, multiply } from "amountfield";

add(price, shipping);                 // exact, and refuses to mix currencies
multiply(price, "0.19", "half-even"); // the ratio is text, never a float
allocate(fiveCents, 3);               // 2, 2, 1 — still five cents
```

`allocate` hands out every minor unit and invents none. Shares are floored and
the leftover units go to the largest remainders, so the parts sum back to the
original exactly — for equal parts, for weights like `[3, 7]`, and for negative
amounts — and no two equal shares are more than one unit apart.

`multiply` will not round behind your back. Nineteen percent of `99.99` is not a
whole number of cents, and which way that goes is a business decision, so
without a rounding mode it throws instead of choosing one: `half-even`,
`half-up`, `down`, `up`, `floor`, `ceil`. A ratio is a string, a `bigint`, a
whole `number`, or `{ numerator, denominator }` for the ones no decimal can
write. The JavaScript number `0.1` is not 0.1, so it is refused with a message
saying which form to write instead.

## What it is not

**Not a styled component.** It returns props for an `<input>` and no markup, so
it fits whatever design system is already there.

**Not a currency converter, and not a rounding policy.** It reads and writes one
amount in one currency, and refuses to add two. What to do with a fraction of a
cent is a business decision, so `multiply` asks for the rounding mode rather
than quietly having one.

**Not a full ISO 4217 table.** It ships the currencies most products meet and
refuses the rest until you pass the exponent yourself. That refusal is the
feature: a silent default of two decimals is the bug it exists to prevent.

## Status

| | |
|---|---|
| Core | exact parsing and formatting in minor units, ISO 4217 exponents with an explicit override, locale separators via `Intl`, partial input while typing, negative amounts, `Money` as `bigint` |
| Display | `display` with the locale's symbol placement, accounting negatives, narrow symbols and the amount's own decimals; `placementOf` for laying the pieces out by hand |
| Arithmetic | `add`, `subtract`, `multiply` by an exact ratio with an explicit rounding mode, and `allocate` by largest remainder |
| Field | pure state machine: typing, blur, incomplete versus invalid, initial value, the caret kept across a rewrite, a paste stripped of the field's own currency and of a unicode minus, per-field `min` and `max` |
| React | `useAmountField` returning `inputProps`, including the `ref` the caret is restored through, tested with a real render |
| Not yet | a masked variant, currency selection inside the field |

The core is dependency-free and covers everything worth testing; the hook is
deliberately thin so there is nothing in it to get wrong.

## Development

```bash
npm test        # node --test, including a real React render
npm run demo
npm run typecheck
```

## License

MIT © [Shipmind Labs](https://shipmindlabs.com)
