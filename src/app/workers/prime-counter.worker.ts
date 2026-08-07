/// <reference lib="webworker" />

import { countPrimesInRange } from './prime-count';

addEventListener('message', ({ data }: MessageEvent<number>) => {
  const count = countPrimesInRange(data);
  postMessage(count);
});
