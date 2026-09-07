const { spawnSync } = require('child_process');
const path = require('path');

const gameId = process.argv[2];

if (!gameId) {
  console.error(
    'Usage: node backend/post-game-pipeline.js <gameId>'
  );
  process.exit(1);
}

function run(script) {
  console.log('');
  console.log(`===== ${script} =====`);

  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, script),
      gameId
    ],
    {
      stdio: 'inherit'
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${script} failed with exit code ${result.status}`
    );
  }
}

try {
  console.log(`POST_GAME_PIPELINE_START ${gameId}`);

  run('analyze-game.js');
  run('classify-analysis.js');
  run('build-game-summary.js');
  run('build-health-timeline.js');
    run('build-editorial-script.js');
  run('build-publication-video.js');
  run('build-pinchetulum-publication.js');
  run('publish-pinchetulum.js');

  console.log('');
  console.log(`POST_GAME_PIPELINE_OK ${gameId}`);
} catch (err) {
  console.error('');
  console.error(
    `POST_GAME_PIPELINE_ERROR ${gameId}: ${err.message}`
  );
  process.exit(1);
}
