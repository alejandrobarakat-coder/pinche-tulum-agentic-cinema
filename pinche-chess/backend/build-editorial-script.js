const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

const gameId = process.argv[2];

if (!gameId) {
  console.error(
    'Usage: node backend/build-editorial-script.js <gameId>'
  );
  process.exit(1);
}

const inputPath = path.join(
  __dirname,
  'data',
  'analysis',
  `${gameId}.summary.json`
);

if (!fs.existsSync(inputPath)) {
  throw new Error(`Summary not found: ${inputPath}`);
}

const summary = JSON.parse(
  fs.readFileSync(inputPath, 'utf8')
);


const PIECE_NAMES = {
  K: 'king',
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight'
};

const FILE_NAMES = {
  a: 'a',
  b: 'b',
  c: 'c',
  d: 'd',
  e: 'e',
  f: 'f',
  g: 'g',
  h: 'h'
};

const RANK_NAMES = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight'
};

function capitalizeSpeech(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function squareToSpeech(square) {
  if (!square || !/^[a-h][1-8]$/.test(square)) {
    return square || '';
  }

  return `${FILE_NAMES[square[0]]} ${RANK_NAMES[square[1]]}`;
}

function sanToSpeech(san) {
  if (typeof san !== 'string' || !san.trim()) {
    return '';
  }

  let value = san.trim();

  // Remove annotation glyphs while preserving chess meaning.
  value = value.replace(/[!?]+$/g, '');

  const isMate = value.endsWith('#');
  const isCheck = !isMate && value.endsWith('+');

  value = value.replace(/[+#]$/g, '');

  if (value === 'O-O' || value === '0-0') {
    return `king-side castle${isCheck ? ', check' : ''}${isMate ? ', checkmate' : ''}`;
  }

  if (value === 'O-O-O' || value === '0-0-0') {
    return `queen-side castle${isCheck ? ', check' : ''}${isMate ? ', checkmate' : ''}`;
  }

  let promotion = null;
  const promotionMatch = value.match(/=([QRBN])$/);

  if (promotionMatch) {
    promotion = PIECE_NAMES[promotionMatch[1]];
    value = value.replace(/=([QRBN])$/, '');
  }

  const destinationMatch = value.match(/([a-h][1-8])$/);

  if (!destinationMatch) {
    return san;
  }

  const destination = destinationMatch[1];
  const destinationSpeech = squareToSpeech(destination);
  const isCapture = value.includes('x');

  let prefix = value.slice(0, -2);
  const pieceLetter = /^[KQRBN]/.test(prefix) ? prefix[0] : null;
  const pieceName = pieceLetter ? PIECE_NAMES[pieceLetter] : 'pawn';

  if (pieceLetter) {
    prefix = prefix.slice(1);
  }

  prefix = prefix.replace('x', '');

  let spoken;

  if (pieceName === 'pawn') {
    if (isCapture) {
      const sourceFile = prefix && /^[a-h]/.test(prefix)
        ? `${prefix[0]} pawn`
        : 'pawn';

      spoken = `${sourceFile} takes ${destinationSpeech}`;
    } else {
      spoken = `pawn to ${destinationSpeech}`;
    }
  } else {
    let disambiguation = '';

    if (prefix) {
      if (/^[a-h]$/.test(prefix)) {
        disambiguation = ` from the ${prefix} file`;
      } else if (/^[1-8]$/.test(prefix)) {
        disambiguation = ` from rank ${prefix}`;
      } else if (/^[a-h][1-8]$/.test(prefix)) {
        disambiguation = ` from ${squareToSpeech(prefix)}`;
      }
    }

    spoken = isCapture
      ? `${pieceName}${disambiguation} takes ${destinationSpeech}`
      : `${pieceName}${disambiguation} to ${destinationSpeech}`;
  }

  if (promotion) {
    spoken += `, promoting to ${promotion}`;
  }

  if (isMate) {
    spoken += ', checkmate';
  } else if (isCheck) {
    spoken += ', check';
  }

  return spoken;
}

const dataDir = path.join(__dirname, 'data', 'analysis');

function readJson(name) {
  const file = path.join(dataDir, `${gameId}.${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Required editorial input not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const classified = readJson('classified');
const health = readJson('health');

const playerA = summary.players?.A?.name || 'White';
const playerB = summary.players?.B?.name || 'Black';
const termination = summary.termination || 'unknown';

function ordinal(n) {
  const words = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth'
  };

  if (words[n]) return words[n];

  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function turnToSpeech(ply) {
  const moveNumber = Math.ceil(ply / 2);
  const side = ply % 2 === 1 ? 'White' : 'Black';
  return `${side}'s ${ordinal(moveNumber)} move`;
}

function bestMoveToSpeech(move) {
  if (!move?.bestMove || !move?.beforeFen) return '';

  try {
    const chess = new Chess(move.beforeFen);
    const uci = move.bestMove;

    const played = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined
    });

    return played?.san
      ? sanToSpeech(played.san)
      : `${squareToSpeech(uci.slice(0, 2))} to ${squareToSpeech(uci.slice(2, 4))}`;
  } catch (_) {
    return `${squareToSpeech(move.bestMove.slice(0, 2))} to ${squareToSpeech(move.bestMove.slice(2, 4))}`;
  }
}

function playerForMove(move) {
  return move.mover === 'white' ? playerA : playerB;
}

function spokenPlayerForMove(move) {
  const name = playerForMove(move);

  if (String(name).toLowerCase() === 'agrobot') {
    return move.mover === 'white' ? 'White' : 'Black';
  }

  return name;
}

function shouldNarrateMove(move, hp) {
  const loss = Number(move.centipawnLoss);
  const san = String(move.san || '');

  if (move.ply <= 8) return true;
  if (move.label === 'checkmate') return true;
  if (san.includes('=')) return true;

  if (hp?.capture && Number(hp.damage || 0) >= 7.69) {
    return true;
  }

  if (
    move.label === 'blunder' &&
    Number.isFinite(loss) &&
    loss >= 1000
  ) {
    return true;
  }

  return false;
}

function healthForPly(ply) {
  return health.timeline.find(item => item.ply === ply) || null;
}

function verdictSentence(move) {
  const name = spokenPlayerForMove(move);
  const spoken = capitalizeSpeech(sanToSpeech(move.san));

  switch (move.label) {
    case 'best':
      return `${name} plays ${spoken}. That's the strongest move.`;

    case 'good':
      return `${name} plays ${spoken}. A solid choice.`;

    case 'inaccuracy':
      return `${spoken}. Inaccuracy.`;

    case 'mistake':
      return `${spoken}. Mistake.`;

    case 'blunder':
      return `${spoken}. Blunder.`;

    case 'checkmate':
      return `${name} plays ${spoken}.`;

    case 'mate-maintained':
      return `${name} plays ${spoken}, keeping the forced mate alive.`;

    case 'missed-mate':
      return `${name} plays ${spoken}. A forced mate was missed.`;

    default:
      return `${name} plays ${spoken}.`;
  }
}

function recommendationSentence(move) {
  if (
    !move.bestMove ||
    ['best', 'good', 'checkmate'].includes(move.label)
  ) {
    return '';
  }

  return ` ${bestMoveToSpeech(move)} was the better move.`;
}

function healthSentence(move, hp) {
  return '';
}

function resultSentence() {
  const knownTermination =
    termination &&
    termination !== 'unknown';

  if (summary.result === 'DRAW') {
    if (knownTermination) {
      return `The game ends in a draw by ${termination}.`;
    }

    return `The game ends in a draw.`;
  }

  if (summary.winner) {
    if (knownTermination) {
      return `${summary.winner} wins by ${termination}.`;
    }

    return `${summary.winner} wins. The historical record does not specify how the game ended.`;
  }

  if (knownTermination) {
    return `The game is over by ${termination}.`;
  }

  return `The recorded game has ended.`;
}

function ratingSentence() {
  const white = summary.players?.A || {};
  const black = summary.players?.B || {};

  function sentence(player) {
    if (
      player.eloBefore == null ||
      player.eloAfter == null
    ) {
      return '';
    }

    const before = Number(player.eloBefore);
    const after = Number(player.eloAfter);

    if (
      !Number.isFinite(before) ||
      !Number.isFinite(after)
    ) {
      return '';
    }

    const delta = after - before;
    const name = String(player.name || 'The player');

    if (delta > 0) {
      return `${name} moves from ${before} to ${after}, gaining ${delta} rating points.`;
    }

    if (delta < 0) {
      return `${name} moves from ${before} to ${after}, losing ${Math.abs(delta)} rating points.`;
    }

    return `${name} remains at ${after} rating points.`;
  }

  return [
    sentence(white),
    sentence(black)
  ].filter(Boolean).join(' ');
}

const sections = [];

sections.push({
  id: 'brand_intro',
  type: 'BRAND_INTRO',
  speaker: 'ALEJANDRO',
  authority: 'Alejandro Barakat',
  visual: 'STUDIO_GOLD',
  showQr: true,
  text:
    `Welcome to Pinche Chess, a PincheTulum production. ` +
    `I'm Alejandro Barakat. Today we have ${playerA} versus ${playerB}. ` +
    `Every game tells a story. I'll take you through the critical decisions.`
});

sections.push({
  id: 'fight_card',
  type: 'FIGHT_CARD',
  speaker: 'ALEJANDRO',
  visual: 'BOARD_GOLD',
  playerA,
  playerB,
  whiteHealth: 100,
  blackHealth: 100,
  text:
    `The bars above the board follow the material battle. ` +
    `But in chess, the king decides the fight.`
});

for (const move of classified.moves || []) {
  const hp = healthForPly(move.ply);
  const spoken = sanToSpeech(move.san);
  const important = [
    'inaccuracy',
    'mistake',
    'blunder',
    'missed-mate',
    'mate-maintained',
    'checkmate'
  ].includes(move.label);

  let text =
    `` +
    verdictSentence(move) +
    recommendationSentence(move) +
    healthSentence(move, hp);

  if (important && move.evaluationPlayerAfter?.type === 'mate') {
    const distance = Math.abs(move.evaluationPlayerAfter.value || 0);

    if (distance > 0) {
      text += ` I now see a forced mate in ${distance}.`;
    }
  }

  const readAloud = shouldNarrateMove(move, hp);

  sections.push({
    id: `move_${move.ply}`,
    type: important ? 'CRITICAL_MOVE' : 'MOVE',
    readAloud,
    speaker: 'ALEJANDRO',
    authority: 'Alejandro Barakat',
    visual: 'BOARD_GOLD',
    ply: move.ply,
    turn: turnToSpeech(move.ply),
    player: playerForMove(move),
    move: move.san,
    spokenMove: spoken,
    uci: move.uci,
    classification: move.label,
    centipawnLoss: move.centipawnLoss,
    bestMove: move.bestMove || null,
    bestMoveSpeech: move.bestMove
      ? bestMoveToSpeech(move)
      : null,
    principalVariation: move.principalVariation || null,
    whiteHealth: hp?.whiteHealth ?? null,
    blackHealth: hp?.blackHealth ?? null,
    capture: hp?.capture ?? null,
    damage: hp?.damage ?? 0,
    check: hp?.check ?? false,
    checkmate: hp?.checkmate ?? false,
    ko: hp?.ko ?? null,
    freezeBoard: important,
    showRecommendation:
      Boolean(move.bestMove) &&
      !['best', 'good', 'checkmate'].includes(move.label),
    text
  });
}

const decisive = summary.highlights?.decisiveBlunder || null;

if (decisive && summary.result !== 'DRAW') {
  const move = classified.moves.find(m => m.ply === decisive.ply);

  sections.push({
    id: 'agrobot_verdict',
    type: 'AGROBOT_VERDICT',
    speaker: 'ALEJANDRO',
    authority: 'Alejandro Barakat',
    visual: 'BOARD_GOLD',
    ply: decisive.ply,
    move: decisive.san,
    bestMove: decisive.bestMove || null,
    bestMoveSpeech: decisive.bestMove && move
      ? bestMoveToSpeech(move)
      : null,
    freezeBoard: true,
    showRecommendation: Boolean(decisive.bestMove),
    text:
      `This was the turning point. ` +
      `${capitalizeSpeech(sanToSpeech(decisive.san))} changed the game decisively.` +
      (
        decisive.bestMove
          ? ` ${move ? bestMoveToSpeech(move) : decisive.bestMove} was the better move.`
          : ''
      ) +
      (
        move?.evaluationPlayerAfter?.type === 'mate'
          ? ` From here, the position became tactically critical.`
          : ''
      )
  });
}

sections.push({
  id: 'final_verdict',
  type: 'FINAL_VERDICT',
  speaker: 'ALEJANDRO',
  authority: 'Alejandro Barakat',
  visual: 'STUDIO_GOLD',
  showQr: true,
  text:
    `${resultSentence()} ` +
    `${ratingSentence()} ` +
    (
      summary.result === 'DRAW'
        ? `No knockout today. The final position belongs in the record as a draw.`
        : `The material tells one story. The position tells another. The result tells us who survived the board.`
    )
});

sections.push({
  id: 'pgn_scorecard',
  type: 'PGN_SCORECARD',
  speaker: null,
  visual: 'FINAL_SCORECARD',
  showQr: true,
  readAloud: false,
  playerA,
  playerB,
  playerAElo: summary.players?.A?.elo ?? null,
  playerAEloBefore: summary.players?.A?.eloBefore ?? null,
  playerAEloAfter: summary.players?.A?.eloAfter ?? null,
  playerAEloDelta: summary.players?.A?.eloDelta ?? null,
  playerBElo: summary.players?.B?.elo ?? null,
  playerBEloBefore: summary.players?.B?.eloBefore ?? null,
  playerBEloAfter: summary.players?.B?.eloAfter ?? null,
  playerBEloDelta: summary.players?.B?.eloDelta ?? null,
  result: summary.result,
  termination,
  pgn: summary.pgn,
  text: ''
});

sections.push({
  id: 'brand_outro',
  type: 'BRAND_OUTRO',
  speaker: 'ALEJANDRO',
  authority: 'Alejandro Barakat',
  visual: 'STUDIO_GOLD',
  showQr: true,
  text:
    `You've been watching Pinche Chess, a PincheTulum production. ` +
    `Analysis and coaching by Alejandro Barakat. I'm Alejandro Barakat. See you at the board.`
});

const script = {
  gameId: summary.gameId,
  generatedAt: new Date().toISOString(),
  language: 'en-GB',
  narrator: 'Alejandro Barakat',
  narratorRole: 'editorial chess commentator',
  analyticalAuthority: 'Alejandro Barakat',
  editorialRule:
    'Alejandro Barakat analyzes, coaches and explains the critical moments.',
  format: 'agrochess-postgame-v2',
  production: {
    brand: 'Pinche Chess',
    publisher: 'PincheTulum',
    analysis: 'Alejandro Barakat',
    visualTheme: 'BLACK_GOLD',
    persistentQr: true
  },
  source: {
    players: summary.players,
    winner: summary.winner,
    loser: summary.loser,
    result: summary.result,
    termination: summary.termination,
    pgn: summary.pgn
  },
  sections,
  fullText: sections
    .filter(section => section.readAloud !== false && section.text)
    .map(section => section.text)
    .join('\n\n')
};

const outputPath = path.join(
  __dirname,
  'data',
  'analysis',
  `${gameId}.script.json`
);

fs.writeFileSync(
  outputPath,
  JSON.stringify(script, null, 2)
);

console.log('===== EDITORIAL SCRIPT =====');
console.log(JSON.stringify(script, null, 2));
console.log('');
console.log(`SCRIPT_SAVED ${outputPath}`);
