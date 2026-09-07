"""
PincheTulum ADK editorial tools.

Plain Python functions — no ADK imports here.
The ADK registers these via type annotations + docstrings when passed to Agent(tools=[...]).
All tool logic is stdlib-only so each function is testable without the venv.
"""

import hashlib
import html
import ipaddress
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RADAR_FILE = Path("/tmp/pinchetulum-radar.json")
OFFICIAL_SOURCES_FILE = ROOT / "agents" / "cinema-official-sources.json"

_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 PincheTulum-Agent/1.0",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}


# ---------------------------------------------------------------------------
# SSRF protection helpers (not ADK tools — internal use only)
# ---------------------------------------------------------------------------

def _is_public_address(host: str) -> tuple:
    """Resolve host and verify all addresses are publicly routable.

    Returns (is_public: bool, reason: str).
    Rejects loopback, private, reserved, multicast, link-local, unspecified.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        return False, f"DNS resolution failed: {exc}"

    for *_, sockaddr in infos:
        raw_addr = sockaddr[0]
        try:
            addr = ipaddress.ip_address(raw_addr)
        except ValueError:
            return False, f"Unparseable address: {raw_addr}"
        if (addr.is_loopback
                or addr.is_private
                or addr.is_reserved
                or addr.is_multicast
                or addr.is_link_local
                or addr.is_unspecified):
            return False, f"Non-public address blocked: {raw_addr}"

    return True, ""


def _validate_url(url: str) -> tuple:
    """Validate URL scheme and resolve destination against SSRF targets.

    Returns (ok: bool, reason: str).
    Only http:// and https:// schemes are permitted.
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False, "URL parse error."

    if parsed.scheme not in ("http", "https"):
        return False, f"Scheme '{parsed.scheme}' not allowed — only http/https."

    host = parsed.hostname
    if not host:
        return False, "No hostname in URL."

    return _is_public_address(host)


class _ValidatingRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Redirect handler that validates every hop before following.

    Prevents SSRF via redirect chains to private/internal destinations.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        ok, reason = _validate_url(newurl)
        if not ok:
            raise urllib.error.URLError(
                f"Redirect to non-public destination blocked: {reason}"
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# ---------------------------------------------------------------------------
# Tool 1 — load_radar_clusters
# ---------------------------------------------------------------------------

def load_radar_clusters(vertical: str) -> dict:
    """Load ranked story clusters for a vertical from the Radar output file.

    Reads /tmp/pinchetulum-radar.json produced by scripts/radar.py.
    Returns the top clusters with scores, publishers, and source URLs.
    Call this first to discover today's stories.

    Args:
        vertical: Editorial vertical — must be exactly 'cinema' or 'technology'.

    Returns:
        A dict with keys: vertical, count, clusters (list of top 15).
    """
    if vertical not in ("cinema", "technology"):
        return {
            "vertical": vertical,
            "count": 0,
            "clusters": [],
            "error": (
                f"Invalid vertical '{vertical}'. "
                "Must be 'cinema' or 'technology'."
            ),
        }

    if not RADAR_FILE.exists():
        return {
            "vertical": vertical,
            "count": 0,
            "clusters": [],
            "error": "Radar file not found. Run scripts/radar.py first.",
        }

    with RADAR_FILE.open(encoding="utf-8") as f:
        radar = json.load(f)

    clusters = radar.get(vertical, [])

    return {
        "vertical": vertical,
        "count": len(clusters),
        "clusters": clusters[:15],
    }


# ---------------------------------------------------------------------------
# Tool 2 — select_candidate_story
# ---------------------------------------------------------------------------

def select_candidate_story(clusters: list, min_sources: int) -> dict:
    """Select the strongest candidate story from ranked radar clusters.

    Prefers stories reported by >= min_sources unique independent publishers
    (case-insensitive deduplication). Falls back to the highest-scored cluster.

    Args:
        clusters: List of cluster dicts from load_radar_clusters.
        min_sources: Minimum number of independent publishers preferred.

    Returns:
        A dict with keys: headline, score, publishers, sources.
    """
    if not clusters:
        return {"error": "No clusters provided."}

    for cluster in clusters:
        unique_pubs = {
            p.lower().strip()
            for p in cluster.get("publishers", [])
            if p
        }
        if len(unique_pubs) >= min_sources:
            return {
                "headline": cluster.get("title", ""),
                "score": cluster.get("score", 0),
                "publishers": cluster.get("publishers", []),
                "sources": cluster.get("sources", []),
            }

    top = clusters[0]
    return {
        "headline": top.get("title", ""),
        "score": top.get("score", 0),
        "publishers": top.get("publishers", []),
        "sources": top.get("sources", []),
    }


# ---------------------------------------------------------------------------
# Tool 3 — fetch_source_summary
# ---------------------------------------------------------------------------

def fetch_source_summary(url: str) -> dict:
    """Fetch a brief text summary of a news article by URL.

    Returns the page title and first 500 characters of visible text.
    Used to verify source content before building the evidence package.
    Rejects private/internal/non-public destinations (SSRF protection).
    Validates every redirect hop before following.
    On paywall, block, or network error returns available=false.

    Args:
        url: The article URL to fetch (http or https only).

    Returns:
        A dict with keys: available, url, title, excerpt  (or reason on failure).
    """
    ok, reason = _validate_url(url)
    if not ok:
        return {"available": False, "url": url, "reason": reason}

    try:
        opener = urllib.request.build_opener(_ValidatingRedirectHandler)
        req = urllib.request.Request(url, headers=_FETCH_HEADERS)
        with opener.open(req, timeout=10) as r:
            raw = r.read(200_000)

        text = raw.decode("utf-8", errors="replace")

        title_match = re.search(
            r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL
        )
        title = html.unescape(title_match.group(1).strip()) if title_match else ""

        visible = re.sub(r"<[^>]+>", " ", text)
        visible = re.sub(r"\s+", " ", visible).strip()
        excerpt = visible[:500]

        return {"available": True, "url": url, "title": title, "excerpt": excerpt}

    except Exception as exc:
        return {"available": False, "url": url, "reason": str(exc)[:200]}


# ---------------------------------------------------------------------------
# Tool 4 — verify_story_sources
# ---------------------------------------------------------------------------

def verify_story_sources(headline: str, publishers: list, vertical: str) -> dict:
    """Verify publisher credibility for a candidate story.

    For cinema: checks whether any publisher matches a known official source
    domain (Oscars, Cannes, Venice, etc.) from cinema-official-sources.json.
    For technology: evaluates publisher count and diversity.

    Args:
        headline: The story headline being verified.
        publishers: List of publisher names from the radar cluster.
        vertical: 'cinema' or 'technology'.

    Returns:
        A dict with keys: source_count, has_official_source, notes.
    """
    source_count = len({p.lower().strip() for p in publishers if p})
    has_official = False
    notes = ""

    if vertical == "cinema" and OFFICIAL_SOURCES_FILE.exists():
        with OFFICIAL_SOURCES_FILE.open(encoding="utf-8") as f:
            official = json.load(f)

        official_names = {
            s.get("short_name", "").lower()
            for s in official.get("sources", [])
            if s.get("short_name")
        }
        official_domains = {
            s.get("official_domain", "").lower()
            for s in official.get("sources", [])
            if s.get("official_domain")
        }
        for pub in publishers:
            p = pub.lower()
            if any(name in p for name in official_names) or \
               any(domain in p for domain in official_domains):
                has_official = True
                break

        notes = (
            f"{source_count} unique publisher(s); "
            f"official source present: {has_official}."
        )
    else:
        notes = (
            f"{source_count} unique publisher(s) covering this {vertical} story."
        )

    return {
        "source_count": source_count,
        "has_official_source": has_official,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Tool 5 — build_evidence_package
# ---------------------------------------------------------------------------

def build_evidence_package(vertical: str, story: dict) -> dict:
    """Build the structured evidence package for a candidate story.

    Constructs the evidence dict: headline, radar_score, publishers,
    deduplicated sources (max 5), and editorial rules.
    This is the payload Gemini will use to write the editorial script.

    Args:
        vertical: 'cinema' or 'technology'.
        story: The candidate story dict from select_candidate_story.

    Returns:
        The evidence dict ready for script generation.
    """
    seen: set = set()
    sources = []
    for s in story.get("sources", []):
        key = (s.get("publisher", ""), s.get("url", ""))
        if key in seen:
            continue
        seen.add(key)
        sources.append({
            "publisher": s.get("publisher", ""),
            "title": s.get("title", ""),
            "url": s.get("url", ""),
            "date": s.get("date", ""),
        })
        if len(sources) >= 5:
            break

    return {
        "kind": vertical,
        "headline": story.get("headline", ""),
        "radar_score": story.get("score", 0),
        "publishers": story.get("publishers", []),
        "sources": sources,
        "source_count": len(sources),
        "has_multiple_sources": len(sources) >= 2,
        "rules": {
            "do_not_invent_facts": True,
            "distinguish_fact_from_opinion": True,
            "preserve_source_urls": True,
        },
    }


# ---------------------------------------------------------------------------
# Tool 6 — compute_content_hash
# ---------------------------------------------------------------------------

def compute_content_hash(content: str) -> str:
    """Compute the SHA-256 hash of a content string (UTF-8 encoded).

    Used as the final evidence readiness step before governance.
    The hash is embedded in the daily piece for cryptographic provenance.

    Args:
        content: The content string to hash (typically serialised evidence).

    Returns:
        Lowercase hex SHA-256 digest string (64 characters).
    """
    return hashlib.sha256(content.encode("utf-8")).hexdigest()
