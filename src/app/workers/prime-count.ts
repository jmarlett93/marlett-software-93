/** Intentionally heavy prime check so the main-thread demo can freeze the UI. */
export const PRIME_RANGE = 500_000;

export const countPrimesInRange = (limit: number): number => {
  let count = 0;
  for (let n = 0; n < limit; n += 1) {
    if (isPrime(n)) {
      count += 1;
    }
  }
  return count;
};

export const isPrime = (num: number): boolean => {
  if (num < 2) {
    return false;
  }
  for (let i = 2; i < num / 2; i += 1) {
    if (num % i === 0) {
      return false;
    }
  }
  return true;
};
