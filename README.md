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
and one that turns red between the `.` and the `5` of `12.50`.

## The currency, and its exponent

The currency code is required — there is nothing sensible to fall back to — and
its exponent comes from a bundled ISO 4217 table: JPY 0, KWD 3, CLF 4, and the
codes most products meet. A code the table does not carry is refused, and the
override takes whichever shape the caller has:

```ts
parse("10.000", { currency: "XYZ", exponent: 3 });                    // this one currency
parse("10.000", { currency: "XYZ", exponent: { XYZ: 3 } });           // your own table
parse("10.000", { currency: "XYZ", exponent: (code) => mine[code] }); // your own lookup
```

A lookup that returns `undefined` falls back to the bundled table, so a hook can
add currencies without restating the ones that are already right.

## Two behaviours worth knowing

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

## What it is not

**Not a styled component.** It returns props for an `<input>` and no markup, so
it fits whatever design system is already there.

**Not a currency converter, and not a rounding policy.** It reads and writes one
amount in one currency. What to do with fractions of a cent in a total is a
business decision this cannot make.

**Not a full ISO 4217 table.** It ships the currencies most products meet and
refuses the rest until you pass the exponent yourself. That refusal is the
feature: a silent default of two decimals is the bug it exists to prevent.

## Status

| | |
|---|---|
| Core | exact parsing and formatting in minor units, ISO 4217 exponents with an explicit override, locale separators via `Intl`, partial input while typing, negative amounts, `Money` as `bigint` |
| Field | pure state machine: typing, blur, incomplete versus invalid, initial value |
| React | `useAmountField` returning `inputProps`, tested with a real render |
| Not yet | caret preservation when grouping is applied on every keystroke, a masked variant, per-field min and max, currency selection inside the field |

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
