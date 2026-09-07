import subprocess
from pathlib import Path


def probe_duration(path: str) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        text=True,
    ).strip()

    return float(out)


def build_vertical_video(
    image_path: str,
    audio_path: str,
    subtitles_path: str,
    output_path: str,
    max_seconds: float | None = None,
) -> str:
    image = Path(image_path)
    audio = Path(audio_path)
    subtitles = Path(subtitles_path)
    output = Path(output_path)

    for path in (image, audio, subtitles):
        if not path.exists():
            raise FileNotFoundError(str(path))

    output.parent.mkdir(parents=True, exist_ok=True)

    duration = probe_duration(str(audio))

    if max_seconds is not None:
        duration = min(duration, max_seconds)

    subtitle_filter = subtitles.as_posix().replace("'", r"\'")

    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,"
        "zoompan="
        "z='min(zoom+0.00002,1.008)':"
        "x='iw/2-(iw/zoom/2)':"
        "y='ih/2-(ih/zoom/2)':"
        "d=1:"
        "s=1080x1920:"
        "fps=30,"
        f"subtitles='{subtitle_filter}',"
        "format=yuv420p"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-loop", "1",
        "-i", str(image),
        "-i", str(audio),
        "-vf", vf,
        "-t", f"{duration:.3f}",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        str(output),
    ]

    subprocess.run(cmd, check=True)

    return str(output)
