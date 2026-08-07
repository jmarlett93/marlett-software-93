/** Dev-only console logging — off everywhere except the local Angular serve host. */
export const isLocalDevHost = (): boolean =>
  typeof location !== 'undefined' && location.host === 'localhost:4200';

export const debugLog = (...args: unknown[]): void => {
  if (!isLocalDevHost()) {
    return;
  }
  console.log(...args);
};
