# PincheTulum — Agentic Cinema

PincheTulum is an autonomous media system that transforms structured events, analysis and editorial context into publishable cinematic media.

This repository brings together two integrated systems:

## PincheTulum

The autonomous editorial and media-generation engine.

- Agentic editorial orchestration
- Governance layer
- Text-to-speech
- Subtitle generation
- Video assembly
- Publication packaging
- Alejandro Barakat editorial pipeline

## Pinche Chess

A real-time chess system connected to the PincheTulum post-game media pipeline.

- WebSocket multiplayer chess
- Authoritative game state with chess.js
- Matchmaking and clocks
- Move validation
- Post-game analysis
- Editorial script generation
- PincheTulum publication generation
- Publication video generation
- IBM Bob mission integration

## Agentic Cinema Workflow

Game / Event -> Structured Data -> Analysis -> Editorial Classification -> Script -> Voice -> Subtitles -> Video -> Publication

Pinche Chess demonstrates how a live event can become autonomous editorial media through PincheTulum.


## Agentic Cinema Technology Scope

For this **Agentic Cinema: The Blockbuster Hackathon** submission, the AI and partner technologies used by the project are intentionally scoped to the technologies associated with this hackathon.

### AI / Partner Technologies

- **Google Gemini** — AI reasoning and generation
- **Google Cloud** — cloud infrastructure and services
- **IBM Bob** — partner technology / development integration
- **OpenClaw** — agent and workflow orchestration

### Application & Infrastructure Technologies

- Flutter
- Node.js
- WebSockets
- Python
- FFmpeg
- Linux
- HumHub
- Mastodon
- Matrix
- Codemagic

> Other AI models or providers that may have been explored elsewhere in the broader history of The AgroStore ecosystem are **not part of the Agentic Cinema runtime or technology claim for this submission**.


## Repository Structure

- `pinche-tulum/` — agentic editorial and cinematic media pipeline
- `pinche-chess/` — real-time chess and post-game content pipeline
- `docs/` — architecture and submission documentation

## Pinche Chess

```bash
cd pinche-chess
npm install
npm run check
npm start
```

Pinned dependencies:

- chess.js 1.4.0
- ws 8.21.3

## Hackathon

Built for the Agentic Cinema hackathon.

## Author & Creator

**Rodrigo Domenzain**

Founder, CEO & Developer — The AgroStore LLC

### Editorial / On-Screen Identity

**Alejandro Barakat**

Public pseudonym, presenter and editorial identity of Rodrigo Domenzain.
