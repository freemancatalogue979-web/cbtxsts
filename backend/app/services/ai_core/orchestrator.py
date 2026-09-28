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
from typing import Any, Iterator

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
- Every change is a PROPOSAL (propose_topics, propose_questions, propose_classification). Proposals are saved for staff review; nothing becomes official until a staff member approves it in the review panel. Say this plainly after proposing.
- You cannot delete, publish, grade, or change permissions or settings. If asked, explain that staff do that in the console.
- Questions you draft must be accurate, grounded in the course material when material exists, have exactly one correct option, plausible distractors and a short explanation. Tag topic and difficulty.
- For large jobs, work in batches (e.g. 10-20 questions per proposal) and say what you covered.
- Report numbers exactly as tools return them. Be concise; use short lists."""


def run(ctx: ToolContext, messages: list[dict], *, max_steps: int = 5, max_tokens: int = 1400, temperature: float = 0.3) -> Iterator[tuple[str, Any]]:
    impl, model = tutor.ai_target(ctx.db)
    specs = registry.specs_for(ctx.role)
    total = {"input": 0, "output": 0, "cached": 0}
    used_model = model

    def add_usage(usage: dict | None) -> None:
        for key in total:
            total[key] += int((usage or {}).get(key) or 0)

    try:
        for step in range(max_steps + 1):
            final_round = step == max_steps
            out = impl.complete_tools(messages, [] if final_round else specs, model=model, max_tokens=max_tokens, temperature=temperature)
            used_model = out.get("model") or used_model
            add_usage(out.get("usage"))
            calls = out.get("tool_calls") or []
            if not calls or final_round:
                text = (out.get("text") or "").strip()
                if not text:
                    raise tutor.TutorError(tutor.FRIENDLY, 502, "empty", technical="agent produced no text")
                yield "model", used_model
                yield "usage", total
                yield "final", text
                return
            messages.append(out["assistant"])
            for call in calls[:MAX_CALLS_PER_ROUND]:
                yield "tool", {"name": call["name"], "label": registry.label_for(call["name"]), "status": "running"}
                result, info = registry.execute(ctx, call["name"], call["arguments"])
                yield "tool_done", info
                messages.append({"role": "tool", "tool_call_id": call["id"], "name": call["name"], "content": result})
            for call in calls[MAX_CALLS_PER_ROUND:]:
                messages.append({"role": "tool", "tool_call_id": call["id"], "name": call["name"], "content": json.dumps({"error": "Too many tool calls in one round; ask again if still needed."})})
    except providers.ProviderError as error:
        yield "usage", total
        raise tutor.friendly(error) from error
