'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR =
  process.env.CHESS_DATA_DIR ||
  path.join(__dirname, 'data');

const PLAYERS_DIR =
  path.join(DATA_DIR, 'players');

fs.mkdirSync(PLAYERS_DIR, {
  recursive: true
});

function safeId(value) {
  const id = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 180);

  if (!id) {
    throw new Error('invalid_player_id');
  }

  return id;
}

function deleteChessPlayer(playerId) {
  const id = safeId(playerId);
  const file = path.join(
    PLAYERS_DIR,
    `${id}.json`
  );

  if (!fs.existsSync(file)) {
    return {
      ok: true,
      deleted: false,
      playerId: id
    };
  }

  fs.unlinkSync(file);

  return {
    ok: true,
    deleted: true,
    playerId: id
  };
}

module.exports = {
  deleteChessPlayer
};
