#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib import request

ROOT = Path(__file__).resolve().parents[2]

RADAR_FILE = Path("/tmp/pinchetulum-radar.json")
POLICY_FILE = ROOT / "agents/alejandro-policy.json"
OUT_DIR = ROOT / "storage/daily"

GEMINI_MODEL = os.environ.get(
    "GEMINI_MODEL",
    "gemini-2.5-flash"
)

def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def sha256_text(text):
    return hashlib.sha256(
        text.encode("utf-8")
    ).hexdigest()

def choose_story(groups):
    if not groups:
        raise RuntimeError("No stories available")

    # Prefer stories already supported by >= 2 publishers.
    for story in groups:
        if len(story.get("publishers", [])) >= 2:
            return story

    return groups[0]

def compact_sources(story, max_sources=5):
    result = []

    seen = set()

    for source in story.get("sources", []):
        url = source.get("url", "")
        publisher = source.get("publisher", "")

        key = (publisher, url)

        if key in seen:
            continue

        seen.add(key)

        result.append({
            "publisher": publisher,
            "title": source.get("title"),
            "url": url,
            "date": source.get("date")
        })

        if len(result) >= max_sources:
            break

    return result

def build_evidence(kind, story):
    return {
        "kind": kind,
        "selected_at": datetime.now(timezone.utc).isoformat(),
        "headline": story.get("title"),
        "radar_score": story.get("score"),
        "publishers": story.get("publishers", []),
        "sources": compact_sources(story),
        "rules": {
            "do_not_invent_facts": True,
            "distinguish_fact_from_opinion": True,
            "retain_source_urls": True
        }
    }

def gemini_prompt(kind, evidence, policy):
    return f"""
You are preparing a PincheTulum editorial script for Alejandro Barakat.

CATEGORY:
{kind}

PRESENTER:
Alejandro Barakat

OUTPUT LANGUAGE:
English.

DELIVERY:
Fast, natural, articulate British English.
Do not use telegram-style prose.
Do not use forced catchphrases or filler.

TASK:
Write one strong spoken script based ONLY on the evidence supplied below.

The script should:
- focus on one story;
- be factual;
- clearly separate reported facts from editorial interpretation;
- not invent quotations or facts;
- sound like an informed independent critic/commentator;
- preserve nuance when sources disagree;
- be suitable for a fast approximately 60-second delivery.

Do not include stage directions.
Do not include markdown headings.
Do not include citations inside the spoken text.

Return JSON ONLY with:
{{
  "headline": "...",
  "script": "...",
  "editorial_angle": "...",
  "facts_used": ["..."],
  "source_urls": ["..."]
}}

EDITORIAL POLICY:
{json.dumps(policy, ensure_ascii=False)}

EVIDENCE:
{json.dumps(evidence, ensure_ascii=False)}
""".strip()

def call_gemini(prompt):
    api_key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
    )

    if not api_key:
        return {
            "status": "gemini_not_called",
            "reason": "GEMINI_API_KEY/GOOGLE_API_KEY not present",
            "prompt_sha256": sha256_text(prompt)
        }

    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{GEMINI_MODEL}:generateContent"
        f"?key={api_key}"
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.35,
            "responseMimeType": "application/json"
        }
    }

    req = request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with request.urlopen(req, timeout=90) as r:
        response = json.loads(r.read())

    text = (
        response["candidates"][0]["content"]
        ["parts"][0]["text"]
    )

    try:
        parsed = json.loads(text)
    except Exception:
        parsed = {
            "raw_response": text
        }

    return {
        "status": "generated",
        "model": GEMINI_MODEL,
        "output": parsed
    }

def bitcoin_address(label):
    try:
        p = subprocess.run(
            [
                "bitcoin-cli",
                "getnewaddress",
                label,
                "bech32"
            ],
            capture_output=True,
            text=True,
            timeout=30
        )
    except FileNotFoundError:
        return {
            "status": "unavailable",
            "reason": "bitcoin-cli not found"
        }

    if p.returncode != 0:
        return {
            "status": "error",
            "reason": p.stderr.strip()
        }

    return {
        "status": "assigned",
        "address": p.stdout.strip()
    }

def prepare_piece(kind, story, policy, use_wallet):
    evidence = build_evidence(kind, story)

    prompt = gemini_prompt(
        kind,
        evidence,
        policy
    )

    gemini = call_gemini(prompt)

    material = {
        "evidence": evidence,
        "gemini": gemini
    }

    canonical = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":")
    )

    content_hash = sha256_text(canonical)

    provenance = {
        "sha256": content_hash,
        "bitcoin": {
            "status": "not_requested"
        }
    }

    if use_wallet:
        provenance["bitcoin"] = bitcoin_address(
            f"pinchetulum-{kind}-{content_hash[:12]}"
        )

    return {
        "schema": "pinchetulum.daily-piece.v1",
        "kind": kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "presenter": "Alejandro Barakat",
        "evidence": evidence,
        "generation": gemini,
        "provenance": provenance
    }

def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--wallet",
        action="store_true",
        help="Assign a new Bitcoin address to each piece"
    )

    args = parser.parse_args()

    if not RADAR_FILE.exists():
        raise SystemExit(
            "Radar file missing. Run scripts/radar.py first."
        )

    radar = load_json(RADAR_FILE)
    policy = load_json(POLICY_FILE)

    cinema_story = choose_story(
        radar.get("cinema", [])
    )

    tech_story = choose_story(
        radar.get("technology", [])
    )

    date = datetime.now(
        timezone.utc
    ).strftime("%Y-%m-%d")

    day_dir = OUT_DIR / date
    day_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    pieces = {
        "cinema": prepare_piece(
            "cinema",
            cinema_story,
            policy,
            args.wallet
        ),
        "technology": prepare_piece(
            "technology",
            tech_story,
            policy,
            args.wallet
        )
    }

    for kind, piece in pieces.items():
        path = day_dir / f"{kind}.json"

        path.write_text(
            json.dumps(
                piece,
                indent=2,
                ensure_ascii=False
            ),
            encoding="utf-8"
        )

        print()
        print("===", kind.upper(), "===")
        print(
            piece["evidence"]["headline"]
        )
        print(
            "sources:",
            len(piece["evidence"]["sources"])
        )
        print(
            "sha256:",
            piece["provenance"]["sha256"]
        )
        print(
            "gemini:",
            piece["generation"]["status"]
        )
        print(
            "bitcoin:",
            piece["provenance"]["bitcoin"]["status"]
        )
        print(
            "file:",
            path
        )

if __name__ == "__main__":
    main()
