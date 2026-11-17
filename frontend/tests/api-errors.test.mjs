import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { ApiError, validationMessage } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("422 validation errors read as plain sentences, not 'Request failed (422)'", () => {
  const detail = [{ type: "date_from_datetime_parsing", loc: ["body", "date"], msg: "Input should be a valid date or datetime, input is too short" }];
  assert.equal(validationMessage(detail), "Date: input should be a valid date or datetime, input is too short");
  assert.equal(new ApiError(422, { detail }).message, "Date: input should be a valid date or datetime, input is too short");
  assert.equal(validationMessage([{ loc: ["body", "week_id"], msg: "Input should be a valid integer" }]), "Week: input should be a valid integer");
  assert.equal(new ApiError(403, { detail: "Not allowed" }).message, "Not allowed");
  assert.equal(new ApiError(500, undefined).message, "Request failed (500)");
  assert.equal(validationMessage("text"), null);
});

test("the training form sends no date (null) instead of an empty string", async () => {
  const training = await readFile(new URL("../src/pages/Training.tsx", import.meta.url), "utf8");
  assert.match(training, /date: f\.date \|\| null/);
});
