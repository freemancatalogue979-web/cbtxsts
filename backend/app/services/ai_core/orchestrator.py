"""The AI orchestrator: model <-> tools loop.

    messages + tool specs  ->  model
        model asks for tools  ->  registry.execute (permission + validation + audit)
        tool results appended ->  model again … (at most ``max_steps`` rounds)
    model answers in text     ->  done

Yields small events so the caller can show progress live:

    ("tool", {"name", "label", "status": "running"})
    ("tool_done", {"name", "label", "status", "summary", "ms"})
    ("final", text)
    ("usage", {"input", "output", "cached"})   # summed over every round
    ("model", "deepseek-flash")

Prompt layout keeps the stable parts first (rules, tool specs, profile) so
DeepSeek's automatic prefix cache can hit; recent turns and the new message
come last. Cache hits are best-effort and are recorded per request.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Iterator

from .. import ai_providers as providers
from .. import ai_tutor as tutor
from . import registry
from .registry import ToolContext

MAX_CALLS_PER_ROUND = 5

STUDENT_AGENT_RULES = """PLATFORM TOOLS
You are connected to the Absolute Genesis platform through tools. Use them instead of guessing:
- Resolve course names ("Biology", "LAW 411") with list_my_courses, and topics with get_course_topics.
- Course-specific explanations: call search_course_material first and base the answer on those passages (name the material). If nothing relevant comes back, say so and answer from general knowledge, clearly labelled.
- Progress / weak areas / "what should I study": use get_my_progress, get_exam_history and get_exam_result — never invent numbers.
- When the student asks for a test, quiz, mock or exam: call create_mini_exam (course, topics, difficulty, question_count). The platform builds and times the exam and shows a Start button. Do NOT write the questions in chat. After it is created, reply in one or two sentences with what was built.
- Never reveal answers to questions the tools mark as protected or unanswered.
- Don't call tools for greetings or general chat. Use as few calls as needed; ask a short question if the course is genuinely unclear."""

ADMIN_SYSTEM = """You are the Absolute Genesis staff assistant for course and question-bank management.
You work only through the tools provided. Rules:
- Read before you propose: use get_course_overview, read_material, analyze_question_bank, search_questions, get_class_performance.
- You have full authority over course CONTENT: add questions (propose_questions), fix them (propose_question_edits — text, options, correct letter, explanation, topic, difficulty), delete them (propose_question_deletions), remove duplicates (propose_duplicate_cleanup scans the whole bank), write study materials (propose_material), and topics/classifications. Act on requests directly — do not refuse or tell staff to do it by hand.
- Every change is saved as a PROPOSAL that staff approve in one tap in the review panel (deletions ask for one extra confirmation). Say this plainly after proposing.
- STUDY MATERIALS: a material must teach everything needed to answer the topic's bank questions — read them first (search_questions by topic, include answers) and cover each tested fact with a clear explanation, definitions, examples and a short summary. Never copy the questions or list answers as a quiz; write it as readable notes. For a whole course or many topics use start_ai_task with write_materials=true.
- You cannot publish exams, grade, or change permissions or settings.
- Questions you draft must be accurate, grounded in the course material when material exists, have exactly one correct option, plausible distractors and a short explanation. Tag topic and difficulty.
- BULK WORK: for anything big — reading whole materials, building topics from materials, assigning ALL (or many) questions to topics, tagging materials, writing materials for many topics, cleaning duplicates across a large bank, or writing more than ~20 questions (up to 1000) — call start_ai_task right away with what was asked. It runs in the background with no size limit and does the whole job, not a sample. Never refuse a bulk job, never say it is too large, never do only a few items and stop, and never ask the staff member to split it up. After starting it, say in one or two sentences what the task will do and that progress shows in the Tasks tab. Use get_ai_task when asked how a task is going.
- Small requests (up to ~20 questions, a few classifications) can be proposed directly with the propose_* tools.
- ATTACHED FILES: a message may say a file was attached and saved as material #id. Use that material_id — pass it in material_ids to start_ai_task (or read_material for a quick look) and do what the staff member asked with it.
- Report numbers exactly as tools return them.
- To use a tool, CALL it. Never write tool calls, XML, DSML or JSON for a tool in your reply text.
REPLY FORMAT (Markdown, rendered in the console):
- Start with one short sentence saying the outcome.
- Then short bold-labelled sections only when useful, e.g. **Done**, **Found**, **Pending review**, **Next step** — each with 1–5 bullets.
- Refer to records as "proposal #16", "task #4", "material #7", "question #526". For long id lists show at most 8 ids, then "and N more".
- No walls of text, no repeated information, no raw tool output. Keep replies under ~180 words unless asked for detail."""


FINAL_ROUND_NOTE = (
    "TOOL BUDGET USED UP. Do not call any tools and do not write tool-call markup. "
    "Write the final answer for the staff member now in clean Markdown: a one-line summary, "
    "then short sections (**Done**, **Found**, **Pending / next step**) with bullet points. "
    "If a background task or proposal is still needed, say exactly what to ask for next."
)


def _summary_from_tools(infos: list[dict]) -> str:
    rows = [f"- **{i.get('label') or i.get('name')}** — {i.get('summary') or i.get('status')}" for i in infos if i]
    return ("Here's what I did:\n\n" + "\n".join(rows)) if rows else "Done."


def run(
    ctx: ToolContext,
    messages: list[dict],
    *,
    max_steps: int = 5,
    max_tokens: int = 1400,
    temperature: float = 0.3,
    reasoning: bool = False,
    should_stop: Callable[[], bool] | None = None,
) -> Iterator[tuple[str, Any]]:
    """Extra live events (the JSON endpoint ignores them):

        ("status", "Thinking…")                 before each model round
        ("thinking", {"step", "text"})          model reasoning for a round (thinking mode)
        ("note", "I found the material…")       text the model wrote alongside tool calls
        ("stopped", None)                       should_stop() became true; nothing more runs
    """
    impl, model = tutor.ai_target(ctx.db)
    specs = registry.specs_for(ctx.role)
    total = {"input": 0, "output": 0, "cached": 0}
    used_model = model
    ran: list[dict] = []
    stop = should_stop or (lambda: False)

    def add_usage(usage: dict | None) -> None:
        for key in total:
            total[key] += int((usage or {}).get(key) or 0)

    def execute(calls: list[dict]) -> Iterator[tuple[str, Any]]:
        for call in calls[:MAX_CALLS_PER_ROUND]:
            if stop():
                return
            yield "tool", {"name": call["name"], "label": registry.label_for(call["name"]), "status": "running"}
            result, info = registry.execute(ctx, call["name"], call["arguments"])
            ran.append(info)
            yield "tool_done", info
            messages.append({"role": "tool", "tool_call_id": call["id"], "name": call["name"], "content": result})
        for call in calls[MAX_CALLS_PER_ROUND:]:
            messages.append({"role": "tool", "tool_call_id": call["id"], "name": call["name"], "content": json.dumps({"error": "Too many tool calls in one round; ask again if still needed."})})

    try:
        for step in range(max_steps + 1):
            if stop():
                yield "usage", total
                yield "stopped", None
                return
            final_round = step == max_steps
            if final_round:
                messages.append({"role": "user", "content": "[Platform note — not from the staff member] " + FINAL_ROUND_NOTE})
            yield "status", ("Thinking…" if step == 0 else "Writing the answer…" if final_round else "Reviewing what the tools returned…")
            out = impl.complete_tools(messages, [] if final_round else specs, model=model, max_tokens=max_tokens, temperature=temperature, reasoning=reasoning)
            used_model = out.get("model") or used_model
            add_usage(out.get("usage"))
            text, leaked = providers.split_dsml(out.get("text") or "")
            calls = out.get("tool_calls") or leaked
            if out.get("reasoning"):
                yield "thinking", {"step": step + 1, "text": str(out["reasoning"]).strip()}
            if stop():
                yield "usage", total
                yield "stopped", None
                return
            if not calls:
                if not text:
                    raise tutor.TutorError(tutor.FRIENDLY, 502, "empty", technical="agent produced no text")
                yield "model", used_model
                yield "usage", total
                yield "final", text
                return
            if text:
                yield "note", text
            assistant = dict(out.get("assistant") or {"role": "assistant"})
            assistant["content"] = text
            if not assistant.get("tool_calls"):
                assistant["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}} for c in calls]
            messages.append(assistant)
            yield from execute(calls)
            if final_round:
                # The model insisted on one more tool (it was allowed none): the call ran
                # through the normal permission checks; report instead of showing markup.
                yield "model", used_model
                yield "usage", total
                yield "final", (text + "\n\n" if text else "") + _summary_from_tools(ran[-len(calls[:MAX_CALLS_PER_ROUND]):])
                return
    except providers.ProviderError as error:
        yield "usage", total
        raise tutor.friendly(error) from error
