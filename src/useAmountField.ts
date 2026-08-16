/**
 * The React binding: state, and the props an <input> needs.
 *
 * Deliberately thin. Everything worth testing lives in field.ts as pure
 * functions, so this file has no logic of its own to get wrong.
 */

import { useCallback, useMemo, useState } from "react";

import { blurred, initial, typed, type FieldOptions, type FieldState } from "./field.ts";
import type { Money } from "./money.ts";

export type AmountFieldProps = {
  readonly value: string;
  readonly onChange: (event: { target: { value: string } }) => void;
  readonly onBlur: () => void;
  readonly inputMode: "decimal";
  readonly autoComplete: "off";
  /** Marks the field invalid for assistive technology — but never while the
   * value is merely unfinished. */
  readonly "aria-invalid": boolean;
};

export type UseAmountField = FieldState & {
  /** Spread onto an <input>. */
  readonly inputProps: AmountFieldProps;
  /** Replace the value from outside, e.g. when a form resets. */
  readonly setMoney: (money: Money | null) => void;
};

export function useAmountField(options: FieldOptions, startWith?: Money): UseAmountField {
  const [state, setState] = useState<FieldState>(() => initial(options, startWith));

  const { currency, locale, exponent } = options;
  const settings = useMemo<FieldOptions>(
    () => ({ currency, locale, exponent }),
    [currency, locale, exponent],
  );

  const onChange = useCallback(
    (event: { target: { value: string } }) => setState(typed(event.target.value, settings)),
    [settings],
  );
  const onBlur = useCallback(() => setState((current) => blurred(current, settings)), [settings]);
  const setMoney = useCallback(
    (money: Money | null) => setState(initial(settings, money ?? undefined)),
    [settings],
  );

  return {
    ...state,
    setMoney,
    inputProps: {
      value: state.text,
      onChange,
      onBlur,
      inputMode: "decimal",
      autoComplete: "off",
      "aria-invalid": state.problem !== null,
    },
  };
}
