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

## Author

Alejandro Barakat
The AgroStore LLC
