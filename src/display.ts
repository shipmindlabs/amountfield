/**
 * Showing an amount, which is not the same job as holding one.
 *
 * A displayed amount carries its currency, and where that mark goes is the
 * locale's answer rather than a table here: "\u20ac1,234.50" in en-US, "1.234,50 \u20ac"
 * in de-DE with the no-break space de-DE puts in front of it. A negative one is
 * a minus in most places and parentheses on an accounting statement \u2014 in the
 * locales that write them, which is why that is asked of Intl too.
 *
 * It only goes one way. The value stays in minor units, the field's own text
 * comes from `format`, and nothing here is ever read back: a display string
 * pasted into a field is refused there rather than half-understood.
 */

import { normalizeCurrency } from "./exponents.ts";
import { toDecimalString, type Money } from "./money.ts";

/** How the currency is written: "$", "CA$", "USD", "Canadian dollars". */
export type CurrencyDisplay = "symbol" | "narrowSymbol" | "code" | "name";

/**
 * How a negative amount is written. `accounting` asks for the convention of the
 * locale \u2014 parentheses in en-US, a minus in de-DE \u2014 rather than putting a German
 * balance sheet in American brackets.
 */
export type NegativeStyle = "sign" | "accounting";

export type DisplayOptions = {
  readonly locale?: string;
  readonly currencyDisplay?: CurrencyDisplay;
  readonly negative?: NegativeStyle;
  /** Group separators. On by default: a displayed amount has stopped moving. */
  readonly grouping?: boolean;
};

/** Where a locale puts a currency, for a caller laying the pieces out itself. */
export type Placement = {
  /** The currency as this locale writes it: "\u20ac", "CA$", "EUR". */
  readonly mark: string;
  readonly position: "before" | "after";
  /** What goes between the mark and the digits \u2014 often a no-break space. */
  readonly spacing: string;
};

/** An amount with its currency, written the way the locale writes it. */
export function display(money: Money, options: DisplayOptions = {}): string {
  // From the decimal string rather than a number, for the reason the rest of
  // this library exists; the cast is the one explained in money.ts.
  const exactly = formatterFor(money, options).format as (value: string) => string;
  return exactly(toDecimalString(money));
}

/** Where this locale puts this currency, and how it writes it. */
export function placementOf(currency: string, options: DisplayOptions = {}): Placement {
  const parts = new Intl.NumberFormat(options.locale ?? "en-US", {
    style: "currency",
    currency: normalizeCurrency(currency),
    currencyDisplay: options.currencyDisplay ?? "symbol",
  }).formatToParts(1);

  const mark = parts.findIndex((part) => part.type === "currency");
  const digits = parts.findIndex((part) => part.type === "integer");
  const position = mark < digits ? "before" : "after";
  const between =
    position === "before" ? parts.slice(mark + 1, digits) : parts.slice(digits + 1, mark);

  return {
    mark: parts[mark].value,
    position,
    spacing: between
      .filter((part) => part.type === "literal")
      .map((part) => part.value)
      .join(""),
  };
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(money: Money, options: DisplayOptions): Intl.NumberFormat {
  const locale = options.locale ?? "en-US";
  const currency = normalizeCurrency(money.currency);
  const currencyDisplay = options.currencyDisplay ?? "symbol";
  const currencySign = options.negative === "accounting" ? "accounting" : "standard";
  const useGrouping = options.grouping ?? true;

  const key = `${locale} ${currency} ${currencyDisplay} ${currencySign} ${useGrouping} ${money.exponent}`;
  const known = formatters.get(key);
  if (known) return known;

  const made = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay,
    currencySign,
    useGrouping,
    // The amount's exponent, not the one Intl keeps for the code: an override is
    // the caller saying this currency is not the two decimals Intl assumes.
    minimumFractionDigits: money.exponent,
    maximumFractionDigits: money.exponent,
  });
  formatters.set(key, made);
  return made;
}
