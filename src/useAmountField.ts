/**
 * The React binding: state, and the props an <input> needs.
 *
 * Deliberately thin. Everything worth testing lives in field.ts as pure
 * functions, so this file has one job of its own: putting the caret back where
 * the state machine says it belongs, because React writes a controlled input's
 * value and the browser then drops the caret at the end of it.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { blurred, initial, typed, type FieldOptions, type FieldState } from "./field.ts";
import type { Money } from "./money.ts";

// The caret has to be back before the browser paints, so this is a layout
// effect — except on the server, where there is no caret and React says so.
const afterRender = typeof document === "undefined" ? useEffect : useLayoutEffect;

type Edit = { readonly target: { readonly value: string; readonly selectionStart: number | null } };

export type AmountFieldProps = {
  /** Spread rather than picked apart: the caret is put back through this. */
  readonly ref: RefObject<HTMLInputElement | null>;
  readonly value: string;
  readonly onChange: (event: Edit) => void;
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
  const input = useRef<HTMLInputElement | null>(null);

  const { currency, locale, exponent } = options;
  const settings = useMemo<FieldOptions>(
    () => ({ currency, locale, exponent }),
    [currency, locale, exponent],
  );

  const onChange = useCallback(
    (event: Edit) =>
      setState(typed(event.target.value, settings, event.target.selectionStart ?? undefined)),
    [settings],
  );
  const onBlur = useCallback(() => setState((current) => blurred(current, settings)), [settings]);
  const setMoney = useCallback(
    (money: Money | null) => setState(initial(settings, money ?? undefined)),
    [settings],
  );

  afterRender(() => {
    const node = input.current;
    if (!node || node.ownerDocument.activeElement !== node) return;
    if (node.selectionStart === state.caret && node.selectionEnd === state.caret) return;
    node.setSelectionRange(state.caret, state.caret);
  }, [state.text, state.caret]);

  return {
    ...state,
    setMoney,
    inputProps: {
      ref: input,
      value: state.text,
      onChange,
      onBlur,
      inputMode: "decimal",
      autoComplete: "off",
      "aria-invalid": state.problem !== null,
    },
  };
}
