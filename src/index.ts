/**
 * amountfield — a money input for React that never holds a float and never
 * assumes a currency has two decimals.
 */

export {
  EXPONENTS,
  exponentOf,
  MissingCurrency,
  UnknownCurrency,
  type ExponentOverride,
  type Exponents,
} from "./exponents.ts";

export {
  format,
  isIncomplete,
  parse,
  separatorsFor,
  toDecimalString,
  type FormatOptions,
  type Money,
  type ParseFailure,
  type ParseOptions,
  type ParseResult,
  type Separators,
} from "./money.ts";

export {
  add,
  allocate,
  multiply,
  subtract,
  CurrencyMismatch,
  ExponentMismatch,
  InexactAmount,
  InexactRatio,
  type Fraction,
  type Ratio,
  type Rounding,
} from "./arithmetic.ts";

export { blurred, initial, typed, type FieldOptions, type FieldState } from "./field.ts";

export {
  useAmountField,
  type AmountFieldProps,
  type UseAmountField,
} from "./useAmountField.ts";
