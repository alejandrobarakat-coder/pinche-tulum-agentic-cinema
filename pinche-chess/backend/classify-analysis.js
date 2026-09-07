const fs = require('fs');
const path = require('path');

function toWhitePov(score, sideToMove) {
  if (!score) return null;

  if (score.type === 'cp') {
    const value = Number(score.value);
    return {
      type: 'cp',
      value: sideToMove === 'w' ? value : -value
    };
  }

  if (score.type === 'mate') {
    const value = Number(score.value);

    // Stockfish expresa mate desde el lado que tiene el turno.
    return {
      type: 'mate',
      value: sideToMove === 'w' ? value : -value
    };
  }

  return null;
}

function playerPov(scoreWhite, playerColor) {
  if (!scoreWhite) return null;

  return {
    type: scoreWhite.type,
    value:
      playerColor === 'w'
        ? scoreWhite.value
        : -scoreWhite.value
  };
}

function classify(before, after, playedUci, bestMove, san) {
  if (typeof san === 'string' && san.endsWith('#')) {
    return {
      label: 'checkmate',
      centipawnLoss: 0,
      decisive: true
    };
  }

  if (!before || !after) {
    return {
      label: 'unknown',
      centipawnLoss: null
    };
  }

  // Si había mate forzado.
  if (before.type === 'mate') {
    if (before.value > 0 && playedUci === bestMove) {
      return {
        label: 'best',
        centipawnLoss: 0
      };
    }

    if (after.type === 'mate' && after.value > 0) {
      return {
        label: playedUci === bestMove ? 'best' : 'mate-maintained',
        centipawnLoss: null
      };
    }

    return {
      label: 'missed-mate',
      centipawnLoss: null
    };
  }

  // Si la jugada permitió mate al rival.
  if (
    before.type === 'cp' &&
    after.type === 'mate' &&
    after.value < 0
  ) {
    return {
      label: 'blunder',
      centipawnLoss: null,
      decisive: true
    };
  }

  if (
    before.type === 'cp' &&
    after.type === 'cp'
  ) {
    const loss = Math.max(
      0,
      Math.round(before.value - after.value)
    );

    let label;

    if (playedUci === bestMove || loss <= 20) {
      label = 'best';
    } else if (loss <= 50) {
      label = 'good';
    } else if (loss <= 100) {
      label = 'inaccuracy';
    } else if (loss <= 200) {
      label = 'mistake';
    } else {
      label = 'blunder';
    }

    return {
      label,
      centipawnLoss: loss
    };
  }

  return {
    label: playedUci === bestMove ? 'best' : 'unclassified',
    centipawnLoss: null
  };
}

function main() {
  const gameId = process.argv[2];

  if (!gameId) {
    console.error(
      'Usage: node backend/classify-analysis.js <gameId>'
    );
    process.exit(1);
  }

  const inputPath = path.join(
    __dirname,
    'data',
    'analysis',
    `${gameId}.json`
  );

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Analysis not found: ${inputPath}`);
  }

  const analysis = JSON.parse(
    fs.readFileSync(inputPath, 'utf8')
  );

  const classified = analysis.moves.map((move, i) => {
    const moverColor = i % 2 === 0 ? 'w' : 'b';
    const beforeSide = moverColor;
    const afterSide = moverColor === 'w' ? 'b' : 'w';

    const afterRaw =
      i + 1 < analysis.moves.length
        ? analysis.moves[i + 1].evaluationBefore
        : analysis.finalPosition?.score;

    const beforeWhite = toWhitePov(
      move.evaluationBefore,
      beforeSide
    );

    const afterWhite = toWhitePov(
      afterRaw,
      afterSide
    );

    const beforePlayer = playerPov(
      beforeWhite,
      moverColor
    );

    const afterPlayer = playerPov(
      afterWhite,
      moverColor
    );

    const classification = classify(
      beforePlayer,
      afterPlayer,
      move.uci,
      move.bestMove,
      move.san
    );

    return {
      ...move,
      mover: moverColor === 'w' ? 'white' : 'black',
      evaluationPlayerBefore: beforePlayer,
      evaluationPlayerAfter: afterPlayer,
      ...classification
    };
  });

  const result = {
    ...analysis,
    classifiedAt: new Date().toISOString(),
    moves: classified
  };

  const outputPath = path.join(
    __dirname,
    'data',
    'analysis',
    `${gameId}.classified.json`
  );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(result, null, 2)
  );

  console.log('===== CLASSIFICATION =====');

  for (const move of classified) {
    console.log(
      `#${move.ply} ${move.san}` +
      ` | ${move.mover}` +
      ` | ${move.label}` +
      ` | loss=${move.centipawnLoss ?? '-'}` +
      ` | best=${move.bestMove}`
    );
  }

  console.log('');
  console.log(`CLASSIFICATION_SAVED ${outputPath}`);
}

main();
