const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { Chess } = require('chess.js');

const STOCKFISH = '/usr/games/stockfish';
const DEPTH = 16;

function analyzeFen(fen) {
  return new Promise((resolve, reject) => {
    const sf = spawn(STOCKFISH);
    const rl = readline.createInterface({ input: sf.stdout });

    let lastScore = null;
    let lastPv = null;
    let searching = false;
    let finished = false;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      rl.close();
      sf.stdin.write('quit\n');
      resolve(result);
    };

    sf.on('error', reject);

    sf.stderr.on('data', data => {
      process.stderr.write(data);
    });

    rl.on('line', line => {
      if (line === 'uciok') {
        sf.stdin.write('isready\n');
        return;
      }

      if (line === 'readyok') {
        searching = true;
        sf.stdin.write(`position fen ${fen}\n`);
        sf.stdin.write(`go depth ${DEPTH}\n`);
        return;
      }

      if (searching && line.startsWith('info ')) {
        const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);

        if (scoreMatch) {
          lastScore = {
            type: scoreMatch[1],
            value: Number(scoreMatch[2])
          };
        }

        const pvIndex = line.indexOf(' pv ');
        if (pvIndex !== -1) {
          lastPv = line.slice(pvIndex + 4).trim();
        }

        return;
      }

      if (searching && line.startsWith('bestmove ')) {
        const bestMove =
          line.match(/^bestmove ([^\s]+)/)?.[1] || null;

        finish({
          score: lastScore,
          bestMove:
            bestMove === '(none)' ? null : bestMove,
          pv: lastPv
        });
      }
    });

    sf.stdin.write('uci\n');
  });
}

async function main() {
  const gameId = process.argv[2];

  if (!gameId) {
    console.error(
      'Usage: node backend/analyze-game.js <gameId>'
    );
    process.exit(1);
  }

  const gamePath = path.join(
    __dirname,
    'data',
    'games',
    `${gameId}.json`
  );

  if (!fs.existsSync(gamePath)) {
    throw new Error(`Game not found: ${gamePath}`);
  }

  const game = JSON.parse(
    fs.readFileSync(gamePath, 'utf8')
  );

  const chess = new Chess();
  chess.loadPgn(game.pgn);

  const history = chess.history({ verbose: true });
  const replay = new Chess();
  const moves = [];

  for (let i = 0; i < history.length; i++) {
    const move = history[i];

    const beforeFen = replay.fen();
    const analysis = await analyzeFen(beforeFen);

    const played = replay.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion
    });

    moves.push({
      ply: i + 1,
      san: played.san,
      uci:
        `${played.from}${played.to}` +
        `${played.promotion || ''}`,
      beforeFen,
      afterFen: replay.fen(),
      evaluationBefore: analysis.score,
      bestMove: analysis.bestMove,
      principalVariation: analysis.pv
    });

    console.log(
      `#${i + 1} ${played.san}` +
      ` | eval=${JSON.stringify(analysis.score)}` +
      ` | best=${analysis.bestMove}`
    );
  }

  const finalPosition = await analyzeFen(replay.fen());

  const result = {
    gameId: game.gameId,
    generatedAt: new Date().toISOString(),
    engine: {
      name: 'Stockfish 14.1',
      depth: DEPTH
    },
    players: {
      A: game.playerA,
      B: game.playerB
    },
    result: game.result,
    termination: game.termination,
    pgn: game.pgn,
    moves,
    finalPosition
  };

  const outPath = path.join(
    __dirname,
    'data',
    'analysis',
    `${gameId}.json`
  );

  fs.writeFileSync(
    outPath,
    JSON.stringify(result, null, 2)
  );

  console.log('');
  console.log(`ANALYSIS_SAVED ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
