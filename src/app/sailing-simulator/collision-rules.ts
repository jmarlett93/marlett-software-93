import { RaceCourse } from './course';
import {
  MELGES_HULL_LENGTH_PX,
  Point,
  circleHitsPolygon,
  hullWorldPolygon,
  polygonAabb,
  polygonsOverlap,
} from './hull-geometry';
import { shortestHeadingDelta } from './polars/melges-24-polar';
import { beginFoulPenalty } from './foul-penalty';
import { RaceBoat } from './race-fleet';

export type TrafficHint = {
  avoidHeadingBiasDeg: number;
  ruleLabel: string | null;
  giveWayTo: string[];
};

export type TrafficReport = Map<string, TrafficHint>;

const WARNING_RANGE_PX = MELGES_HULL_LENGTH_PX * 3;
const IMMINENT_RANGE_PX = MELGES_HULL_LENGTH_PX * 1.15;
const AVOID_BIAS_DEG = 34;
const LAST_RESORT_BIAS_DEG = 48;

const headingVector = (headingDegrees: number): Point => {
  const radians = (headingDegrees * Math.PI) / 180;
  return {
    x: Math.sin(radians),
    y: -Math.cos(radians),
  };
};

const bearingDegreesTo = (from: Point, to: Point): number => {
  const dx = to.x - from.x;
  const dy = from.y - to.y;
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
};

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const tackFor = (boat: RaceBoat): 'port' | 'starboard' => {
  if (boat.memory.currentTack) {
    return boat.memory.currentTack;
  }

  return shortestHeadingDelta(boat.state.windFromDegrees, boat.state.headingDegrees) >= 0
    ? 'starboard'
    : 'port';
};

const isClearAsternOf = (astern: RaceBoat, ahead: RaceBoat): boolean => {
  const aheadForward = headingVector(ahead.state.headingDegrees);
  const relative = {
    x: astern.state.x - ahead.state.x,
    y: astern.state.y - ahead.state.y,
  };
  const projection = relative.x * aheadForward.x + relative.y * aheadForward.y;
  return projection < -MELGES_HULL_LENGTH_PX * 0.4;
};

const isClosingFromAstern = (astern: RaceBoat, ahead: RaceBoat): boolean =>
  isClearAsternOf(astern, ahead) &&
  astern.state.speedKnots >= ahead.state.speedKnots * 0.9;

const leewardBoat = (a: RaceBoat, b: RaceBoat): RaceBoat => {
  const downwind = headingVector(a.state.windFromDegrees + 180);
  const aScore = a.state.x * downwind.x + a.state.y * downwind.y;
  const bScore = b.state.x * downwind.x + b.state.y * downwind.y;
  return aScore >= bScore ? a : b;
};

const resolveGiveWay = (
  a: RaceBoat,
  b: RaceBoat,
): { giveWay: RaceBoat[]; standOn: RaceBoat[]; label: string } => {
  const aTack = tackFor(a);
  const bTack = tackFor(b);

  if (aTack !== bTack) {
    return aTack === 'starboard'
      ? { giveWay: [b], standOn: [a], label: 'Port keeps clear of starboard' }
      : { giveWay: [a], standOn: [b], label: 'Port keeps clear of starboard' };
  }

  const aOvertaking = isClosingFromAstern(a, b);
  const bOvertaking = isClosingFromAstern(b, a);
  if (aOvertaking !== bOvertaking) {
    return aOvertaking
      ? { giveWay: [a], standOn: [b], label: 'Overtaking boat keeps clear' }
      : { giveWay: [b], standOn: [a], label: 'Overtaking boat keeps clear' };
  }

  const leeward = leewardBoat(a, b);
  const windward = leeward === a ? b : a;
  return {
    giveWay: [windward],
    standOn: [leeward],
    label: 'Windward keeps clear of leeward',
  };
};

const addBias = (
  hint: TrafficHint,
  boat: RaceBoat,
  threat: Point,
  amount: number,
  label: string,
  giveWayTo?: string,
): void => {
  const bearing = bearingDegreesTo(boat.state, threat);
  const side = shortestHeadingDelta(boat.state.headingDegrees, bearing);
  hint.avoidHeadingBiasDeg += side >= 0 ? -amount : amount;
  hint.ruleLabel = label;
  if (giveWayTo) {
    hint.giveWayTo.push(giveWayTo);
  }
};

const emptyTrafficReport = (fleet: readonly RaceBoat[]): TrafficReport =>
  new Map(
    fleet.map((boat) => [
      boat.spec.id,
      {
        avoidHeadingBiasDeg: 0,
        ruleLabel: null,
        giveWayTo: [],
      },
    ]),
  );

export const evaluateTraffic = (
  fleet: readonly RaceBoat[],
  course: RaceCourse,
): TrafficReport => {
  const report = emptyTrafficReport(fleet);
  const polygons = new Map(fleet.map((boat) => [boat.spec.id, hullWorldPolygon(boat.state)]));
  const aabbs = new Map(
    [...polygons.entries()].map(([id, polygon]) => [id, polygonAabb(polygon)]),
  );

  for (let i = 0; i < fleet.length; i += 1) {
    for (let j = i + 1; j < fleet.length; j += 1) {
      const a = fleet[i];
      const b = fleet[j];
      const range = distance(a.state, b.state);
      if (range > WARNING_RANGE_PX) {
        continue;
      }

      const rule = resolveGiveWay(a, b);
      for (const giveWay of rule.giveWay) {
        const standOn = rule.standOn[0] ?? (giveWay === a ? b : a);
        const hint = report.get(giveWay.spec.id);
        if (!hint) {
          continue;
        }
        const urgent = range < IMMINENT_RANGE_PX;
        addBias(
          hint,
          giveWay,
          standOn.state,
          urgent ? LAST_RESORT_BIAS_DEG : AVOID_BIAS_DEG,
          rule.label,
          standOn.spec.shortName,
        );
      }

      // Stand-on boats hold course unless hull boxes are already close enough to be dangerous.
      const aabbA = aabbs.get(a.spec.id);
      const aabbB = aabbs.get(b.spec.id);
      if (range < IMMINENT_RANGE_PX * 0.7 && aabbA && aabbB) {
        for (const standOn of rule.standOn) {
          const other = standOn === a ? b : a;
          const hint = report.get(standOn.spec.id);
          if (hint) {
            addBias(hint, standOn, other.state, AVOID_BIAS_DEG * 0.5, 'Avoid contact');
          }
        }
      }
    }
  }

  for (const boat of fleet) {
    const hint = report.get(boat.spec.id);
    if (!hint) {
      continue;
    }

    for (const buoy of course.buoys) {
      const mark = { x: buoy.x, y: buoy.y };
      const range = distance(boat.state, mark);
      const hitRadius = course.markRadiusPx * 0.55;
      if (range < hitRadius + MELGES_HULL_LENGTH_PX * 0.85) {
        addBias(
          hint,
          boat,
          mark,
          AVOID_BIAS_DEG * 0.55,
          `Keep clear of buoy ${buoy.index}`,
        );
      }
    }
  }

  for (const boat of fleet) {
    boat.trafficRule = report.get(boat.spec.id)?.ruleLabel ?? null;
  }

  return report;
};

const separate = (a: RaceBoat, b: RaceBoat): void => {
  const dx = b.state.x - a.state.x;
  const dy = b.state.y - a.state.y;
  const length = Math.hypot(dx, dy) || 1;
  const push = 2.2;
  a.state = {
    ...a.state,
    x: a.state.x - (dx / length) * push,
    y: a.state.y - (dy / length) * push,
  };
  b.state = {
    ...b.state,
    x: b.state.x + (dx / length) * push,
    y: b.state.y + (dy / length) * push,
  };
};

export const resolveFleetContacts = (
  fleet: RaceBoat[],
  course: RaceCourse,
  nowMs: number,
): void => {
  const polygons = new Map(fleet.map((boat) => [boat.spec.id, hullWorldPolygon(boat.state)]));

  for (let i = 0; i < fleet.length; i += 1) {
    for (let j = i + 1; j < fleet.length; j += 1) {
      const a = fleet[i];
      const b = fleet[j];
      const polyA = polygons.get(a.spec.id);
      const polyB = polygons.get(b.spec.id);
      if (!polyA || !polyB || !polygonsOverlap(polyA, polyB)) {
        continue;
      }

      const rule = resolveGiveWay(a, b);
      for (const giveWay of rule.giveWay) {
        const standOn = rule.standOn[0] ?? (giveWay === a ? b : a);
        beginFoulPenalty(giveWay, `Foul: ${rule.label} (${standOn.spec.shortName})`, nowMs);
      }
      separate(a, b);
    }
  }

  for (const boat of fleet) {
    const polygon = hullWorldPolygon(boat.state);
    for (const buoy of course.buoys) {
      const hitRadius = course.markRadiusPx * 0.55;
      if (circleHitsPolygon({ x: buoy.x, y: buoy.y }, hitRadius, polygon)) {
        beginFoulPenalty(boat, `Foul: hit buoy ${buoy.index}`, nowMs);
      }
    }
  }
};
