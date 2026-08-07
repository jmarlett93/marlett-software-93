import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const docsDir = 'docs';
const browserDir = join(docsDir, 'browser');

const ensureDir = (dir) => {
  mkdirSync(dir, { recursive: true });
};

const moveContents = (fromDir, toDir) => {
  ensureDir(toDir);
  for (const name of readdirSync(fromDir)) {
    const from = join(fromDir, name);
    const to = join(toDir, name);
    if (statSync(from).isDirectory()) {
      moveContents(from, to);
      rmSync(from, { recursive: true, force: true });
      continue;
    }
    renameSync(from, to);
  }
};

copyFileSync(join(browserDir, 'index.html'), join(browserDir, '404.html'));

for (const name of readdirSync(docsDir)) {
  if (name === 'browser') {
    continue;
  }
  rmSync(join(docsDir, name), { recursive: true, force: true });
}

moveContents(browserDir, docsDir);
rmSync(browserDir, { recursive: true, force: true });

console.log('Flattened docs/browser → docs/ (with 404.html)');
