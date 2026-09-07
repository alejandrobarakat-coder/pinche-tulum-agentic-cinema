#!/usr/bin/env python3
"""
PincheTulum ADK agent — creates and runs the editorial Agent.

Entry point: run_agent(vertical, date_str, output_stem)
Gemini is called ONLY inside run_agent(); nothing executes on import.
Each run_agent() invocation makes >= 1 Gemini API request per model turn;
a full tool-calling loop typically involves 7–8 turns.
"""

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types

from backend.agent.tools import (
    build_evidence_package,
    compute_content_hash,
    fetch_source_summary,
    load_radar_clusters,
    select_candidate_story,
    verify_story_sources,
)
from backend.governance import evaluate_publication

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[2]
DAILY_DIR = ROOT / "storage" / "daily"

# ---------------------------------------------------------------------------
# Constants — no execution at import time
# ---------------------------------------------------------------------------

_DEFAULT_MODEL = "gemini-3.6-flash"
_APP_NAME = "pinchetulum"
_USER_ID = "pipeline"


def _resolve_model() -> str:
    return os.environ.get("GEMINI_MODEL", _DEFAULT_MODEL)


# ---------------------------------------------------------------------------
# Credential guard
# ---------------------------------------------------------------------------

def _assert_credentials() -> None:
    """Raise RuntimeError if neither GOOGLE_API_KEY nor GEMINI_API_KEY is set.

    Precedence: GOOGLE_API_KEY > GEMINI_API_KEY.
    The key value is never printed, logged, or stored.
    """
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError(
            "No API key found. Set GOOGLE_API_KEY (preferred) or GEMINI_API_KEY."
        )


# ---------------------------------------------------------------------------
# Output guard
# ---------------------------------------------------------------------------

def _assert_outputs_clear(day_dir: Path, output_stem: str) -> None:
    """Raise FileExistsError if either output file already exists."""
    for name in (f"{output_stem}.json", f"{output_stem}-agent-trace.json"):
        target = day_dir / name
        if target.exists():
            raise FileExistsError(
                f"Output already exists and will not be overwritten: {target}"
            )


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

def _make_agent() -> Agent:
    """Build and return the PincheTulum editorial Agent."""
    return Agent(
        name="pinchetulum_editorial_agent",
        model=_resolve_model(),
        description=(
            "PincheTulum editorial agent. "
            "Given a vertical ('cinema' or 'technology'), discover today's "
            "strongest story via the radar tools, verify sources, build the "
            "evidence package, and return the structured editorial output."
        ),
        instruction=(
            "You are the PincheTulum editorial agent for Alejandro Barakat.\n"
            "\n"
            "When called with a vertical:\n"
            "1. Call load_radar_clusters(vertical) to get today's clusters.\n"
            "2. Call select_candidate_story(clusters, min_sources=2) to pick "
            "the strongest story.\n"
            "3. Call verify_story_sources(headline, publishers, vertical) to "
            "assess credibility.\n"
            "4. Call fetch_source_summary(url) for the top source URL to "
            "confirm the article is accessible.\n"
            "5. Call build_evidence_package(vertical, story) to produce the "
            "evidence dict.\n"
            "6. Call evaluate_publication(evidence) on the evidence dict to "
            "get the governance decision.\n"
            "7. Call compute_content_hash(content) on the JSON-serialised "
            "evidence to get the provenance hash.\n"
            "8. Return a JSON object with keys: headline, evidence, governance, "
            "content_hash, verification.\n"
            "   governance must contain the full evaluate_publication result.\n"
            "   If governance.decision is REJECT, report it faithfully — do not "
            "claim publication approval.\n"
            "\n"
            "Rules:\n"
            "- Do not invent facts.\n"
            "- Clearly separate reported facts from editorial interpretation.\n"
            "- Do not include stage directions or markdown headings.\n"
            "- Preserve source URLs exactly.\n"
        ),
        tools=[
            load_radar_clusters,
            select_candidate_story,
            fetch_source_summary,
            verify_story_sources,
            build_evidence_package,
            evaluate_publication,
            compute_content_hash,
        ],
        sub_agents=[],
    )


# ---------------------------------------------------------------------------
# Trace helpers
# ---------------------------------------------------------------------------

def _collect_trace(events: list) -> list:
    """Walk ADK events and collect function calls and responses."""
    trace = []
    for event in events:
        if hasattr(event, "get_function_calls"):
            for fc in (event.get_function_calls() or []):
                trace.append({
                    "type": "function_call",
                    "name": fc.name,
                    "args": fc.args,
                })
        if hasattr(event, "get_function_responses"):
            for fr in (event.get_function_responses() or []):
                trace.append({
                    "type": "function_response",
                    "name": fr.name,
                    "response": fr.response,
                })
    return trace


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_agent(
    vertical: str,
    date_str: str | None = None,
    output_stem: str | None = None,
) -> dict:
    """Run the editorial agent for one vertical and persist outputs.

    Gemini is invoked via the ADK runner inside this function.
    Each run involves >= 1 API request per model turn; a full tool-calling
    loop typically produces 7–8 turns (one per tool call plus a final
    text response).
    Credentials are validated before any ADK object is created.

    Args:
        vertical:     'cinema' or 'technology'.
        date_str:     ISO date string YYYY-MM-DD (defaults to today UTC).
        output_stem:  Base name for the two output files:
                        <output_stem>.json
                        <output_stem>-agent-trace.json
                      Defaults to <vertical> when None, preserving
                      existing behaviour for all current callers.
                      Must contain only lowercase letters, digits, and hyphens.
                      Must not be empty.

    Returns:
        A dict with keys: vertical, date, output_path, trace_path, result.
    """
    if output_stem is None:
        output_stem = vertical
    else:
        if not isinstance(output_stem, str) or not output_stem.strip():
            raise ValueError("output_stem must be a non-empty string.")
        if not re.fullmatch(r"[a-z0-9][a-z0-9\-]*", output_stem):
            raise ValueError(
                f"Invalid output_stem {output_stem!r}. "
                "Use only lowercase letters, digits, and hyphens."
            )
    if vertical not in ("cinema", "technology"):
        raise ValueError(
            f"Invalid vertical '{vertical}'. Must be 'cinema' or 'technology'."
        )

    _assert_credentials()

    if date_str is None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    else:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
            raise ValueError(
                f"Invalid date_str '{date_str}'. Must be exactly YYYY-MM-DD."
            )
        try:
            date_str = datetime.strptime(date_str, "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            raise ValueError(
                f"Invalid date_str '{date_str}'. Not a real calendar date."
            )

    day_dir = DAILY_DIR / date_str
    day_dir.mkdir(parents=True, exist_ok=True)

    _assert_outputs_clear(day_dir, output_stem)

    agent = _make_agent()
    runner = InMemoryRunner(
        agent=agent,
        app_name=_APP_NAME,
    )

    session_id = f"{output_stem}-{date_str}"

    asyncio.run(
        runner.session_service.create_session(
            app_name=_APP_NAME,
            user_id=_USER_ID,
            session_id=session_id,
        )
    )

    prompt = (
        f"Produce the editorial evidence package for the '{vertical}' vertical "
        f"for {date_str}. Follow all steps in your instructions."
    )

    message = types.Content(
        role="user",
        parts=[types.Part(text=prompt)],
    )

    all_events = list(
        runner.run(
            user_id=_USER_ID,
            session_id=session_id,
            new_message=message,
        )
    )

    # Extract text from the final model response
    result_text = ""
    for event in all_events:
        if hasattr(event, "is_final_response") and event.is_final_response():
            parts = getattr(
                getattr(event, "content", None), "parts", None
            ) or []
            for part in parts:
                text = getattr(part, "text", None)
                if text:
                    result_text = text
                    break
            break

    # Strip Markdown JSON fence if the model wrapped its response in one.
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", result_text.lstrip(), count=1)
    stripped = re.sub(r"\n?```\s*$", "", stripped.rstrip(), count=1)
    try:
        result = json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        result = {"raw_response": result_text}

    # ------------------------------------------------------------------
    # Deterministic governance enforcement — NOT delegated to the model.
    # Always recompute from the evidence and overwrite whatever the model
    # may have returned.  This cannot be bypassed by model output.
    # ------------------------------------------------------------------
    if not isinstance(result, dict):
        result = {"raw_response": result}
        _gov_input = {}
    elif isinstance(result.get("evidence"), dict):
        _gov_input = result["evidence"]
    else:
        _gov_input = {}
    result["governance"] = evaluate_publication(_gov_input)

    trace = _collect_trace(all_events)

    # Inject vertical as "kind" so downstream consumers (package_publication_media)
    # can resolve the vertical from the piece without relying on the filename stem.
    result["kind"] = vertical

    output_path = day_dir / f"{output_stem}.json"
    output_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    trace_path = day_dir / f"{output_stem}-agent-trace.json"
    trace_path.write_text(
        json.dumps(trace, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return {
        "vertical": vertical,
        "date": date_str,
        "output_path": str(output_path),
        "trace_path": str(trace_path),
        "result": result,
    }
