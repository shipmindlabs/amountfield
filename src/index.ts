/**
 * amountfield — a money input for React that never holds a float and never
 * assumes a currency has two decimals.
 */

export {
  EXPONENTS,
  exponentOf,
  format,
  parse,
  separatorsFor,
  toDecimalString,
  UnknownCurrency,
  type FormatOptions,
  type Money,
  type ParseFailure,
  type ParseOptions,
  type ParseResult,
  type Separators,
} from "./money.ts";

export { blurred, initial, typed, type FieldOptions, type FieldState } from "./field.ts";

export {
  useAmountField,
  type AmountFieldProps,
  type UseAmountField,
} from "./useAmountField.ts";
