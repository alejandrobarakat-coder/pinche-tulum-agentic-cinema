'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { WebSocketServer, WebSocket } = require('ws');
const { Chess } = require('chess.js');
const {
  deleteChessPlayer
} = require('./agrochess-store.js');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3020);
const RECONNECT_GRACE_MS = 30000;

const INITIAL_CLOCK_MS = 10 * 60 * 1000;
const INCREMENT_MS = 5 * 1000;

const GAMES_DIR = path.join(__dirname, 'data', 'games');
const RATINGS_FILE = path.join(__dirname, 'data', 'ratings.json');
const DELETE_TOKENS_FILE = path.join(__dirname, 'data', 'player-delete-tokens.json');
const INITIAL_ELO = 1500;
const ELO_K = 32;
const RUNTIME_DIR =
  process.env.PINCHE_CHESS_RUNTIME_DIR ||
  path.join(__dirname, 'data');

const AGROBOL_MATCHES_DIR =
  process.env.AGROBOL_MATCHES_DIR ||
  path.join(RUNTIME_DIR, 'matches');

const IDENTITY_MAP_FILE =
  process.env.IDENTITY_MAP_FILE ||
  path.join(RUNTIME_DIR, 'identity-map.json');

const PLAYER_LOOKUP_DIR =
  process.env.PLAYER_LOOKUP_DIR ||
  path.join(RUNTIME_DIR, 'players');

const PLAYER_PROFILE_DIRS = (
  process.env.PLAYER_PROFILE_DIRS || ''
)
  .split(path.delimiter)
  .filter(Boolean);

fs.mkdirSync(GAMES_DIR, { recursive: true });

const waiting = [];
const socketToGame = new Map();
const games = new Map();

function readRatings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8'));

    return {
      version: parsed.version || '1.0.0',
      initialElo: INITIAL_ELO,
      k: ELO_K,
      players: parsed.players || {},
      games: parsed.games || {}
    };
  } catch {
    return {
      version: '1.0.0',
      initialElo: INITIAL_ELO,
      k: ELO_K,
      players: {},
      games: {}
    };
  }
}

function writeRatings(state) {
  fs.mkdirSync(path.dirname(RATINGS_FILE), { recursive: true });

  const tmp = `${RATINGS_FILE}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(state, null, 2),
    'utf8'
  );

  fs.renameSync(tmp, RATINGS_FILE);
}

function readDeleteTokens() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(DELETE_TOKENS_FILE, 'utf8')
    );

    return parsed && typeof parsed === 'object'
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeDeleteTokens(tokens) {
  fs.mkdirSync(
    path.dirname(DELETE_TOKENS_FILE),
    { recursive: true }
  );

  const tmp =
    `${DELETE_TOKENS_FILE}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(tokens, null, 2),
    'utf8'
  );

  fs.renameSync(tmp, DELETE_TOKENS_FILE);
}

function registerDeleteToken(playerId, deleteToken) {
  const id = String(playerId || '').trim();
  const token = String(deleteToken || '').trim();

  if (
    !id ||
    !/^[a-f0-9-]{36}$/i.test(token)
  ) {
    return false;
  }

  const tokens = readDeleteTokens();

  if (tokens[id]) {
    return tokens[id] === token;
  }

  const ratings = readRatings();

  if (ratings.players && ratings.players[id]) {
    console.warn(
      `DELETE_TOKEN_NOT_REGISTERED existing_player=${id}`
    );
    return false;
  }

  tokens[id] = token;
  writeDeleteTokens(tokens);

  console.log(
    `DELETE_TOKEN_REGISTERED player=${id}`
  );

  return true;
}

function safeDeletePlayerId(value) {
  const id = String(value || '').trim();

  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(id)) {
    throw new Error('invalid_player_id');
  }

  return id;
}

function verifyDeleteToken(playerId, suppliedToken) {
  const tokens = readDeleteTokens();
  const stored = String(tokens[playerId] || '');
  const supplied = String(suppliedToken || '');

  if (!stored || !supplied) {
    return false;
  }

  const a = Buffer.from(stored);
  const b = Buffer.from(supplied);

  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

function removeFileIfExists(file) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }

  return false;
}

function deletePlayerProfile(playerId, deleteToken) {
  const id = safeDeletePlayerId(playerId);

  if (!verifyDeleteToken(id, deleteToken)) {
    return {
      ok: false,
      status: 403,
      error: 'invalid_delete_credentials'
    };
  }

  let vendor = '';

  try {
    const map = JSON.parse(
      fs.readFileSync(IDENTITY_MAP_FILE, 'utf8')
    );

    const identity =
      map?.identities?.[id] || null;

    vendor =
      String(identity?.vendor || '').trim();

    if (map?.identities?.[id]) {
      delete map.identities[id];

      const tmp =
        `${IDENTITY_MAP_FILE}.${process.pid}.${Date.now()}.tmp`;

      fs.writeFileSync(
        tmp,
        JSON.stringify(map, null, 2),
        'utf8'
      );

      fs.renameSync(tmp, IDENTITY_MAP_FILE);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  deleteChessPlayer(id);

  removeFileIfExists(
    path.join(
      PLAYER_LOOKUP_DIR,
      `${id}.json`
    )
  );

  if (vendor) {
    for (const dir of PLAYER_PROFILE_DIRS) {
      removeFileIfExists(
        path.join(
          dir,
          `${vendor}.html`
        )
      );
    }

    removeFileIfExists(
      path.join(
        process.env.PINCHE_TULUM_VENDOR_DIR ||
          path.join(RUNTIME_DIR, 'vendors'),
        `${vendor}-chess-mobile.html`
      )
    );
  }

  const ratings = readRatings();

  if (ratings.players?.[id]) {
    delete ratings.players[id];
    writeRatings(ratings);
  }

  const tokens = readDeleteTokens();

  if (tokens[id]) {
    delete tokens[id];
    writeDeleteTokens(tokens);
  }

  console.log(
    `PLAYER_PROFILE_DELETED player=${id} vendor=${vendor || 'none'}`
  );

  return {
    ok: true,
    deleted: true,
    playerId: id
  };
}

function ensureRatingPlayer(state, playerId, playerName) {
  const id = String(playerId);

  if (!state.players[id]) {
    state.players[id] = {
      playerId: id,
      name: String(playerName || 'Guest'),
      elo: INITIAL_ELO,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  if (playerName) {
    state.players[id].name = String(playerName);
  }

  return state.players[id];
}

function expectedScore(rating, opponentRating) {
  return 1 / (
    1 + Math.pow(
      10,
      (opponentRating - rating) / 400
    )
  );
}

function applyElo(gameId, result, whiteInfo, blackInfo) {
  const state = readRatings();

  // Idempotencia: una partida sólo modifica Elo una vez.
  if (state.games[gameId]) {
    return state.games[gameId];
  }

  const white = ensureRatingPlayer(
    state,
    whiteInfo.id,
    whiteInfo.name
  );

  const black = ensureRatingPlayer(
    state,
    blackInfo.id,
    blackInfo.name
  );

  const whiteBefore = Number(white.elo || INITIAL_ELO);
  const blackBefore = Number(black.elo || INITIAL_ELO);

  let whiteScore = 0.5;
  let blackScore = 0.5;

  if (result === 'A' || result === '1-0') {
    whiteScore = 1;
    blackScore = 0;
  } else if (result === 'B' || result === '0-1') {
    whiteScore = 0;
    blackScore = 1;
  }

  const whiteExpected = expectedScore(
    whiteBefore,
    blackBefore
  );

  const blackExpected = expectedScore(
    blackBefore,
    whiteBefore
  );

  const whiteAfter = Math.round(
    whiteBefore +
      ELO_K * (whiteScore - whiteExpected)
  );

  const blackAfter = Math.round(
    blackBefore +
      ELO_K * (blackScore - blackExpected)
  );

  white.elo = whiteAfter;
  black.elo = blackAfter;

  white.gamesPlayed += 1;
  black.gamesPlayed += 1;

  if (whiteScore === 1) {
    white.wins += 1;
    black.losses += 1;
  } else if (blackScore === 1) {
    black.wins += 1;
    white.losses += 1;
  } else {
    white.draws += 1;
    black.draws += 1;
  }

  const updatedAt = new Date().toISOString();

  white.updatedAt = updatedAt;
  black.updatedAt = updatedAt;

  const ratingEvent = {
    gameId,
    result,
    white: {
      playerId: whiteInfo.id,
      eloBefore: whiteBefore,
      eloAfter: whiteAfter,
      eloDelta: whiteAfter - whiteBefore
    },
    black: {
      playerId: blackInfo.id,
      eloBefore: blackBefore,
      eloAfter: blackAfter,
      eloDelta: blackAfter - blackBefore
    },
    appliedAt: updatedAt
  };

  state.games[gameId] = ratingEvent;
  state.updatedAt = updatedAt;

  writeRatings(state);

  console.log(
    `ELO_APPLIED ${gameId} ` +
    `white=${whiteBefore}->${whiteAfter} ` +
    `black=${blackBefore}->${blackAfter}`
  );

  return ratingEvent;
}

function mirrorGameToAgroBol(gameOver) {
  try {
    fs.mkdirSync(
      AGROBOL_MATCHES_DIR,
      { recursive: true }
    );

    const filePath = path.join(
      AGROBOL_MATCHES_DIR,
      `${gameOver.gameId}.json`
    );

    const tmpPath =
      `${filePath}.${process.pid}.${Date.now()}.tmp`;

    const payload = {
      id: gameOver.gameId,
      gameId: gameOver.gameId,

      playerA: gameOver.playerA,
      playerB: gameOver.playerB,

      result: gameOver.result,
      termination: gameOver.termination,

      duration: gameOver.durationMinutes,
      duration_minutes: gameOver.durationMinutes,
      duration_seconds: gameOver.durationSeconds,

      pgn: gameOver.pgn,
      finalFen: gameOver.fen,

      played_at: gameOver.startedAt,
      created_at: gameOver.startedAt,
      finished_at: gameOver.endedAt,
      timestamp: Date.parse(gameOver.endedAt),

      source: 'pinche-chess',
      identity: 'playerId'
    };

    fs.writeFileSync(
      tmpPath,
      JSON.stringify(payload, null, 2),
      'utf8'
    );

    fs.renameSync(tmpPath, filePath);

    console.log(
      `AGROBOL_MATCH_EXPORTED ${gameOver.gameId} ${filePath}`
    );
  } catch (err) {
    // AgroBol nunca debe impedir que Chess termine una partida.
    console.error(
      `AGROBOL_MATCH_EXPORT_ERROR ${gameOver.gameId}`,
      err
    );
  }
}

function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type,
    payload
  }));
}

function removeFromQueue(ws) {
  const i = waiting.findIndex(p => p.ws === ws);
  if (i >= 0) waiting.splice(i, 1);
}

function playerBySocket(game, ws) {
  if (game.white.ws === ws) return game.white;
  if (game.black.ws === ws) return game.black;
  return null;
}

function playerById(game, playerId) {
  if (game.white.playerId === playerId) return game.white;
  if (game.black.playerId === playerId) return game.black;
  return null;
}

function opponentOf(game, player) {
  return game.white === player
    ? game.black
    : game.white;
}

function clearDisconnectTimer(player) {
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
}

function clearClockTimer(game) {
  if (game.clockTimer) {
    clearTimeout(game.clockTimer);
    game.clockTimer = null;
  }
}

function clockSnapshot(game) {
  let whiteMs = game.whiteMs;
  let blackMs = game.blackMs;

  if (!game.clockPaused && game.turnStartedAt) {
    const elapsed = Math.max(0, Date.now() - game.turnStartedAt);

    if (game.board.turn() === 'w') {
      whiteMs = Math.max(0, whiteMs - elapsed);
    } else {
      blackMs = Math.max(0, blackMs - elapsed);
    }
  }

  return {
    whiteMs: Math.round(whiteMs),
    blackMs: Math.round(blackMs),
    serverNow: Date.now()
  };
}

function consumeClock(game) {
  if (game.clockPaused || !game.turnStartedAt) {
    return;
  }

  const now = Date.now();
  const elapsed = Math.max(0, now - game.turnStartedAt);

  if (game.board.turn() === 'w') {
    game.whiteMs = Math.max(0, game.whiteMs - elapsed);
  } else {
    game.blackMs = Math.max(0, game.blackMs - elapsed);
  }

  game.turnStartedAt = now;
}

function finishTimeout(game) {
  clearClockTimer(game);

  const loser = game.board.turn();

  const result =
    loser === 'w'
      ? 'B'
      : 'A';

  finishGame(
    game,
    null,
    {
      result,
      termination: 'timeout'
    }
  );
}

function scheduleClock(game) {
  clearClockTimer(game);

  if (game.clockPaused || !games.has(game.id)) {
    return;
  }

  const remaining =
    game.board.turn() === 'w'
      ? game.whiteMs
      : game.blackMs;

  if (remaining <= 0) {
    finishTimeout(game);
    return;
  }

  game.clockTimer = setTimeout(() => {
    if (!games.has(game.id)) return;

    consumeClock(game);

    const activeRemaining =
      game.board.turn() === 'w'
        ? game.whiteMs
        : game.blackMs;

    if (activeRemaining <= 0) {
      finishTimeout(game);
    } else {
      scheduleClock(game);
    }
  }, remaining + 25);
}

function pauseClock(game) {
  if (game.clockPaused) return;

  consumeClock(game);
  clearClockTimer(game);

  game.clockPaused = true;
  game.turnStartedAt = null;
}

function resumeClock(game) {
  if (!game.clockPaused) return;

  game.clockPaused = false;
  game.turnStartedAt = Date.now();

  scheduleClock(game);
}

function ratingForMatchmaking(player, ratings) {
  const stored =
    ratings.players?.[String(player.playerId)];

  const elo = Number(stored?.elo);

  return Number.isFinite(elo)
    ? elo
    : INITIAL_ELO;
}

function matchPlayers(preferredSocketId = null) {
  while (waiting.length >= 2) {
    const ratings = readRatings();

    let anchorIndex = preferredSocketId
      ? waiting.findIndex(
          player => player.id === preferredSocketId
        )
      : 0;

    if (anchorIndex < 0) {
      anchorIndex = 0;
    }

    const anchor = waiting.splice(anchorIndex, 1)[0];
    const anchorElo =
      ratingForMatchmaking(anchor, ratings);

    let bestIndex = -1;
    let bestDifference = Infinity;

    for (let i = 0; i < waiting.length; i += 1) {
      if (
        String(waiting[i].playerId) ===
        String(anchor.playerId)
      ) {
        continue;
      }

      const candidateElo =
        ratingForMatchmaking(waiting[i], ratings);

      const difference =
        Math.abs(anchorElo - candidateElo);

      if (difference < bestDifference) {
        bestDifference = difference;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      waiting.unshift(anchor);
      return;
    }

    const opponent =
      waiting.splice(bestIndex, 1)[0];

    const opponentElo =
      ratingForMatchmaking(opponent, ratings);

    // Conservamos la semántica anterior:
    // quien ya esperaba queda con blancas;
    // quien acaba de entrar queda con negras.
    const anchorWasPreferred =
      preferredSocketId &&
      anchor.id === preferredSocketId;

    const white =
      anchorWasPreferred ? opponent : anchor;

    const black =
      anchorWasPreferred ? anchor : opponent;

    console.log(
      `MATCHMAKING_ELO ` +
      `${anchor.playerName}=${anchorElo} ` +
      `${opponent.playerName}=${opponentElo} ` +
      `difference=${Math.abs(anchorElo - opponentElo)}`
    );

    preferredSocketId = null;

    if (
      white.ws.readyState !== WebSocket.OPEN ||
      black.ws.readyState !== WebSocket.OPEN
    ) {
      continue;
    }

    const game = {
      id: crypto.randomUUID(),
      board: new Chess(),
      white,
      black,
      sequence: 0,
      createdAt: Date.now(),
      whiteMs: INITIAL_CLOCK_MS,
      blackMs: INITIAL_CLOCK_MS,
      turnStartedAt: Date.now(),
      clockPaused: false,
      clockTimer: null
    };

    games.set(game.id, game);

    // IMPORTANTE:
    // asociación autoritativa socket -> game
    socketToGame.set(white.ws, game);
    socketToGame.set(black.ws, game);

    send(white.ws, 'GAME_START', {
      gameId: game.id,
      color: 'white',
      fen: game.board.fen(),
      turn: 'w',
      sequence: 0,
      timeControl: {
        initialMs: INITIAL_CLOCK_MS,
        incrementMs: INCREMENT_MS
      },
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      serverNow: Date.now(),
      player: {
        id: white.playerId,
        name: white.playerName,
        wallet: white.wallet
      },
      opponent: {
        id: black.playerId,
        name: black.playerName,
        wallet: black.wallet
      }
    });

    send(black.ws, 'GAME_START', {
      gameId: game.id,
      color: 'black',
      fen: game.board.fen(),
      turn: 'w',
      sequence: 0,
      timeControl: {
        initialMs: INITIAL_CLOCK_MS,
        incrementMs: INCREMENT_MS
      },
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      serverNow: Date.now(),
      player: {
        id: black.playerId,
        name: black.playerName,
        wallet: black.wallet
      },
      opponent: {
        id: white.playerId,
        name: white.playerName,
        wallet: white.wallet
      }
    });

    scheduleClock(game);

    console.log(
      `GAME_START ${game.id} white=${white.id} black=${black.id}`
    );
  }
}

function parseMove(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const from = String(payload.from || '').toLowerCase();
  const to = String(payload.to || '').toLowerCase();
  const promotion = payload.promotion
    ? String(payload.promotion).toLowerCase()
    : undefined;

  if (!/^[a-h][1-8]$/.test(from)) return null;
  if (!/^[a-h][1-8]$/.test(to)) return null;

  if (
    promotion !== undefined &&
    !['q', 'r', 'b', 'n'].includes(promotion)
  ) {
    return null;
  }

  return { from, to, promotion };
}


function getTermination(board) {
  if (board.isCheckmate()) {
    return 'checkmate';
  }

  if (board.isStalemate()) {
    return 'stalemate';
  }

  if (board.isThreefoldRepetition()) {
    return 'threefold_repetition';
  }

  if (board.isInsufficientMaterial()) {
    return 'insufficient_material';
  }

  if (board.isDraw()) {
    return 'draw';
  }

  return 'game_over';
}

function getResult(board, lastMove) {
  if (board.isCheckmate()) {
    return lastMove.color === 'w'
      ? 'A'
      : 'B';
  }

  return 'DRAW';
}


function runPostGamePipeline(gameId) {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'post-game-pipeline.js'), gameId],
    {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  child.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.log(`[POST_GAME] ${text}`);
  });

  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.error(`[POST_GAME_ERROR] ${text}`);
  });

  child.on('error', (err) => {
    console.error(
      `POST_GAME_PIPELINE_SPAWN_ERROR ${gameId}: ${err.message}`
    );
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log(`POST_GAME_PIPELINE_COMPLETE ${gameId}`);
    } else {
      console.error(
        `POST_GAME_PIPELINE_EXIT ${gameId} code=${code}`
      );
    }
  });
}

function persistGame(gameOver) {
  const filePath = path.join(
    GAMES_DIR,
    `${gameOver.gameId}.json`
  );

  const tmpPath = `${filePath}.tmp`;

  fs.writeFileSync(
    tmpPath,
    JSON.stringify(gameOver, null, 2),
    'utf8'
  );

  fs.renameSync(tmpPath, filePath);

  console.log(
    `GAME_SAVED ${gameOver.gameId} ${filePath}`
  );

  mirrorGameToAgroBol(gameOver);

  runPostGamePipeline(gameOver.gameId);
}

function finishGame(game, lastMove, override = {}) {
  clearDisconnectTimer(game.white);
  clearDisconnectTimer(game.black);
  clearClockTimer(game);

  consumeClock(game);

  const endedAt = Date.now();

  const durationSeconds =
    Math.max(
      0,
      Math.round(
        (endedAt - game.createdAt) / 1000
      )
    );

  const durationMinutes =
    Math.max(
      0,
      Math.round(
        durationSeconds / 60
      )
    );

  const result =
    override.result ||
    getResult(
      game.board,
      lastMove
    );

  const termination =
    override.termination ||
    getTermination(
      game.board
    );

  let ratingEvent = null;

  try {
    ratingEvent = applyElo(
      game.id,
      result,
      {
        id: game.white.playerId,
        name: game.white.playerName
      },
      {
        id: game.black.playerId,
        name: game.black.playerName
      }
    );
  } catch (err) {
    console.error(
      `ELO_ERROR ${game.id}`,
      err
    );
  }

  const gameOver = {
    gameId: game.id,
    result,
    termination,
    sequence: game.sequence,
    fen: game.board.fen(),
    pgn: game.board.pgn(),
    durationSeconds,
    durationMinutes,
    timeControl: {
      initialMs: INITIAL_CLOCK_MS,
      incrementMs: INCREMENT_MS
    },
    whiteMs: Math.round(game.whiteMs),
    blackMs: Math.round(game.blackMs),
    playerA: {
      id: game.white.playerId,
      name: game.white.playerName,
      wallet: game.white.wallet,
      elo:
        ratingEvent?.white?.eloAfter ??
        INITIAL_ELO,
      eloBefore:
        ratingEvent?.white?.eloBefore ??
        INITIAL_ELO,
      eloAfter:
        ratingEvent?.white?.eloAfter ??
        INITIAL_ELO,
      eloDelta:
        ratingEvent?.white?.eloDelta ?? 0
    },
    playerB: {
      id: game.black.playerId,
      name: game.black.playerName,
      wallet: game.black.wallet,
      elo:
        ratingEvent?.black?.eloAfter ??
        INITIAL_ELO,
      eloBefore:
        ratingEvent?.black?.eloBefore ??
        INITIAL_ELO,
      eloAfter:
        ratingEvent?.black?.eloAfter ??
        INITIAL_ELO,
      eloDelta:
        ratingEvent?.black?.eloDelta ?? 0
    },
    startedAt:
      new Date(
        game.createdAt
      ).toISOString(),
    endedAt:
      new Date(
        endedAt
      ).toISOString()
  };

  try {
    persistGame(gameOver);
  } catch (err) {
    console.error(
      `GAME_SAVE_ERROR ${game.id}`,
      err
    );
  }

  send(
    game.white.ws,
    'GAME_OVER',
    gameOver
  );

  send(
    game.black.ws,
    'GAME_OVER',
    gameOver
  );

  socketToGame.delete(
    game.white.ws
  );

  socketToGame.delete(
    game.black.ws
  );

  games.delete(
    game.id
  );

  console.log(
    `GAME_OVER ${game.id} result=${result} termination=${termination}`
  );

  return gameOver;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json'
    });

    return res.end(JSON.stringify({
      ok: true,
      service: 'chess-mvp',
      port: PORT
    }));
  }

  if (
    req.method === 'DELETE' &&
    req.url === '/player'
  ) {
    let body = '';
    let tooLarge = false;

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 16384) {
        tooLarge = true;
      }
    });

    req.on('end', () => {
      if (tooLarge) {
        res.writeHead(413, {
          'Content-Type': 'application/json'
        });

        return res.end(JSON.stringify({
          ok: false,
          error: 'request_too_large'
        }));
      }

      try {
        const payload =
          JSON.parse(body || '{}');

        const result =
          deletePlayerProfile(
            payload.playerId,
            payload.deleteToken
          );

        res.writeHead(
          result.status || 200,
          {
            'Content-Type':
              'application/json'
          }
        );

        return res.end(
          JSON.stringify(result)
        );
      } catch (err) {
        console.error(
          'PLAYER_DELETE_ERROR',
          err
        );

        res.writeHead(400, {
          'Content-Type': 'application/json'
        });

        return res.end(JSON.stringify({
          ok: false,
          error: err.message || 'delete_failed'
        }));
      }
    });

    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server,
  path: '/ws'
});

wss.on('connection', ws => {
  ws.id = crypto.randomUUID();
  ws.alive = true;

  console.log(`CONNECTED ${ws.id}`);

  send(ws, 'HELLO', {
    clientId: ws.id,
    protocol: 1
  });

  ws.on('pong', () => {
    ws.alive = true;
  });

  ws.on('message', raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(ws, 'ERROR', {
        code: 'INVALID_JSON'
      });
    }

    if (message.type === 'JOIN') {
      if (socketToGame.has(ws)) {
        return send(ws, 'ERROR', {
          code: 'ALREADY_IN_GAME'
        });
      }

      removeFromQueue(ws);

      const playerPayload =
        message.payload &&
        typeof message.payload === 'object'
          ? message.payload
          : {};

      waiting.push({
        id: ws.id,
        playerId:
          String(playerPayload.playerId || ws.id),
        playerName:
          String(playerPayload.playerName || 'Guest'),
        wallet:
          String(playerPayload.wallet || ''),
        ws
      });

      registerDeleteToken(
        String(playerPayload.playerId || ws.id),
        playerPayload.deleteToken
      );

      send(ws, 'WAITING', {
        position: waiting.length
      });

      matchPlayers(ws.id);
      return;
    }

    if (message.type === 'RESUME') {
      const payload =
        message.payload &&
        typeof message.payload === 'object'
          ? message.payload
          : {};

      const gameId =
        String(payload.gameId || '');

      const playerId =
        String(payload.playerId || '');

      if (!gameId || !playerId) {
        return send(ws, 'ERROR', {
          code: 'INVALID_RESUME'
        });
      }

      const game = games.get(gameId);

      if (!game) {
        return send(ws, 'ERROR', {
          code: 'GAME_NOT_FOUND'
        });
      }

      const player =
        playerById(game, playerId);

      if (!player) {
        return send(ws, 'ERROR', {
          code: 'RESUME_FORBIDDEN'
        });
      }

      if (
        player.ws &&
        player.ws !== ws &&
        player.ws.readyState === WebSocket.OPEN
      ) {
        return send(ws, 'ERROR', {
          code: 'PLAYER_ALREADY_CONNECTED'
        });
      }

      if (player.ws && player.ws !== ws) {
        socketToGame.delete(player.ws);
      }

      clearDisconnectTimer(player);

      player.ws = ws;
      player.disconnectedAt = null;

      socketToGame.set(ws, game);

      const opponent =
        opponentOf(game, player);

      const color =
        game.white === player
          ? 'white'
          : 'black';

      send(ws, 'GAME_RESUMED', {
        gameId: game.id,
        color,
        fen: game.board.fen(),
        turn: game.board.turn(),
        sequence: game.sequence,
        timeControl: {
          initialMs: INITIAL_CLOCK_MS,
          incrementMs: INCREMENT_MS
        },
        ...clockSnapshot(game),
        player: {
          id: player.playerId,
          name: player.playerName,
          wallet: player.wallet
        },
        opponent: {
          id: opponent.playerId,
          name: opponent.playerName,
          wallet: opponent.wallet
        }
      });

      if (
        game.white.ws &&
        game.black.ws &&
        game.white.ws.readyState === WebSocket.OPEN &&
        game.black.ws.readyState === WebSocket.OPEN
      ) {
        resumeClock(game);
      }

      send(
        opponent.ws,
        'OPPONENT_RECONNECTED',
        {
          gameId: game.id,
          playerId: player.playerId,
          ...clockSnapshot(game)
        }
      );

      console.log(
        `GAME_RESUMED ${game.id} player=${player.playerId}`
      );

      return;
    }

    if (message.type === 'RESIGN') {
      const game = socketToGame.get(ws);

      if (!game) {
        return send(ws, 'ERROR', {
          code: 'GAME_NOT_FOUND'
        });
      }

      const isWhite = game.white.ws === ws;
      const isBlack = game.black.ws === ws;

      if (!isWhite && !isBlack) {
        return send(ws, 'ERROR', {
          code: 'PLAYER_NOT_IN_GAME'
        });
      }

      finishGame(
        game,
        null,
        {
          result: isWhite ? 'B' : 'A',
          termination: 'resignation'
        }
      );

      return;
    }

    if (message.type === 'MOVE') {
      const game = socketToGame.get(ws);

      if (!game) {
        return send(ws, 'ERROR', {
          code: 'GAME_NOT_FOUND'
        });
      }

      const isWhite = game.white.ws === ws;
      const isBlack = game.black.ws === ws;

      if (!game.white.ws || !game.black.ws) {
        return send(ws, 'ERROR', {
          code: 'GAME_PAUSED_OPPONENT_RECONNECTING'
        });
      }

      const expected =
        game.board.turn() === 'w'
          ? game.white.ws
          : game.black.ws;

      if (ws !== expected) {
        return send(ws, 'ERROR', {
          code: 'NOT_YOUR_TURN'
        });
      }

      consumeClock(game);

      const activeRemaining =
        game.board.turn() === 'w'
          ? game.whiteMs
          : game.blackMs;

      if (activeRemaining <= 0) {
        finishTimeout(game);
        return;
      }

      const requested = parseMove(message.payload);

      if (!requested) {
        return send(ws, 'ERROR', {
          code: 'INVALID_MOVE_FORMAT'
        });
      }

      let move;

      try {
        move = game.board.move({
          from: requested.from,
          to: requested.to,
          promotion: requested.promotion || 'q'
        });
      } catch {
        move = null;
      }

      if (!move) {
        return send(ws, 'ERROR', {
          code: 'ILLEGAL_MOVE'
        });
      }

      game.sequence += 1;

      if (move.color === 'w') {
        game.whiteMs += INCREMENT_MS;
      } else {
        game.blackMs += INCREMENT_MS;
      }

      game.turnStartedAt = Date.now();
      scheduleClock(game);

      const uci =
        move.from +
        move.to +
        (move.promotion || '');

      const state = {
        gameId: game.id,
        sequence: game.sequence,
        uci,
        san: move.san,
        fen: game.board.fen(),
        turn: game.board.turn(),
        ...clockSnapshot(game)
      };

      send(game.white.ws, 'GAME_STATE', state);
      send(game.black.ws, 'GAME_STATE', state);

      console.log(
        `MOVE ${game.id} #${game.sequence} ${uci} ${move.san}`
      );

      if (game.board.isGameOver()) {
        finishGame(
          game,
          move
        );
      }

      return;
    }

    send(ws, 'ERROR', {
      code: 'UNKNOWN_MESSAGE'
    });
  });

  ws.on('error', error => {
    console.error(
      `WS_ERROR ${ws.id} message=${error?.message || 'unknown'}`
    );
  });

  ws.on('close', (code, reason) => {
    console.log(
      `DISCONNECTED ${ws.id} code=${code} reason=${reason?.toString() || '-'}`
    );

    removeFromQueue(ws);

    const game = socketToGame.get(ws);

    if (!game) {
      return;
    }

    const player =
      playerBySocket(game, ws);

    socketToGame.delete(ws);

    if (!player) {
      return;
    }

    const opponent =
      opponentOf(game, player);

    player.ws = null;
    player.disconnectedAt = Date.now();

      pauseClock(game);

    clearDisconnectTimer(player);

    send(
      opponent.ws,
      'OPPONENT_RECONNECTING',
      {
        gameId: game.id,
        playerId: player.playerId,
        graceSeconds:
          Math.round(
            RECONNECT_GRACE_MS / 1000
          )
      }
    );

    console.log(
      `RECONNECT_GRACE ${game.id} player=${player.playerId}`
    );

    player.disconnectTimer =
      setTimeout(() => {
        if (!games.has(game.id)) {
          return;
        }

        if (player.ws) {
          return;
        }

        send(
          opponent.ws,
          'OPPONENT_DISCONNECTED',
          {
            gameId: game.id,
            playerId: player.playerId,
            reason: 'reconnect_timeout'
          }
        );

        clearDisconnectTimer(opponent);

        if (opponent.ws) {
          socketToGame.delete(
            opponent.ws
          );
        }

        games.delete(game.id);

        console.log(
          `RECONNECT_TIMEOUT ${game.id} player=${player.playerId}`
        );
      }, RECONNECT_GRACE_MS);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.alive === false) {
      ws.terminate();
      continue;
    }

    ws.alive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

server.listen(PORT, HOST, () => {
  console.log(`Chess MVP HTTP: http://${HOST}:${PORT}`);
  console.log(`Chess MVP WS:   ws://${HOST}:${PORT}/ws`);
});
