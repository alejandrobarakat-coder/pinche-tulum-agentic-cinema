const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function findFile(root, gameId, suffix) {
  const candidates = [];

  function walk(dir, depth = 0) {
    if (depth > 4 || !fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (
        entry.name.includes(gameId) &&
        entry.name.endsWith(suffix)
      ) {
        candidates.push(full);
      }
    }
  }

  walk(root);
  return candidates[0] || null;
}

const gameId = process.argv[2];

if (!gameId) {
  console.error("Usage: node backend/build-pinchetulum-publication.js GAME_ID");
  process.exit(1);
}

const dataRoot = path.join(__dirname, "data");
const renderRoot = path.join(dataRoot, "render-test");

const manifestPath = path.join(
  renderRoot,
  `${gameId}-publication-manifest.json`
);

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Manifest not found: ${manifestPath}`);
}

const manifest = readJson(manifestPath);

const gamePath = path.join(
  dataRoot,
  "games",
  `${gameId}.json`
);

const scriptPath = path.join(
  dataRoot,
  "analysis",
  `${gameId}.script.json`
);

if (!fs.existsSync(gamePath)) {
  throw new Error(`Canonical game not found: ${gamePath}`);
}

if (!fs.existsSync(scriptPath)) {
  throw new Error(`Editorial script not found: ${scriptPath}`);
}

const game = readJson(gamePath);
const script = readJson(scriptPath);

const playerA =
  game.playerA?.name ||
  game.white?.name ||
  game.players?.white?.name ||
  "White";

const playerB =
  game.playerB?.name ||
  game.black?.name ||
  game.players?.black?.name ||
  "Player B";

const playerAColor = String(game.playerAColor || "").toLowerCase();

let whitePlayer = null;
let blackPlayer = null;

if (playerAColor === "white") {
  whitePlayer = playerA;
  blackPlayer = playerB;
} else if (playerAColor === "black") {
  whitePlayer = playerB;
  blackPlayer = playerA;
} else {
  // Current server format: playerA = white, playerB = black.
  // Historical games with explicit color fields are handled above.
  whitePlayer =
    game.white?.name ||
    game.players?.white?.name ||
    playerA;

  blackPlayer =
    game.black?.name ||
    game.players?.black?.name ||
    playerB;
}

const pgn =
  game.pgn ||
  script.pgn ||
  "";

const result =
  game.result ||
  script.result ||
  "unknown";

const publicationId = `agrochess-${gameId.toLowerCase()}`;
const slug = publicationId;

const publicationUrl =
  `https://pinchetulum.com/articles/${slug}.html`;

const publicResult =
  result === "A"
    ? `${playerA} ganó${game.termination === "checkmate" ? " por jaque mate" : ""}`
    : result === "B"
      ? `${playerB} ganó${game.termination === "checkmate" ? " por jaque mate" : ""}`
      : result === "DRAW"
        ? "Tablas"
        : result;

const title =
  `Pinche Chess: ${playerA} vs ${playerB}`;

const finalVerdict =
  (script.sections || []).find(
    s => String(s.type || "").toUpperCase() === "FINAL_VERDICT"
  )?.text || "";

const agrobotVerdict =
  (script.sections || []).find(
    s => String(s.type || "").toUpperCase() === "AGROBOT_VERDICT"
  )?.text || "";

const article = {
  id: publicationId,
  publicationId,
  gameId,
  slug,
  url: publicationUrl,

  category: "Chess",

  tags: [
    "Pinche Chess",
    "Alejandro Barakat",
    "PincheTulum"
  ],

  source: gameId,

  title: {
    es: title,
    en: title
  },

  excerpt: {
    es: `Partida ${playerA} vs ${playerB}, analizada por Alejandro Barakat.`,
    en: `${playerA} vs ${playerB}, analyzed by Alejandro Barakat.`
  },

  media: {
    type: "video",
    url: manifest.videoUrl,
    format: manifest.format,
    width: manifest.width,
    height: manifest.height,
    durationSeconds: manifest.durationSeconds,
    sha256: manifest.sha256
  },

  surfaces: ["article", "videos"],
  videoEmbeddedInArticle: true,

  chess: {
    players: {
      playerA,
      playerB,
      playerAColor: playerAColor || null,
      white: whitePlayer,
      black: blackPlayer
    },
    result,
    winner:
      result === "A"
        ? playerA
        : result === "B"
          ? playerB
          : null,
    termination: game.termination || null,
    pgn
  },

  analysis: {
    authority: "Alejandro Barakat",
    verdict: agrobotVerdict,
    finalVerdict
  },

  provenance: {
    gameId,
    publicationId,
    sha256: manifest.sha256
  }
};

article.content = {
  es: `
<div class="agrochess-publication">

<video
  controls
  playsinline
  preload="metadata"
  style="width:100%;max-width:540px;height:auto;"
  src="${escapeHtml(manifest.videoUrl)}">
</video>

<h2>${escapeHtml(playerA)} vs ${escapeHtml(playerB)}</h2>

<p><strong>Resultado:</strong> ${escapeHtml(publicResult)}</p>

${agrobotVerdict
  ? `<h3>Barakat Coaching</h3><p>${escapeHtml(agrobotVerdict)}</p>`
  : ""}

${finalVerdict
  ? `<h3>Final Verdict</h3><p>${escapeHtml(finalVerdict)}</p>`
  : ""}

<h3>PGN</h3>
<pre>${escapeHtml(pgn)}</pre>

<p><strong>Game ID:</strong> ${escapeHtml(gameId)}</p>
<p><strong>Publication ID:</strong> ${escapeHtml(publicationId)}</p>
<p><strong>SHA256:</strong> ${escapeHtml(manifest.sha256)}</p>

</div>
`.trim()
};

article.content.en = article.content.es;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${article.content.es}
</body>
</html>
`;

const sandbox = path.join(
  renderRoot,
  "pinchetulum-publication-test"
);

const articleFile = path.join(
  sandbox,
  "articles",
  `${slug}.html`
);

const jsonFile = path.join(
  sandbox,
  `${publicationId}.json`
);

atomicWrite(
  jsonFile,
  JSON.stringify(article, null, 2) + "\n"
);

atomicWrite(articleFile, html);

const packageHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(article))
  .digest("hex");

console.log("PINCHETULUM_PACKAGE_OK");
console.log("GAME_ID:", gameId);
console.log("PUBLICATION_ID:", publicationId);
console.log("PUBLICATION_URL:", publicationUrl);
console.log("VIDEO_URL:", manifest.videoUrl);
console.log("VIDEO_SHA256:", manifest.sha256);
console.log("PACKAGE_SHA256:", packageHash);
console.log("SURFACES:", article.surfaces.join(","));
console.log("JSON:", jsonFile);
console.log("HTML:", articleFile);
