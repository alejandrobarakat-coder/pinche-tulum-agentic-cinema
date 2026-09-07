"""
Publication media packager.

Takes a governed daily piece and produces:
  - WAV  (narration via Gemini TTS)
  - SRT  (subtitles)
  - MP4  (final vertical video, 1080x1920)

Governance is ALWAYS recomputed deterministically from piece["evidence"].
Stored governance values are NEVER trusted.
REJECT (or missing/invalid evidence) raises GovernanceRejectError immediately,
before any directory, media, or TTS operation is attempted.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from backend.governance import evaluate_publication
from backend.media.subtitles import write_single_caption_srt
from backend.media.tts import generate_tts
from backend.media.video_assembly import build_vertical_video, probe_duration


class GovernanceRejectError(RuntimeError):
    """Raised when the deterministically recomputed governance decision is not PUBLISH."""


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[2]
MEDIA_OUT = ROOT / "storage" / "media"
PRESENTER_DIR = ROOT / "assets" / "presenter"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _presenter_image(vertical: str) -> Path:
    """Return the presenter still for the given vertical.

    Raises FileNotFoundError if the image has not been installed yet.
    """
    path = PRESENTER_DIR / f"{vertical}.jpg"
    if not path.exists():
        raise FileNotFoundError(
            f"Presenter image not found: {path}\n"
            f"Install assets/presenter/{vertical}.jpg before packaging."
        )
    return path


def _extract_script(piece: dict) -> str:
    """Pull the narrator script from the daily piece.

    Priority (first non-empty string wins):
      1. piece["script"]
      2. piece["narration"]
      3. piece["headline"]
      4. piece["generation"]["output"]["script"]
      5. piece["generation"]["output"]["headline"]
      6. piece["evidence"]["headline"]

    Raises ValueError if nothing useful is found.
    """
    # Top-level keys first (ADK final-output contract)
    for key in ("script", "narration", "headline"):
        value = piece.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    # Legacy generation.output path
    gen = piece.get("generation")
    if isinstance(gen, dict):
        output = gen.get("output")
        if isinstance(output, dict):
            for key in ("script", "headline"):
                value = output.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

    # Final fallback: evidence headline
    evidence = piece.get("evidence")
    if isinstance(evidence, dict):
        value = evidence.get("headline")
        if isinstance(value, str) and value.strip():
            return value.strip()

    raise ValueError("No narrator script or headline found in piece.")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def package_publication_media(
    piece_path: str,
    voice: str = "Kore",
    max_seconds: float | None = None,
) -> dict:
    """Package media for a governed PUBLISH daily piece.

    Governance is recomputed deterministically from piece["evidence"].
    The stored governance field (if any) is ignored entirely.

    Args:
        piece_path:   Path to storage/daily/<date>/<vertical>.json
        voice:        Gemini TTS voice name (default: Kore).
        max_seconds:  Optional hard cap on video duration in seconds.

    Returns:
        Manifest dict with paths: wav, srt, mp4, duration, governance.

    Raises:
        GovernanceRejectError: if the recomputed governance decision != "PUBLISH".
        FileNotFoundError:     if piece_path or presenter image missing.
        ValueError:            if vertical is unsupported or no narrator script found.
    """
    path = Path(piece_path)
    if not path.exists():
        raise FileNotFoundError(f"Piece not found: {path}")

    piece = json.loads(path.read_text(encoding="utf-8"))

    # -----------------------------------------------------------------------
    # GOVERNANCE — recomputed deterministically. Must be the very first check.
    # Stored piece["governance"] is never read or trusted.
    # Missing or invalid evidence produces REJECT (fail-closed).
    # No directory, no presenter lookup, no script, no TTS until PUBLISH.
    # -----------------------------------------------------------------------
    evidence = piece.get("evidence", {}) if isinstance(piece, dict) else {}
    computed_governance = evaluate_publication(evidence)

    if computed_governance["decision"] != "PUBLISH":
        raise GovernanceRejectError(
            f"Governance REJECT — media packaging aborted.\n"
            f"Reasons: {computed_governance['reasons']}"
        )

    # -----------------------------------------------------------------------
    # Derive and validate vertical.
    # Must be done before any filesystem operation.
    # -----------------------------------------------------------------------
    vertical = piece.get("kind") or piece.get("category") or path.stem
    if vertical not in {"cinema", "technology"}:
        raise ValueError(f"Unsupported vertical: {vertical!r}")

    # -----------------------------------------------------------------------
    # Derive date robustly.
    # Prefer created_at[:10]; fall back to parent directory name; then today UTC.
    # -----------------------------------------------------------------------
    created_at = piece.get("created_at")
    if isinstance(created_at, str) and len(created_at) >= 10:
        date_str = created_at[:10]
    elif path.parent.name:
        date_str = path.parent.name
    else:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # -----------------------------------------------------------------------
    # Presenter image — vertical-specific.
    # Checked before mkdir so a missing image leaves no empty directory.
    # -----------------------------------------------------------------------
    image_path = _presenter_image(vertical)

    # -----------------------------------------------------------------------
    # Script extraction.
    # Checked before mkdir so a missing script leaves no empty directory.
    # -----------------------------------------------------------------------
    script = _extract_script(piece)

    # -----------------------------------------------------------------------
    # Output directory — created only after all pre-checks pass.
    # -----------------------------------------------------------------------
    out_dir = MEDIA_OUT / date_str / vertical
    out_dir.mkdir(parents=True, exist_ok=True)

    # -----------------------------------------------------------------------
    # TTS → WAV
    # -----------------------------------------------------------------------
    wav_path = str(out_dir / "narration.wav")
    generate_tts(text=script, output_path=wav_path, voice=voice)

    # -----------------------------------------------------------------------
    # Subtitles → SRT
    # -----------------------------------------------------------------------
    duration = probe_duration(wav_path)
    if max_seconds is not None:
        duration = min(duration, max_seconds)

    srt_path = str(out_dir / "subtitles.srt")
    write_single_caption_srt(
        text=script,
        duration_seconds=duration,
        output_path=srt_path,
    )

    # -----------------------------------------------------------------------
    # Video assembly → MP4
    # -----------------------------------------------------------------------
    mp4_path = str(out_dir / "presentation.mp4")
    build_vertical_video(
        image_path=str(image_path),
        audio_path=wav_path,
        subtitles_path=srt_path,
        output_path=mp4_path,
        max_seconds=max_seconds,
    )

    actual_duration = probe_duration(mp4_path)

    # -----------------------------------------------------------------------
    # Manifest — contains recomputed governance, never the stored value.
    # -----------------------------------------------------------------------
    manifest = {
        "schema": "pinchetulum.media-package.v1",
        "vertical": vertical,
        "date": date_str,
        "governance": computed_governance,
        "piece_path": str(path),
        "media": {
            "wav": wav_path,
            "srt": srt_path,
            "mp4": mp4_path,
        },
        "duration_seconds": actual_duration,
        "voice": voice,
        "packaged_at": datetime.now(timezone.utc).isoformat(),
    }

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return manifest
