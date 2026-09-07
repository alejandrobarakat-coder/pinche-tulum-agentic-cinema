'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Chess } = require('chess.js');

const gameId = process.argv[2];

if (!gameId) {
  console.error(
    'Usage: node backend/build-publication-video.js GAME_ID'
  );
  process.exit(1);
}

const ROOT = __dirname;
const PROJECT = path.join(ROOT, '..');

const gamesDir =
  path.join(ROOT, 'data', 'games');

const analysisDir =
  path.join(ROOT, 'data', 'analysis');

const renderDir =
  path.join(ROOT, 'data', 'render-test');

const downloadsDir =
  process.env.PINCHE_CHESS_DOWNLOADS_DIR ||
  path.join(PROJECT, 'public', 'downloads');

const manifestPath =
  path.join(
    renderDir,
    `${gameId}-publication-manifest.json`
  );

const gamePath =
  path.join(gamesDir, `${gameId}.json`);

const scriptPath =
  path.join(
    analysisDir,
    `${gameId}.script.json`
  );

const publicBase =
  process.env.PINCHE_CHESS_PUBLIC_BASE ||
  'http://localhost:3020/downloads';

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8')
  );
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });

  const tmp =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  const fd = fs.openSync(tmp, 'wx', 0o644);

  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmp, file);
}

function atomicCopy(source, destination) {
  const dir = path.dirname(destination);

  fs.mkdirSync(dir, {
    recursive: true
  });

  const tmp =
    path.join(
      dir,
      `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`
    );

  fs.copyFileSync(source, tmp);
  fs.chmodSync(tmp, 0o644);

  const fd = fs.openSync(tmp, 'r');

  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmp, destination);
}

function run(cmd, args) {
  const r = spawnSync(
    cmd,
    args,
    {
      cwd: PROJECT,
      stdio: 'inherit'
    }
  );

  if (r.error) {
    throw r.error;
  }

  if (r.status !== 0) {
    fail(
      `${cmd} failed with exit code ${r.status}`
    );
  }
}

function capture(cmd, args) {
  const r = spawnSync(
    cmd,
    args,
    {
      cwd: PROJECT,
      encoding: 'utf8'
    }
  );

  if (r.error) {
    throw r.error;
  }

  if (r.status !== 0) {
    fail(
      `${cmd} failed: ${String(r.stderr || '').trim()}`
    );
  }

  return String(r.stdout || '').trim();
}

function sha256(file) {
  const hash =
    crypto.createHash('sha256');

  const fd = fs.openSync(file, 'r');

  try {
    const buffer =
      Buffer.allocUnsafe(1024 * 1024);

    while (true) {
      const bytes =
        fs.readSync(
          fd,
          buffer,
          0,
          buffer.length,
          null
        );

      if (!bytes) break;

      hash.update(
        bytes === buffer.length
          ? buffer
          : buffer.subarray(0, bytes)
      );
    }
  } finally {
    fs.closeSync(fd);
  }

  return hash.digest('hex');
}

function probe(file) {
  const duration = Number(
    capture(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file
      ]
    )
  );

  const dimensions =
    capture(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries',
        'stream=width,height',
        '-of', 'csv=s=x:p=0',
        file
      ]
    );

  const [width, height] =
    dimensions
      .split('x')
      .map(Number);

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    fail('INVALID_VIDEO_DURATION');
  }

  if (
    width !== 720 ||
    height !== 1280
  ) {
    fail(
      `INVALID_VIDEO_SIZE ${width}x${height}`
    );
  }

  return {
    durationSeconds:
      Number(duration.toFixed(3)),
    width,
    height
  };
}

function localFileFromVideoUrl(videoUrl) {
  try {
    const u = new URL(videoUrl);

    return path.join(
      downloadsDir,
      path.basename(u.pathname)
    );
  } catch (_) {
    return null;
  }
}

function existingArtifactIsValid() {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  let manifest;

  try {
    manifest = readJson(manifestPath);
  } catch (_) {
    return null;
  }

  if (
    manifest.gameId &&
    manifest.gameId !== gameId
  ) {
    return null;
  }

  if (
    manifest.format !== 'vertical-9x16' ||
    manifest.width !== 720 ||
    manifest.height !== 1280 ||
    !manifest.videoUrl ||
    !/^[a-f0-9]{64}$/i.test(
      manifest.sha256 || ''
    )
  ) {
    return null;
  }

  const local =
    localFileFromVideoUrl(
      manifest.videoUrl
    );

  if (
    !local ||
    !fs.existsSync(local)
  ) {
    return null;
  }

  const actualHash =
    sha256(local);

  if (
    actualHash.toLowerCase() !==
    manifest.sha256.toLowerCase()
  ) {
    return null;
  }

  const info = probe(local);

  return {
    manifest,
    local,
    info
  };
}

try {
  fs.mkdirSync(renderDir, {
    recursive: true
  });

  const existing =
    existingArtifactIsValid();

  if (existing) {
    console.log(
      `PUBLICATION_VIDEO_REUSE ${gameId}`
    );

    console.log(
      'VIDEO_URL:',
      existing.manifest.videoUrl
    );

    console.log(
      'DURATION_SECONDS:',
      existing.info.durationSeconds
    );

    console.log(
      'SHA256:',
      existing.manifest.sha256
    );

    console.log(
      'PUBLICATION_VIDEO_OK'
    );

    process.exit(0);
  }

  if (!fs.existsSync(gamePath)) {
    fail(
      `GAME_NOT_FOUND ${gamePath}`
    );
  }

  if (!fs.existsSync(scriptPath)) {
    fail(
      `SCRIPT_NOT_FOUND ${scriptPath}`
    );
  }

  const game =
    readJson(gamePath);

  const chess =
    new Chess();

  chess.loadPgn(
    game.pgn || ''
  );

  const plyCount =
    chess.history().length;

  if (!plyCount) {
    fail('PGN_HAS_NO_MOVES');
  }

  console.log(
    `PUBLICATION_VIDEO_RENDER ${gameId} plies=${plyCount}`
  );

  run(
    process.execPath,
    [
      path.join(
        ROOT,
        'build-move-segment-preview.js'
      ),
      gameId,
      String(plyCount)
    ]
  );

  const rendered =
    path.join(
      renderDir,
      `${gameId}-review-fast-preview.mp4`
    );

  if (!fs.existsSync(rendered)) {
    fail(
      `RENDER_OUTPUT_NOT_FOUND ${rendered}`
    );
  }

  const openingMaster =
    process.env.PINCHE_TULUM_OPENING_MASTER ||
    path.join(
      PROJECT,
      '..',
      'pinche-tulum',
      'storage',
      'render',
      'golden-master',
      'pinchetulum-master-opening.mp4'
    );

  const outroMaster =
    process.env.PINCHE_TULUM_OUTRO_MASTER ||
    path.join(
      PROJECT,
      '..',
      'pinche-tulum',
      'storage',
      'render',
      'golden-master',
      'pinchetulum-master-outro.mp4'
    );

  if (!fs.existsSync(openingMaster)) {
    fail(`OPENING_MASTER_NOT_FOUND ${openingMaster}`);
  }

  if (!fs.existsSync(outroMaster)) {
    fail(`OUTRO_MASTER_NOT_FOUND ${outroMaster}`);
  }

  const assembled =
    path.join(
      renderDir,
      `${gameId}-publication-with-masters.mp4`
    );

  run('ffmpeg', [
    '-y',
    '-i', openingMaster,
    '-i', rendered,
    '-i', outroMaster,
    '-filter_complex',
    '[0:v]scale=720:1280,fps=30,setsar=1,setpts=PTS-STARTPTS[v0];' +
    '[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0];' +
    '[1:v]scale=720:1280,fps=30,setsar=1,setpts=PTS-STARTPTS[v1];' +
    '[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1];' +
    '[2:v]scale=720:1280,fps=30,setsar=1,setpts=PTS-STARTPTS[v2];' +
    '[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a2];' +
    '[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]',
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    assembled
  ]);

  if (!fs.existsSync(assembled)) {
    fail(`ASSEMBLED_VIDEO_NOT_FOUND ${assembled}`);
  }

  const info =
    probe(assembled);

  const hash =
    sha256(assembled);

  const safeGameId =
    gameId.replace(
      /[^A-Za-z0-9_-]/g,
      '-'
    );

  const filename =
    `AGROCHESS-${safeGameId}.mp4`;

  const destination =
    path.join(
      downloadsDir,
      filename
    );

  atomicCopy(
    assembled,
    destination
  );

  const publishedHash =
    sha256(destination);

  if (publishedHash !== hash) {
    fail('PUBLIC_VIDEO_HASH_MISMATCH');
  }

  const videoUrl =
    `${publicBase}/${filename}`;

  const manifest = {
    gameId,
    status: 'rendered',
    format: 'vertical-9x16',
    width: info.width,
    height: info.height,
    durationSeconds:
      info.durationSeconds,
    videoUrl,
    sha256: hash,
    surfaces: [
      'article',
      'videos'
    ],
    videoEmbeddedInArticle: true
  };

  atomicWrite(
    manifestPath,
    JSON.stringify(
      manifest,
      null,
      2
    ) + '\n'
  );

  console.log(
    `PUBLICATION_VIDEO_CREATED ${gameId}`
  );

  console.log(
    'PLIES:',
    plyCount
  );

  console.log(
    'VIDEO_FILE:',
    destination
  );

  console.log(
    'VIDEO_URL:',
    videoUrl
  );

  console.log(
    'DURATION_SECONDS:',
    info.durationSeconds
  );

  console.log(
    'SHA256:',
    hash
  );

  console.log(
    'MANIFEST:',
    manifestPath
  );

  console.log(
    'PUBLICATION_VIDEO_OK'
  );

} catch (err) {
  console.error(
    `PUBLICATION_VIDEO_ERROR ${gameId}: ${err.message}`
  );

  process.exit(1);
}
