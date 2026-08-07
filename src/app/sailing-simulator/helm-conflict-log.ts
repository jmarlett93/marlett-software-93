import { debugLog, isLocalDevHost } from '../debug-log';
import { segmentClearanceToPoint } from './mark-rounding-geometry';
import { FoulPhase, RaceBoat } from './race-fleet';

/** Who owns the helm this tick — filter DevTools by `[helm-conflict]`. */
export type HelmOwner =
  | 'spin360'
  | 'steerClear'
  | 'recovery'
  | 'driver'
  | 'manual';

export type HelmConflictNote = {
  id: string;
  helm: HelmOwner;
  foul: FoulPhase;
  /** bearOffThenTack | tackThenBearOff while spinning. */
  clearPlan: string | null;
  round: string;
  wp: number;
  goal: number;
  reason: string | null;
  pos: readonly [number, number];
  /** Active aim (rounding vertex / Dest) when known. */
  active: readonly [number, number] | null;
  /**
   * Closest distance from mark center to boat→active chord (px).
   * Null when not rounding / no active. Compare to clearancePx.
   */
  chordClr: number | null;
  /** Set on contact / foul begin. */
  event?: 'contact' | 'change';
  why?: string | null;
};

const HELM_CONFLICT_MAX = 80;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const xy = (x: number, y: number): [number, number] => [r1(x), r1(y)];

let logCount = 0;
const lastKeyById = new Map<string, string>();

export const resetHelmConflictLog = (): void => {
  logCount = 0;
  lastKeyById.clear();
};

const changeKey = (note: HelmConflictNote): string =>
  [
    note.helm,
    note.foul,
    note.clearPlan ?? '',
    note.round,
    note.wp,
    note.goal,
    note.event ?? '',
    note.why ?? '',
  ].join('|');

/**
 * Emit only on contact or when helm owner / foul / round / waypoint changes.
 * Useful fields only — filter DevTools by `[helm-conflict]`.
 */
export const noteHelmConflict = (note: HelmConflictNote): void => {
  if (!isLocalDevHost()) {
    return;
  }
  if (logCount >= HELM_CONFLICT_MAX && note.event !== 'contact') {
    return;
  }
  const key = changeKey(note);
  const prev = lastKeyById.get(note.id);
  if (note.event !== 'contact' && key === prev) {
    return;
  }
  lastKeyById.set(note.id, key);
  if (logCount < HELM_CONFLICT_MAX) {
    logCount += 1;
  }
  debugLog(
    `[helm-conflict ${logCount}/${HELM_CONFLICT_MAX}]`,
    JSON.stringify({
      id: note.id,
      ev: note.event ?? 'change',
      helm: note.helm,
      foul: note.foul,
      plan: note.clearPlan,
      round: note.round,
      wp: note.wp,
      goal: note.goal,
      why: note.why ?? note.reason,
      pos: note.pos,
      active: note.active,
      chordClr: note.chordClr == null ? null : r1(note.chordClr),
    }),
  );
};

/** Chord clearance from boat to active aim vs mark center (rounding debug). */
export const roundingChordClearancePx = (
  boat: Pick<RaceBoat['state'], 'x' | 'y'>,
  active: { x: number; y: number } | null,
  mark: { x: number; y: number } | null,
): number | null => {
  if (!active || !mark) {
    return null;
  }
  return segmentClearanceToPoint(mark, boat, active);
};

export const helmConflictPos = (
  boat: Pick<RaceBoat['state'], 'x' | 'y'>,
): [number, number] => xy(boat.x, boat.y);
