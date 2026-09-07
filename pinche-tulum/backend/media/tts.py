import base64
import os
import wave
from pathlib import Path

from google import genai


DEFAULT_MODEL = "gemini-3.1-flash-tts-preview"
DEFAULT_VOICE = "Kore"


def _api_key() -> str:
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY or GOOGLE_API_KEY is required")
    return key


def generate_tts(
    text: str,
    output_path: str,
    voice: str = DEFAULT_VOICE,
    model: str = DEFAULT_MODEL,
) -> str:
    if not text.strip():
        raise ValueError("text must not be empty")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    client = genai.Client(api_key=_api_key())

    response = client.interactions.create(
        model=model,
        input=text,
        response_format={"type": "audio"},
        generation_config={
            "speech_config": [
                {"voice": voice}
            ]
        },
    )

    output_audio = getattr(response, "output_audio", None)
    data = getattr(output_audio, "data", None)

    if not data:
        raise RuntimeError("Gemini returned no audio data")

    pcm_bytes = base64.b64decode(data)

    with wave.open(str(output), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm_bytes)

    return str(output)
