import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const memory = await readFile(new URL("../src/components/AILearnedMemory.tsx", import.meta.url), "utf8");
const proposal = await readFile(new URL("../src/components/AIProposalCard.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("../src/pages/CloverAI.tsx", import.meta.url), "utf8");
const equipment = await readFile(new URL("../src/components/TeamEquipment.tsx", import.meta.url), "utf8");
const webControls = await readFile(new URL("../src/components/AIWebControls.tsx", import.meta.url), "utf8");

test("private memory has separate controls, deletion and provider disclosure", () => {
  assert.match(memory, /Auto-save explicit teachings/);
  assert.match(memory, /Use relevant memories/);
  assert.match(memory, /external AI provider/);
  assert.match(memory, /\/ai\/learned-memory\/settings/);
  assert.match(memory, /\/ai\/learned-memory\/\$\{memory\.id\}/);
  assert.match(memory, /Unverified/);
  assert.match(chat, /Explicit teachings can be saved privately/);
});

test("research save uses a server-owned source index, not a model assertion", () => {
  assert.match(chat, /unverified excerpt/);
  assert.match(chat, /Save finding to memory/);
  assert.match(chat, /research-memory`, \{ source_index: index \}/);
});

test("admin proposals need an explicit review before confirm", () => {
  assert.match(proposal, /I reviewed the fields/);
  assert.match(proposal, /disabled=\{busy \|\| !reviewed\}/);
  assert.match(proposal, /\{ reviewed: true, confirm: true \}/);
  assert.match(proposal, /clover:meta-changed/);
  assert.match(proposal, /AI platform change history/);
  assert.match(proposal, /set_draft_patch/);
  assert.match(proposal, /Existing boards keep their own patch/);
  assert.match(chat, /Attach an existing draft to change its patch/);
});

test("web checks are positioned as support for saved game knowledge", () => {
  assert.match(webControls, /Use game knowledge and saved data first/);
  assert.match(webControls, /current info or verification/);
  assert.match(chat, /message\.mode === "guidance" \? "Next step"/);
});

test("equipment cards show descriptions and editing is role-gated", () => {
  assert.match(equipment, /setSelected\(item\)/);
  assert.match(equipment, /selected\.description/);
  assert.match(equipment, /canEdit &&/);
  assert.match(equipment, /not verified/);
});
