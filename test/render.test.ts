/**
 * A real React render, so the hook is proved to run rather than merely to
 * typecheck. Server rendering is enough for that and needs no DOM.
 *
 * Written with createElement rather than JSX: Node runs TypeScript by stripping
 * types, and JSX is a transformation, not a type. Keeping the tests free of it
 * means the suite needs no build step.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useAmountField } from "../src/useAmountField.ts";
import { parse, type Money } from "../src/money.ts";

function money(text: string, currency = "EUR"): Money {
  const result = parse(text, { currency });
  assert.equal(result.ok, true);
  return (result as { ok: true; money: Money }).money;
}

function Field({ start }: { start?: Money }) {
  const field = useAmountField({ currency: "EUR", locale: "de-DE" }, start);
  return createElement("input", {
    ...field.inputProps,
    "data-complete": String(!field.incomplete),
  });
}

test("the hook renders an input carrying the right props", () => {
  const html = renderToStaticMarkup(createElement(Field));
  assert.match(html, /inputmode="decimal"/i);
  assert.match(html, /autocomplete="off"/i);
  // An empty field is unfinished, not wrong, so nothing is marked invalid.
  assert.ok(!html.includes('aria-invalid="true"'), html);
});

test("an initial amount is rendered in the locale's format", () => {
  const html = renderToStaticMarkup(createElement(Field, { start: money("1234.56") }));
  assert.match(html, /value="1\.234,56"/);
  assert.match(html, /data-complete="true"/);
});
