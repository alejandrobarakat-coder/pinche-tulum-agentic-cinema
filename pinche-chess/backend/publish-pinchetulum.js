const fs = require('fs');
const path = require('path');

const gameId = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!gameId) {
  console.error(
    'Usage: node backend/publish-pinchetulum.js <gameId> [--dry-run]'
  );
  process.exit(1);
}

const ROOT = __dirname;
const renderRoot = path.join(ROOT, 'data', 'render-test');

const packageDir = path.join(
  renderRoot,
  'pinchetulum-publication-test'
);

const packagePath = path.join(
  packageDir,
  `agrochess-${gameId.toLowerCase()}.json`
);

const pincheTulumRoot =
  process.env.PINCHE_TULUM_ROOT ||
  path.join(__dirname, '..', '..', 'pinche-tulum', 'public');

const articlesPath =
  process.env.PINCHE_TULUM_ARTICLES ||
  path.join(pincheTulumRoot, 'data', 'articles.json');

const chessVideosPath =
  process.env.PINCHE_TULUM_CHESS_FEED ||
  path.join(pincheTulumRoot, 'videos', 'chess.json');

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validate(article) {
  if (!article || typeof article !== 'object') {
    fail('INVALID_PUBLICATION_OBJECT');
  }

  if (!article.id || !article.publicationId) {
    fail('MISSING_PUBLICATION_ID');
  }

  if (article.id !== article.publicationId) {
    fail('PUBLICATION_ID_MISMATCH');
  }

  if (article.gameId !== gameId) {
    fail('GAME_ID_MISMATCH');
  }

  if (article.category !== 'Chess') {
    fail('INVALID_CATEGORY');
  }

  if (
    !Array.isArray(article.surfaces) ||
    !article.surfaces.includes('article') ||
    !article.surfaces.includes('videos')
  ) {
    fail('INVALID_SURFACES');
  }

  if (article.videoEmbeddedInArticle !== true) {
    fail('VIDEO_NOT_EMBEDDED');
  }

  const media = article.media || {};

  if (
    media.type !== 'video' ||
    typeof media.url !== 'string' ||
    !media.url.startsWith('https://')
  ) {
    fail('INVALID_VIDEO_URL');
  }

  if (media.format !== 'vertical-9x16') {
    fail('INVALID_VIDEO_FORMAT');
  }

  if (media.width !== 720 || media.height !== 1280) {
    fail('INVALID_VIDEO_SIZE');
  }

  if (!/^[a-f0-9]{64}$/i.test(media.sha256 || '')) {
    fail('INVALID_VIDEO_SHA256');
  }

  const content =
    String(article.content?.es || '') +
    String(article.content?.en || '');

  if (!content.toLowerCase().includes('<video')) {
    fail('VIDEO_TAG_MISSING');
  }

  if (/stockfish/i.test(content)) {
    fail('PUBLIC_STOCKFISH_REFERENCE');
  }

  if (
    article.analysis?.authority !== 'Alejandro Barakat'
  ) {
    fail('INVALID_ANALYSIS_AUTHORITY');
  }

  if (
    article.provenance?.gameId !== gameId ||
    article.provenance?.publicationId !==
      article.publicationId
  ) {
    fail('INVALID_PROVENANCE');
  }
}

function atomicWriteJson(file, object, originalStat) {
  const dir = path.dirname(file);

  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );

  const fd = fs.openSync(
    tmp,
    'wx',
    originalStat.mode & 0o777
  );

  try {
    fs.writeFileSync(
      fd,
      JSON.stringify(object, null, 2) + '\n',
      'utf8'
    );

    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.chownSync(
      tmp,
      process.getuid(),
      originalStat.gid
    );
  } catch (err) {
    console.warn(
      `PINCHETULUM_CHOWN_WARNING ${err.message}`
    );
  }

  fs.chmodSync(tmp, originalStat.mode & 0o777);
  fs.renameSync(tmp, file);
}

function atomicCopy(source, destination) {
  const dir = path.dirname(destination);

  const tmp = path.join(
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

try {
  if (!fs.existsSync(packagePath)) {
    fail(`PACKAGE_NOT_FOUND ${packagePath}`);
  }

  const article = readJson(packagePath);
  validate(article);

  const htmlPath = path.join(
    packageDir,
    'articles',
    `${article.slug}.html`
  );

  if (!fs.existsSync(htmlPath)) {
    fail(`ARTICLE_HTML_NOT_FOUND ${htmlPath}`);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');

  if (!html.toLowerCase().includes('<video')) {
    fail('HTML_VIDEO_TAG_MISSING');
  }

  if (/stockfish/i.test(html)) {
    fail('HTML_PUBLIC_STOCKFISH_REFERENCE');
  }

  const database = readJson(articlesPath);

  if (
    !database ||
    !Array.isArray(database.articles)
  ) {
    fail('INVALID_ARTICLES_DATABASE');
  }

  const matches = [];

  database.articles.forEach((item, index) => {
    if (item?.id === article.id) {
      matches.push(index);
    }
  });

  if (matches.length > 1) {
    fail(
      `DUPLICATE_PUBLICATION_ID count=${matches.length}`
    );
  }

  const action =
    matches.length === 1 ? 'UPDATE' : 'INSERT';

  const before = database.articles.length;

  if (matches.length === 1) {
    database.articles[matches[0]] = article;
  } else {
    database.articles.push(article);
  }

  const after = database.articles.length;

  console.log('PINCHETULUM_PUBLICATION_VALID');
  console.log('MODE:', dryRun ? 'DRY_RUN' : 'WRITE');
  console.log('ACTION:', action);
  console.log('GAME_ID:', gameId);
  console.log('PUBLICATION_ID:', article.publicationId);
  console.log('COUNT_BEFORE:', before);
  console.log('COUNT_AFTER:', after);
  console.log('PUBLICATION_URL:', article.url);
  console.log('VIDEO_URL:', article.media.url);

  if (dryRun) {
    console.log('PINCHETULUM_DRY_RUN_OK');
    process.exit(0);
  }

  database.generated_at =
    new Date().toISOString();

  const stat = fs.statSync(articlesPath);

  atomicWriteJson(
    articlesPath,
    database,
    stat
  );

  const chessVideos = {
    articles: database.articles.filter(item =>
      item?.category === 'Chess' &&
      Array.isArray(item?.surfaces) &&
      item.surfaces.includes('videos') &&
      item?.videoEmbeddedInArticle === true
    )
  };

  const chessVideosStat = fs.statSync(chessVideosPath);

  atomicWriteJson(
    chessVideosPath,
    chessVideos,
    chessVideosStat
  );

  console.log(
    `PINCHETULUM_CHESS_VIDEOS_SYNC count=${chessVideos.articles.length}`
  );

  const destinationHtml = path.join(
    process.env.PINCHE_TULUM_ARTICLES_DIR ||
      path.join(pincheTulumRoot, 'articles'),
    `${article.slug}.html`
  );

  atomicCopy(htmlPath, destinationHtml);

  console.log(
    `PINCHETULUM_PUBLICATION_OK ${article.publicationId}`
  );
} catch (err) {
  console.error(
    `PINCHETULUM_PUBLICATION_ERROR ${gameId}: ${err.message}`
  );
  process.exit(1);
}
