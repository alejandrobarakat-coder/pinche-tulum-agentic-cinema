from pathlib import Path


def seconds_to_srt_time(seconds: float) -> str:
    milliseconds = int(round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{milliseconds:03}"


def write_single_caption_srt(text: str, duration_seconds: float, output_path: str) -> str:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    content = (
        "1\n"
        f"{seconds_to_srt_time(0)} --> {seconds_to_srt_time(duration_seconds)}\n"
        f"{text.strip()}\n"
    )

    path.write_text(content, encoding="utf-8")
    return str(path)
