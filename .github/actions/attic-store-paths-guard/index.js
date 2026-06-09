const fs = require('node:fs');
const { execSync } = require('node:child_process');
const core = require('@actions/core');

function storePathsFile() {
  return `${process.env.RUNNER_TEMP || '/tmp'}/attic-action-store-paths`;
}

function ensureStorePaths() {
  const file = storePathsFile();
  if (fs.existsSync(file)) {
    core.info(`Attic store-paths snapshot present: ${file}`);
    return;
  }

  core.warning(`Missing ${file}; recreating before Attic push`);
  try {
    const out = execSync('nix path-info --all --json --json-format 2', {
      encoding: 'utf8',
    });
    fs.writeFileSync(file, out);
  } catch (err) {
    core.warning(
      `nix path-info failed (${err.message}); writing empty snapshot`,
    );
    fs.writeFileSync(
      file,
      JSON.stringify({ storeDir: '/nix/store', info: {} }),
    );
  }
}

const isPost = core.getState('storePathsGuard') === 'post';
if (!isPost) {
  ensureStorePaths();
  core.saveState('storePathsGuard', 'post');
} else {
  ensureStorePaths();
}
