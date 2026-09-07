"""
PincheTulum deterministic governance gate.

evaluate_publication(evidence) -> dict

Hard rules (all must pass for PUBLISH):
  1. at least 2 unique source URLs in evidence["sources"]
  2. evidence["source_count"] >= 2
  3. evidence["has_multiple_sources"] is True
  4. evidence["rules"]["distinguish_fact_from_opinion"] is True
  5. evidence["rules"]["preserve_source_urls"] is True

No Gemini, no network, no filesystem writes, no side effects.
"""

from __future__ import annotations

__all__ = ["evaluate_publication"]


def evaluate_publication(evidence: dict) -> dict:
    """Deterministic publication gate.

    Args:
        evidence: The evidence dict produced by build_evidence_package,
                  or the top-level agent output dict (which may contain
                  an "evidence" sub-key).

    Returns:
        {
            "decision": "PUBLISH" | "REJECT",
            "reasons": [str, ...],       # empty when PUBLISH
            "checks":  {str: bool, ...}  # one entry per hard rule
        }
    """
    # Support both the raw evidence dict and the wrapped agent output.
    ev: dict = evidence.get("evidence", evidence) if isinstance(evidence, dict) else {}

    reasons: list[str] = []
    checks: dict[str, bool] = {}

    # --- Rule 1: at least 2 unique source URLs ---
    sources = ev.get("sources", [])
    if isinstance(sources, list):
        unique_urls = set()
        for s in sources:
            if isinstance(s, dict):
                url = s.get("url")
            elif isinstance(s, str):
                url = s
            else:
                url = None
            if isinstance(url, str) and url:
                unique_urls.add(url)
        rule1 = len(unique_urls) >= 2
    else:
        rule1 = False
    checks["unique_source_urls_gte_2"] = rule1
    if not rule1:
        reasons.append("Fewer than 2 unique source URLs found.")

    # --- Rule 2: source_count >= 2 ---
    source_count = ev.get("source_count", 0)
    try:
        rule2 = int(source_count) >= 2
    except (TypeError, ValueError):
        rule2 = False
    checks["source_count_gte_2"] = rule2
    if not rule2:
        reasons.append(f"source_count ({source_count!r}) is less than 2.")

    # --- Rule 3: has_multiple_sources is True ---
    rule3 = ev.get("has_multiple_sources") is True
    checks["has_multiple_sources"] = rule3
    if not rule3:
        reasons.append("has_multiple_sources is not True.")

    # --- Rules 4 & 5: editorial rules sub-dict ---
    rules: dict = {}
    if isinstance(ev.get("rules"), dict):
        rules = ev["rules"]

    # Rule 4: distinguish_fact_from_opinion
    rule4 = rules.get("distinguish_fact_from_opinion") is True
    checks["distinguish_fact_from_opinion"] = rule4
    if not rule4:
        reasons.append("rules.distinguish_fact_from_opinion is not True.")

    # Rule 5: preserve_source_urls (strict — no aliases)
    rule5 = rules.get("preserve_source_urls") is True
    checks["preserve_source_urls"] = rule5
    if not rule5:
        reasons.append("rules.preserve_source_urls is not True.")

    decision = "PUBLISH" if not reasons else "REJECT"
    return {"decision": decision, "reasons": reasons, "checks": checks}
