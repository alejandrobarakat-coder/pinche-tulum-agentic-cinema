#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

const TOTAL_MATERIAL = 39;

const PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const PIECE_NAMES = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

function healthPercent(material) {
  return round2(Math.min(100, (material / TOTAL_MATERIAL) * 100));
}

function materialOnBoard(chess) {
  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;

      const value = PIECE_VALUES[piece.type] || 0;

      if (piece.color === 'w') {
        whiteMaterial += value;
      } else {
        blackMaterial += value;
      }
    }
  }

  return { whiteMaterial, blackMaterial };
}

function buildTimeline(game) {
  if (!game || typeof game.pgn !== 'string' || !game.pgn.trim()) {
    throw new Error('Game does not contain a valid PGN');
  }

  const chess = new Chess();
  chess.loadPgn(game.pgn);

  const history = chess.history({ verbose: true });

  const replay = new Chess();

  let {
    whiteMaterial,
    blackMaterial
  } = materialOnBoard(replay);

  const timeline = [
    {
      ply: 0,
      san: null,
      whiteMaterial,
      blackMaterial,
      whiteHealth: 100,
      blackHealth: 100,
      capture: null,
      damage: 0,
      check: false,
      checkmate: false,
      ko: null,
    },
  ];

  for (let index = 0; index < history.length; index += 1) {
    const move = history[index];

    let capture = null;
    let damage = 0;

    if (move.captured) {
      const capturedValue = PIECE_VALUES[move.captured] || 0;

      capture = PIECE_NAMES[move.captured] || move.captured;
      damage = round2((capturedValue / TOTAL_MATERIAL) * 100);

    }

    const moveSpec = {
      from: move.from,
      to: move.to
    };

    if (move.promotion) {
      moveSpec.promotion = move.promotion;
    }

    replay.move(moveSpec);

    ({
      whiteMaterial,
      blackMaterial
    } = materialOnBoard(replay));

    const checkmate = move.san.includes('#');
    const check = checkmate || move.san.includes('+');

    timeline.push({
      ply: index + 1,
      san: move.san,
      color: move.color,
      from: move.from,
      to: move.to,
      piece: PIECE_NAMES[move.piece] || move.piece,
      whiteMaterial,
      blackMaterial,
      whiteHealth: healthPercent(whiteMaterial),
      blackHealth: healthPercent(blackMaterial),
      capture,
      damage,
      check,
      checkmate,
      ko: checkmate ? (move.color === 'w' ? 'black' : 'white') : null,
    });
  }

  return {
    gameId: game.gameId || null,
    format: 'agrochess-health-timeline-v1',
    metric: 'material',
    totalMaterialPerSide: TOTAL_MATERIAL,
    pieceValues: {
      pawn: 1,
      knight: 3,
      bishop: 3,
      rook: 5,
      queen: 9,
      king: 0,
    },
    result: game.result || null,
    termination: game.termination || null,
    timeline,
  };
}

function main() {
  const gameId = process.argv[2];

  if (!gameId) {
    console.error('Usage: node build-health-timeline.js <gameId>');
    process.exit(1);
  }

  const gameFile = path.join(
    __dirname,
    'data',
    'games',
    `${gameId}.json`
  );

  if (!fs.existsSync(gameFile)) {
    console.error(`Game not found: ${gameFile}`);
    process.exit(1);
  }

  const game = JSON.parse(fs.readFileSync(gameFile, 'utf8'));
  const output = buildTimeline(game);

  const outputDir = path.join(__dirname, 'data', 'analysis');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.join(
    outputDir,
    `${gameId}.health.json`
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(output, null, 2) + '\n',
    'utf8'
  );

  console.log(`HEALTH_TIMELINE_SAVED ${outputFile}`);

  const last = output.timeline.at(-1);

  console.log(
    JSON.stringify(
      {
        gameId: output.gameId,
        plies: output.timeline.length - 1,
        whiteHealth: last.whiteHealth,
        blackHealth: last.blackHealth,
        checkmate: last.checkmate,
        ko: last.ko,
      },
      null,
      2
    )
  );
}

main();
