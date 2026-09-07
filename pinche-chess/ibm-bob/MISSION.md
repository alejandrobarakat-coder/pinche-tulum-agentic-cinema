# IBM Bob Mission — AgroChess / PincheTulum

Objective:
Audit and improve the autonomous media pipeline used for the Agentic Cinema hackathon.

Current production flow:

GAME_OVER
→ analyze-game.js
→ classify-analysis.js
→ build-game-summary.js
→ build-health-timeline.js
→ build-editorial-script.js
→ build-publication-video.js
→ build-pinchetulum-publication.js
→ publish-pinchetulum.js

Constraints:
- Do not modify Flutter gameplay.
- Do not modify chess rules or matchmaking.
- Do not modify WebSocket protocol.
- Do not edit files in ~/.pub-cache.
- Do not change the canonical 9:16 video format.
- Do not create alternate render tracks.
- Preserve AgroBot® as the public analytical authority.
- Preserve one canonical PincheTulum publication per completed game.
- Every change must be isolated, documented, testable, and reversible.

IBM Bob tasks:
1. Inspect the post-game pipeline for reliability issues.
2. Identify failure points, missing validation, and retry/idempotency opportunities.
3. Improve only the media/publication pipeline.
4. Add tests or validation where useful.
5. Document every file changed and why.
6. Produce a final IBM_BOB_CONTRIBUTIONS.md suitable for the Devpost submission.

Do not make cosmetic changes merely to claim IBM usage.
