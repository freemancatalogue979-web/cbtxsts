import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const apiSource = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const chatSource = await readFile(new URL("../src/pages/CloverAI.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(apiSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

function clientFor(fetchImpl) {
  const values = new Map([["clover_token", "synthetic-token"]]);
  const dispatched = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, fetch: fetchImpl, localStorage: storage,
    window: { dispatchEvent: (event) => dispatched.push(event.type) },
    TextDecoder, Event, setTimeout, JSON,
  });
  return { ...module.exports, storage, dispatched };
}

function streamResponse(bytes, split = []) {
  const positions = [0, ...split, bytes.length];
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 1; i < positions.length; i++) controller.enqueue(bytes.slice(positions[i - 1], positions[i]));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

test("Think stream handles split UTF-8, real stages, heartbeats and the final saved reply", async () => {
  const lines = [
    { type: "status", stage: "preparing" }, { type: "heartbeat" },
    { type: "status", stage: "thinking" }, { type: "status", stage: "writing" },
    { type: "result", result: { assistant_message: { content: "Analyzed 🟢", mode: "think" } } },
  ].map((item) => JSON.stringify(item)).join("\n") + "\n";
  const bytes = new TextEncoder().encode(lines);
  const emoji = bytes.indexOf(0xf0);
  let request;
  const { api } = clientFor(async (url, init) => {
    request = { url, init };
    return streamResponse(bytes, [1, 12, emoji + 1, emoji + 3]);
  });
  const stages = [];
  const result = await api.postStream("/ai/conversations/123/messages/stream", { text: "Analyze", think: true }, (stage) => stages.push(stage));
  assert.equal(request.url, "/api/ai/conversations/123/messages/stream");
  assert.equal(request.init.headers.Authorization, "Bearer synthetic-token");
  assert.deepEqual(JSON.parse(request.init.body), { text: "Analyze", think: true });
  assert.deepEqual(stages, ["preparing", "thinking", "writing"]);
  assert.equal(result.assistant_message.content, "Analyzed 🟢");
});

test("Think stream reports safe API errors and never silently accepts an incomplete reply", async () => {
  const encoded = (value) => new TextEncoder().encode(value);
  const first = clientFor(async () => streamResponse(encoded('{"type":"error","status":409,"detail":"Already processing."}\n')));
  await assert.rejects(() => first.api.postStream("/x", {}, () => {}), (error) => error.status === 409 && error.message === "Already processing.");
  const incomplete = clientFor(async () => streamResponse(encoded('{"type":"status","stage":"thinking"}\n')));
  await assert.rejects(() => incomplete.api.postStream("/x", {}, () => {}), /ended before the reply/);
  const invalid = clientFor(async () => streamResponse(encoded('not-json\n')));
  await assert.rejects(() => invalid.api.postStream("/x", {}, () => {}), /interrupted/);
  const denied = clientFor(async () => new Response('{"detail":"Sign in again."}', { status: 401 }));
  await assert.rejects(() => denied.api.postStream("/x", {}, () => {}), (error) => error.status === 401);
  assert.equal(denied.storage.getItem("clover_token"), null);
  assert.deepEqual(denied.dispatched, ["clover:unauthorized"]);
});

test("Think control is accessible, opt-in, cost-disclosed and can recover an in-flight chat", () => {
  assert.match(chatSource, /aria-label="Think mode"/);
  assert.match(chatSource, /aria-pressed=\{think\}/);
  assert.match(chatSource, /think: useThink/);
  assert.match(chatSource, /api\.postStream<AISendResult>/);
  assert.match(chatSource, /Clover is thinking deeply/);
  assert.match(chatSource, /may use more credits/);
  assert.match(chatSource, /result\.processing_think/);
  assert.match(chatSource, /motion-safe:animate-pulse/);
  assert.doesNotMatch(chatSource, /deepseek/i);
});
