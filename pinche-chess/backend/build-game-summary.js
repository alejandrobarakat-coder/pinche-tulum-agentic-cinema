const fs = require('fs');
const path = require('path');

function main() {
  const gameId = process.argv[2];

  if (!gameId) {
    console.error(
      'Usage: node backend/build-game-summary.js <gameId>'
    );
    process.exit(1);
  }

  const inputPath = path.join(
    __dirname,
    'data',
    'analysis',
    `${gameId}.classified.json`
  );

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Classified analysis not found: ${inputPath}`);
  }

  const data = JSON.parse(
    fs.readFileSync(inputPath, 'utf8')
  );

  const moves = data.moves || [];

  const decisiveBlunder =
    moves.find(m => m.decisive === true) ||
    [...moves]
      .filter(m => m.label === 'blunder')
      .sort((a, b) =>
        (b.centipawnLoss || 0) - (a.centipawnLoss || 0)
      )[0] ||
    null;

  const bestMoves = moves.filter(
    m => m.label === 'best'
  );

  const mistakes = moves.filter(
    m => m.label === 'mistake'
  );

  const blunders = moves.filter(
    m => m.label === 'blunder'
  );

  const mateMove =
    moves.find(
      m => m.san?.includes('#')
    ) || null;

  const finalMove =
    moves.length > 0
      ? moves[moves.length - 1]
      : null;

  const isDraw = data.result === 'DRAW';

  const winner =
    data.result === 'A'
      ? data.players?.A?.name || 'Player A'
      : data.result === 'B'
      ? data.players?.B?.name || 'Player B'
      : null;

  const loser =
    data.result === 'A'
      ? data.players?.B?.name || 'Player B'
      : data.result === 'B'
      ? data.players?.A?.name || 'Player A'
      : null;

  const summary = {
    gameId: data.gameId,
    generatedAt: new Date().toISOString(),
    winner,
    loser,
    players: data.players || null,
    result: data.result,
    termination: data.termination,
    pgn: data.pgn,

    highlights: {
      decisiveBlunder: decisiveBlunder
        ? {
            ply: decisiveBlunder.ply,
            san: decisiveBlunder.san,
            mover: decisiveBlunder.mover,
            bestMove: decisiveBlunder.bestMove,
            centipawnLoss:
              decisiveBlunder.centipawnLoss ?? null
          }
        : null,

      mateMove: mateMove
        ? {
            ply: mateMove.ply,
            san: mateMove.san,
            mover: mateMove.mover
          }
        : null,

      finalMove: finalMove
        ? {
            ply: finalMove.ply,
            san: finalMove.san,
            mover: finalMove.mover
          }
        : null,

      bestMoves: bestMoves.map(m => ({
        ply: m.ply,
        san: m.san,
        mover: m.mover
      })),

      mistakes: mistakes.map(m => ({
        ply: m.ply,
        san: m.san,
        mover: m.mover,
        centipawnLoss: m.centipawnLoss
      })),

      blunders: blunders.map(m => ({
        ply: m.ply,
        san: m.san,
        mover: m.mover,
        centipawnLoss: m.centipawnLoss ?? null
      }))
    }
  };

  summary.shortNarrative =
    isDraw
      ? `The game ended in ${data.termination}. ` +
        `The result is a draw.` +
        (
          finalMove
            ? ` The final move was ${finalMove.san}.`
            : ''
        )
      : `${winner} won by ${data.termination}. ` +
        (
          decisiveBlunder
            ? `The decisive mistake was ${decisiveBlunder.san} ` +
              `on ply ${decisiveBlunder.ply}. `
            : ''
        ) +
        (
          mateMove
            ? `The game ended with ${mateMove.san}.`
            : ''
        );

  const outputPath = path.join(
    __dirname,
    'data',
    'analysis',
    `${gameId}.summary.json`
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(summary, null, 2)
  );

  console.log("===== GAME SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));
  console.log('');
  console.log(`SUMMARY_SAVED ${outputPath}`);
}

main();
