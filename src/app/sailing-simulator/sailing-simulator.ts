import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { Subscription } from 'rxjs';
import {
  TACK_STRATEGY_OPTIONS,
  TackStrategyId,
  advanceBoatPosition,
  advanceGoalIfClearReached,
  buildRaceStrategy,
  buildRoundGeoSnapshot,
  closeHauledHeadings,
  decideDriverHeading,
  distancePx,
  markClearanceRadiusPx,
  resetTackPlanLog,
  resolveDriverPlan,
  roundingSenseForGoal,
  roundingSideForGoal,
} from './boat-driver';
import {
  buildMarkRoundingSpec,
  buildRoundingPolygon,
} from './mark-rounding-geometry';
import { evaluateTraffic, resolveFleetContacts } from './collision-rules';
import { RaceCourse, buoyByIndex, setupCourse } from './course';
import {
  FOUL_BROADCAST_TINT,
  updateFoulPenalty,
} from './foul-penalty';
import { drawMelgesHull } from './hull-geometry';
import { updateHelmRecovery } from './helm-recovery';
import {
  FALLBACK_WIND_FROM_DEGREES,
  MontereyWindService,
  WindPuff,
} from './monterey-wind.service';
import {
  normalizeHeadingDegrees,
  shortestHeadingDelta,
} from './polars/melges-24-polar';
import {
  RaceBoat,
  RaceStanding,
  computeRaceStandings,
  createRaceFleet,
} from './race-fleet';
import {
  SailboatState,
  WindInfluence,
  applyWindToSailboat,
  resolveDrivingWind,
  rotateSailboat,
} from './sailboat-state';
import { STEER_CLEAR_SIGNAL_MS, decideSteerClear } from './steer-clear';
import { debugLog, isLocalDevHost } from '../debug-log';
import {
  HelmOwner,
  helmConflictPos,
  noteHelmConflict,
  resetHelmConflictLog,
  roundingChordClearancePx,
} from './helm-conflict-log';

type HelmMode = 'auto' | 'manual';
type FleetMode = 'solo' | 'fleet';

const round1 = (n: number): number => Math.round(n * 10) / 10;

type ActivePuff = WindInfluence & {
  root: Container;
  drift: number;
  life: number;
};

type BoatView = {
  root: Container;
  hull: Graphics;
  label: Text;
  /** Blue stern blink while steer-clear skill is working. */
  clearBlink: Graphics;
};

const MANUAL_TURN_RATE_DEG_PER_SEC = 140;
const AUTO_TURN_RATE_DEG_PER_SEC = 110;
const FOUL_SPIN_TURN_RATE_DEG_PER_SEC = 95;
const HUD_UPDATE_MS = 100;
/** Player rounding geometry debug — filter DevTools by `[round-poly]`. */
const ROUND_POLY_BOAT_ID = 'player-gold';
const ROUND_POLY_INTERVAL_MS = 500;
const ROUND_POLY_MAX = 80;

const WIND_ARROW_CALM = 0x7f8b95;
const WIND_ARROW_TEAL = 0x7ee0d4;
const WIND_ARROW_DARK_BLUE = 0x1a3f8a;

const lerpChannel = (a: number, b: number, t: number): number =>
  Math.round(a + (b - a) * t);

/** Calm gray → teal ≤15 kn → darker blue as wind builds past 15. */
const windArrowColor = (knots: number): number => {
  if (knots <= 0.5) {
    return WIND_ARROW_CALM;
  }
  if (knots <= 15) {
    return WIND_ARROW_TEAL;
  }
  const t = Math.min(1, (knots - 15) / 15);
  const from = WIND_ARROW_TEAL;
  const to = WIND_ARROW_DARK_BLUE;
  const r = lerpChannel((from >> 16) & 0xff, (to >> 16) & 0xff, t);
  const g = lerpChannel((from >> 8) & 0xff, (to >> 8) & 0xff, t);
  const b = lerpChannel(from & 0xff, to & 0xff, t);
  return (r << 16) | (g << 8) | b;
};

@Component({
  selector: 'app-sailing-simulator',
  imports: [MatIconModule, DecimalPipe],
  templateUrl: './sailing-simulator.html',
  styleUrl: './sailing-simulator.css',
  host: {
    '(document:keydown)': 'onKeyDown($event)',
    '(document:keyup)': 'onKeyUp($event)',
  },
})
export class SailingSimulator {
  private readonly destroyRef = inject(DestroyRef);
  private readonly wind = inject(MontereyWindService);
  private readonly stageHost = viewChild.required<ElementRef<HTMLDivElement>>('stage');

  readonly status = this.wind.status;
  readonly latestSample = this.wind.latestSample;
  readonly bufferSize = this.wind.bufferSize;
  readonly errorMessage = this.wind.errorMessage;
  readonly usingDirectionFallback = this.wind.usingDirectionFallback;
  readonly windStations = this.wind.stations;
  readonly selectedStationId = this.wind.selectedStationId;
  readonly pixiError = signal<string | null>(null);
  readonly lastPuff = signal<WindPuff | null>(null);
  readonly boat = signal<SailboatState | null>(null);
  readonly helmMode = signal<HelmMode>('auto');
  /** Fleet UI hidden for now — solo only. */
  readonly fleetMode = signal<FleetMode>('solo');
  readonly tackStrategyOptions = TACK_STRATEGY_OPTIONS;
  readonly tackStrategy = signal<TackStrategyId>(1);
  readonly strategyScore = signal<string>('—');
  readonly targetHeading = signal<number | null>(null);
  readonly driverReason = signal<string>('Starting course…');
  readonly trafficStatus = signal<string>('Clear');
  readonly goalBuoy = signal<1 | 2 | 3>(1);
  readonly laps = signal(0);
  readonly courseSide = signal<'left' | 'right' | null>(null);
  readonly standings = signal<RaceStanding[]>([]);

  private app: Application | null = null;
  private horizon: Graphics | null = null;
  private courseLayer: Container | null = null;
  private aimDebug: Graphics | null = null;
  private strategyLabelLayer: Container | null = null;
  private puffLayer: Container | null = null;
  private boatLayer: Container | null = null;
  private course: RaceCourse | null = null;
  private fleet: RaceBoat[] = [];
  private boatViews = new Map<string, BoatView>();
  private arrows: ActivePuff[] = [];
  private puffSub: Subscription | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private puffSeq = 0;
  private readonly keysDown = new Set<string>();
  private destroyed = false;
  private bootGeneration = 0;
  private hudElapsed = 0;
  /** True once the course has been oriented to a real NWS wind-from. */
  private courseAlignedToLiveWind = false;
  /** Re-orient on next live direction (boot, station change). */
  private pendingCourseWindAlign = true;
  private roundPolyCount = 0;
  private roundPolyLastAtMs = 0;
  private roundPolyLastKey = '';

  constructor() {
    afterNextRender(() => {
      void this.bootstrapPixi();
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.teardown();
    });
  }

  setHelmMode(mode: HelmMode): void {
    this.helmMode.set(mode);
    if (mode === 'auto') {
      this.keysDown.clear();
    }
  }

  /** Solo = player only (easier rounding QA); Fleet = player + NPC boats. */
  setFleetMode(mode: FleetMode): void {
    if (this.fleetMode() === mode) {
      return;
    }
    this.fleetMode.set(mode);
    this.layoutCourseAndFleet(true);
  }

  setWindStation(stationId: string): void {
    this.wind.setStation(stationId);
    // Drop stale board arrows from the previous station immediately.
    this.clearWindArrows();
    // New station → wait for its real direction, then rebuild the course.
    this.pendingCourseWindAlign = true;
    this.courseAlignedToLiveWind = false;
  }

  onWindStationChange(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (select?.value) {
      this.setWindStation(select.value);
    }
  }

  selectedWindStationLabel(): string {
    return this.wind.selectedStation().shortLabel;
  }

  /** Switch tack strategy for the player boat only; NPCs keep their own. */
  setTackStrategy(strategy: TackStrategyId): void {
    this.tackStrategy.set(strategy);
    const player = this.playerBoat();
    if (!player) {
      return;
    }
    player.memory = {
      ...player.memory,
      strategy,
      currentTack: null,
    };
    this.strategyScore.set('Clear · active');
  }

  onKeyDown(event: KeyboardEvent): void {
    if (this.helmMode() !== 'manual') {
      return;
    }
    const key = event.key.toLowerCase();
    if (key !== 'a' && key !== 'd') {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.keysDown.add(key);
  }

  onKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'd') {
      this.keysDown.delete(key);
    }
  }

  private playerBoat(): RaceBoat | null {
    return this.fleet.find((boat) => boat.spec.role === 'player') ?? null;
  }

  private async bootstrapPixi(): Promise<void> {
    const generation = ++this.bootGeneration;
    const hostEl = this.stageHost().nativeElement;

    this.teardownPixiOnly();
    hostEl.replaceChildren();
    this.pixiError.set(null);

    try {
      const rect = hostEl.getBoundingClientRect();
      const app = new Application();
      await app.init({
        width: Math.max(Math.floor(rect.width), 320),
        height: Math.max(Math.floor(rect.height), 240),
        background: '#0a2a38',
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      });

      if (this.destroyed || generation !== this.bootGeneration) {
        app.destroy(true, { children: true });
        return;
      }

      hostEl.appendChild(app.canvas);
      this.app = app;

      this.horizon = new Graphics();
      this.courseLayer = new Container();
      this.puffLayer = new Container();
      this.boatLayer = new Container();
      app.stage.addChild(this.horizon, this.courseLayer, this.puffLayer, this.boatLayer);

      this.paintHorizon();
      this.layoutCourseAndFleet();

      app.ticker.add((ticker) => this.tick(ticker.deltaMS));

      this.puffSub?.unsubscribe();
      this.puffSub = this.wind.watchPuffs().subscribe((puff) => {
        this.lastPuff.set(puff);
        this.syncArrowWindSpeeds(puff.knots);
        this.spawnArrow(puff);
        this.maybeRealignCourseToLiveWind();
        this.refreshFleetPhysics();
        this.publishHud(true);
      });

      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || !this.app) {
          return;
        }
        const { width, height } = entry.contentRect;
        if (width < 2 || height < 2) {
          return;
        }
        this.app.renderer.resize(width, height);
        this.paintHorizon();
        this.layoutCourseAndFleet(true);
        this.ensureCanvasMounted();
      });
      this.resizeObserver.observe(hostEl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Pixi failed to start';
      this.pixiError.set(message);
      console.error('Sailing simulator Pixi bootstrap failed', error);
    }
  }

  /** Real NWS wind-from degrees, or null while direction is missing/fallback. */
  private liveWindFromDegrees(): number | null {
    const sample = this.latestSample();
    if (sample?.degrees == null) {
      return null;
    }
    return sample.degrees;
  }

  /**
   * Once NWS reports a real wind-from, rebuild the course so buoy 1 is upwind
   * of that direction. Does not chase every puff — only boot / station change.
   */
  private maybeRealignCourseToLiveWind(): void {
    const live = this.liveWindFromDegrees();
    if (live == null || !this.pendingCourseWindAlign) {
      return;
    }
    if (
      this.courseAlignedToLiveWind &&
      this.course &&
      Math.abs(shortestHeadingDelta(this.course.windFromDegrees, live)) < 0.5
    ) {
      this.pendingCourseWindAlign = false;
      return;
    }
    // Fresh layout for the live wind (do not keep the fallback-north start).
    this.layoutCourseAndFleet(false);
  }

  /**
   * Place a wind-aligned buoy triangle (1 upwind, 3 downwind of 1, 2 abeam)
   * and spawn the fleet on the start line further downwind of buoy 3.
   * Orientation uses the live NWS wind-from when available.
   */
  private layoutCourseAndFleet(preserveProgress = false): void {
    if (!this.app || !this.courseLayer || !this.boatLayer) {
      return;
    }

    const preserved = preserveProgress ? this.fleet : undefined;
    const playerStrategy = preserveProgress
      ? this.playerBoat()?.memory.strategy
      : undefined;

    const live = this.liveWindFromDegrees();
    const windFrom =
      live ??
      this.lastPuff()?.degrees ??
      this.playerBoat()?.state.windFromDegrees ??
      FALLBACK_WIND_FROM_DEGREES;

    this.course = setupCourse(
      this.app.screen.width,
      this.app.screen.height,
      windFrom,
    );
    this.courseSide.set(this.course.side);
    this.roundPolyCount = 0;
    this.roundPolyLastAtMs = 0;
    this.roundPolyLastKey = '';
    resetTackPlanLog();
    resetHelmConflictLog();

    if (live != null) {
      this.courseAlignedToLiveWind = true;
      this.pendingCourseWindAlign = false;
    }

    this.fleet = createRaceFleet(this.course, {
      playerStrategy,
      preserved,
      includeNpcs: this.fleetMode() === 'fleet',
    });

    const player = this.playerBoat();
    if (player) {
      this.tackStrategy.set(player.memory.strategy);
      this.strategyScore.set('Clear · ready');
      this.trafficStatus.set('Clear');
      this.goalBuoy.set(player.memory.goalBuoyIndex);
      this.laps.set(player.memory.lapsCompleted);
    }

    this.spawnFleetViews();
    this.refreshFleetPhysics();
    this.drawCourse(this.course);
    this.publishHud(true);
  }

  private drawCourse(course: RaceCourse): void {
    if (!this.courseLayer) {
      return;
    }

    this.courseLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.aimDebug = null;
    this.strategyLabelLayer = null;

    const [b1, b2, b3] = course.buoys;
    const legs = new Graphics()
      .moveTo(b1.x, b1.y)
      .lineTo(b2.x, b2.y)
      .lineTo(b3.x, b3.y)
      .lineTo(b1.x, b1.y)
      .stroke({ width: 1.5, color: 0x3ecfbf, alpha: 0.28 });
    this.courseLayer.addChild(legs);

    const clearance = new Graphics();
    const clearanceRadius = markClearanceRadiusPx(course);
    for (const buoy of course.buoys) {
      clearance
        .circle(buoy.x, buoy.y, clearanceRadius)
        .stroke({ width: 1.5, color: 0xff8a2b, alpha: 0.32 });
    }
    this.courseLayer.addChild(clearance);

    for (const buoy of course.buoys) {
      const mark = new Container();
      mark.position.set(buoy.x, buoy.y);

      const leaveTo = roundingSideForGoal(course, buoy.index);
      const sense = roundingSenseForGoal(course, buoy.index);
      const disc = new Graphics()
        .circle(0, 0, Math.max(8, course.markRadiusPx * 0.55))
        .fill({ color: buoy.index === 1 ? 0xe8a23a : 0x7ee0d4, alpha: 0.95 })
        .stroke({ width: 2, color: 0xeef4f8, alpha: 0.7 });

      const label = new Text({
        text: String(buoy.index),
        style: {
          fontFamily: 'Sora, sans-serif',
          fontSize: 11,
          fill: 0x071018,
          fontWeight: '700',
        },
      });
      label.anchor.set(0.5);

      const caption = new Text({
        text: buoy.role,
        style: {
          fontFamily: 'Sora, sans-serif',
          fontSize: 10,
          fill: 0xeef4f8,
        },
      });
      caption.anchor.set(0.5, -1.6);

      // Course-plan leave-to: port = mark on boat's left (CCW), starboard = right (CW).
      const leaveLabel = new Text({
        text: `leave ${leaveTo} · ${sense}`,
        style: {
          fontFamily: 'Sora, sans-serif',
          fontSize: 10,
          fill: leaveTo === 'port' ? 0xffb4a8 : 0xa8c8ff,
          fontWeight: '600',
        },
      });
      leaveLabel.anchor.set(0.5, -2.8);

      mark.addChild(disc, label, caption, leaveLabel);
      this.courseLayer.addChild(mark);
    }

    // Live per-boat strategy overlay (tack points + rounding R).
    this.aimDebug = new Graphics();
    this.strategyLabelLayer = new Container();
    this.courseLayer.addChild(this.aimDebug, this.strategyLabelLayer);
  }

  /** Build Pixi hulls for every racer; NPCs are always auto-driven. */
  private spawnFleetViews(): void {
    if (!this.boatLayer) {
      return;
    }

    this.boatLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.boatViews.clear();

    for (const boat of this.fleet) {
      const root = new Container();
      const hull = drawMelgesHull(new Graphics(), boat.spec.fill, boat.spec.stroke);
      // Stern signal (local +y is aft on the Melges planform).
      const clearBlink = new Graphics()
        .circle(0, 17.5, 3.2)
        .fill({ color: 0x3dc4ff, alpha: 1 });
      clearBlink.visible = false;

      const label = new Text({
        text: `${boat.spec.shortName} 0.0`,
        style: {
          fontFamily: 'Sora, sans-serif',
          fontSize: 11,
          fill: 0xeef4f8,
        },
      });
      label.anchor.set(0.5, 1.8);

      root.addChild(hull, clearBlink, label);
      this.boatLayer.addChild(root);
      this.boatViews.set(boat.spec.id, { root, hull, label, clearBlink });
      this.syncBoatView(boat);
    }
  }

  private ensureCanvasMounted(): void {
    if (!this.app) {
      return;
    }
    const hostEl = this.stageHost().nativeElement;
    if (!this.app.canvas.isConnected) {
      hostEl.appendChild(this.app.canvas);
    }
  }

  private paintHorizon(): void {
    if (!this.app || !this.horizon) {
      return;
    }
    this.horizon.clear();
    this.horizon
      .rect(0, 0, this.app.screen.width, this.app.screen.height)
      .fill({ color: 0x0a2a38 });
  }

  private spawnArrow(puff: WindPuff): void {
    if (!this.app || !this.puffLayer) {
      return;
    }

    const radians = ((puff.degrees + 180 - 90) * Math.PI) / 180;
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const margin = 40;
    const startX = Math.random() * (width - margin * 2) + margin;
    const startY = Math.random() * (height - margin * 2) + margin;
    // Only the arrowhead grows with wind; shaft + kn label stay fixed.
    const headScale = Math.max(0.55, Math.min(2.2, 0.45 + puff.knots / 12));
    const color = windArrowColor(puff.knots);
    const tipX = 14;
    const headBaseX = tipX - 10 * headScale;
    const headHalfW = 7 * headScale;

    const root = new Container();
    root.position.set(startX, startY);
    root.rotation = radians;

    const shaft = new Graphics()
      .moveTo(-18, 0)
      .lineTo(tipX, 0)
      .stroke({ width: 2, color, alpha: 0.9 });

    const head = new Graphics()
      .poly([tipX, 0, headBaseX, -headHalfW, headBaseX, headHalfW])
      .fill({ color, alpha: 0.95 });

    const label = new Text({
      text: `${puff.knots.toFixed(1)} kn`,
      style: {
        fontFamily: 'Sora, sans-serif',
        fontSize: 11,
        fill: 0xeef4f8,
      },
    });
    label.anchor.set(0.5, 1.4);
    label.rotation = -radians;

    root.addChild(shaft, head, label);
    this.puffLayer.addChild(root);

    this.arrows.push({
      id: `puff-${++this.puffSeq}`,
      x: startX,
      y: startY,
      knots: puff.knots,
      degrees: puff.degrees,
      root,
      drift: 0.035 + puff.knots * 0.012,
      life: 1,
    });

    if (this.arrows.length > 48) {
      const oldest = this.arrows.shift();
      oldest?.root.destroy({ children: true });
    }
  }

  /** Advance every boat; only the player can be under manual helm. */
  private steerAndDriveFleet(deltaMs: number): void {
    const course = this.course;
    if (!course || this.fleet.length === 0) {
      return;
    }

    const dt = deltaMs / 1000;
    const nowMs = Date.now();
    const traffic = evaluateTraffic(this.fleet, course);

    for (const boat of this.fleet) {
      let next = boat.state;
      const isManualPlayer = boat.spec.role === 'player' && this.helmMode() === 'manual';
      const foul = updateFoulPenalty(boat, this.fleet, nowMs, course);
      // Manual helm must be able to tack through the wind — recovery would yank back.
      // Rounding owns CH around the mark; recovery was thrashing Round CH ↔ bear-away.
      const recovery = updateHelmRecovery(boat, nowMs, {
        allowRecovery:
          !isManualPlayer && boat.memory.roundingPhase !== 'rounding',
      });
      // Last-resort collision skill (auto helm only); may set one-tick depower.
      // Foul spin owns the helm; deferred foul (awaitingClear) does not.
      boat.depowered = false;
      const steerClear =
        !isManualPlayer && foul.mode === 'none'
          ? decideSteerClear(boat, this.fleet, course, deltaMs)
          : null;
      if (steerClear && steerClear.action !== 'none') {
        if (steerClear.depower) {
          boat.depowered = true;
        }
        boat.steerClearSignalUntilMs = nowMs + STEER_CLEAR_SIGNAL_MS;
      }

      let helm: HelmOwner = 'driver';
      let helmReason: string | null = foul.reason ?? boat.recoveryReason;
      let activeXY: { x: number; y: number } | null = null;

      if (foul.mode === 'spin360' && foul.spinSign !== null) {
        helm = 'spin360';
        helmReason = foul.reason;
        const step = FOUL_SPIN_TURN_RATE_DEG_PER_SEC * foul.spinSign * dt;
        next = rotateSailboat(next, step);
        boat.foulSpinAccumulatedDeg += Math.abs(step);
        if (boat.foulSpinAccumulatedDeg >= 360) {
          updateFoulPenalty(boat, this.fleet, nowMs, course);
        }
        if (boat.spec.role === 'player') {
          this.driverReason.set(
            boat.foulPhase === 'none'
              ? 'Foul cleared · resume'
              : (foul.reason ?? 'Foul · 360°'),
          );
          this.targetHeading.set(Math.round(next.headingDegrees));
        }
      } else if (isManualPlayer) {
        helm = 'manual';
        helmReason = 'Manual helm';
        let delta = 0;
        if (this.keysDown.has('a')) {
          delta -= MANUAL_TURN_RATE_DEG_PER_SEC * dt;
        }
        if (this.keysDown.has('d')) {
          delta += MANUAL_TURN_RATE_DEG_PER_SEC * dt;
        }
        if (delta !== 0) {
          next = rotateSailboat(next, delta);
        }
        this.driverReason.set('Manual helm · A / D rotate');
      } else if (steerClear && steerClear.action !== 'none') {
        helm = 'steerClear';
        helmReason = steerClear.reason;
        if (steerClear.action === 'tack' && steerClear.headingDegrees !== null) {
          const headings = closeHauledHeadings(next.windFromDegrees);
          const toPort = Math.abs(
            shortestHeadingDelta(steerClear.headingDegrees, headings.port),
          );
          const toStbd = Math.abs(
            shortestHeadingDelta(steerClear.headingDegrees, headings.starboard),
          );
          boat.memory = {
            ...boat.memory,
            currentTack: toPort <= toStbd ? 'port' : 'starboard',
            lastTackAtMs: nowMs,
          };
        }

        const desiredHeading =
          steerClear.headingDegrees ?? next.headingDegrees;
        if (boat.spec.role === 'player') {
          this.driverReason.set(steerClear.reason ?? 'Steer clear');
          this.trafficStatus.set(steerClear.reason ?? 'Steer clear');
          this.targetHeading.set(Math.round(desiredHeading));
        }
        boat.trafficRule = steerClear.reason;
        boat.recoveryReason = steerClear.reason;

        const delta = shortestHeadingDelta(next.headingDegrees, desiredHeading);
        const maxStep = AUTO_TURN_RATE_DEG_PER_SEC * 1.45 * dt;
        const step = Math.max(-maxStep, Math.min(maxStep, delta));
        if (Math.abs(step) > 0.05) {
          next = rotateSailboat(next, step);
        }
      } else if (recovery.headingDegrees !== null) {
        helm = 'recovery';
        helmReason = recovery.reason;
        if (boat.spec.role === 'player') {
          this.driverReason.set(recovery.reason ?? 'Recovery · bear away');
          this.targetHeading.set(Math.round(recovery.headingDegrees));
        }

        const delta = shortestHeadingDelta(next.headingDegrees, recovery.headingDegrees);
        const maxStep = AUTO_TURN_RATE_DEG_PER_SEC * 1.35 * dt;
        const step = Math.max(-maxStep, Math.min(maxStep, delta));
        if (Math.abs(step) > 0.05) {
          next = rotateSailboat(next, step);
        }
      } else {
        helm = 'driver';
        const decision = decideDriverHeading(next, course, boat.memory);
        boat.memory = decision.memory;
        helmReason = decision.reason;
        activeXY = decision.plan.activeTarget;
        const hint = traffic.get(boat.spec.id);
        // Close-hauled beat/layline/rounding: traffic bias yanks the fetch/CH
        // heading (±18°) and can pin desired≈current with ~0 progress to Exit.
        const holdCourse =
          decision.plan.legMode === 'beat' ||
          decision.memory.roundingPhase === 'rounding' ||
          decision.reason.startsWith('Escape no-go') ||
          decision.reason.startsWith('Layline tack') ||
          decision.reason.startsWith('Round ');
        const bias = holdCourse
          ? 0
          : Math.max(-18, Math.min(18, hint?.avoidHeadingBiasDeg ?? 0));
        const desiredHeading = normalizeHeadingDegrees(
          decision.desiredHeadingDegrees + bias,
        );

        if (boat.spec.id === ROUND_POLY_BOAT_ID) {
          this.logRoundPoly(boat, course, decision, nowMs);
        }

        if (boat.spec.role === 'player') {
          this.driverReason.set(
            hint?.ruleLabel
              ? `${decision.reason} · ${hint.ruleLabel}`
              : decision.reason,
          );
          this.strategyScore.set(
            `Replan ${decision.score.value.toFixed(1)} · ${decision.score.detail}`,
          );
          this.goalBuoy.set(decision.memory.goalBuoyIndex);
          this.laps.set(decision.memory.lapsCompleted);

          const heading = Math.round(desiredHeading);
          if (this.targetHeading() !== heading) {
            this.targetHeading.set(heading);
          }
        }

        const delta = shortestHeadingDelta(next.headingDegrees, desiredHeading);
        const maxStep = AUTO_TURN_RATE_DEG_PER_SEC * dt;
        const step = Math.max(-maxStep, Math.min(maxStep, delta));
        if (Math.abs(step) > 0.05) {
          next = rotateSailboat(next, step);
        }
      }

      next = applyWindToSailboat(next, this.drivingWindFor(next));
      const speedScale = boat.depowered ? 0.5 : 1;
      next = advanceBoatPosition(next, course, deltaMs, speedScale);
      // Depower is a one-tick modifier — always clear after the movement update.
      boat.depowered = false;
      boat.state = next;

      // Near-mark / foul confusion: log only on helm·foul·round·wp changes.
      if (
        boat.foulPhase !== 'none' ||
        boat.memory.roundingPhase === 'rounding' ||
        helm === 'steerClear' ||
        helm === 'spin360'
      ) {
        if (!activeXY && boat.memory.roundingPhase === 'rounding') {
          const plan = resolveDriverPlan(boat.state, boat.memory, course);
          activeXY = plan.activeTarget;
        }
        const mark =
          boat.memory.roundingPhase === 'rounding'
            ? buoyByIndex(course, boat.memory.goalBuoyIndex)
            : null;
        noteHelmConflict({
          id: boat.spec.id,
          helm,
          foul: boat.foulPhase,
          clearPlan: boat.foulClearPlan,
          round: boat.memory.roundingPhase ?? 'approach',
          wp: boat.memory.roundingWaypointIndex ?? 0,
          goal: boat.memory.goalBuoyIndex,
          reason: helmReason,
          pos: helmConflictPos(boat.state),
          active: activeXY
            ? [round1(activeXY.x), round1(activeXY.y)]
            : null,
          chordClr: roundingChordClearancePx(boat.state, activeXY, mark),
        });
      }
    }

    resolveFleetContacts(this.fleet, course, nowMs);

    for (const boat of this.fleet) {
      const prevWp = boat.memory.roundingWaypointIndex ?? 0;
      const prevRound = boat.memory.roundingPhase ?? 'approach';
      boat.memory = advanceGoalIfClearReached(boat.memory, boat.state, course);
      const wp = boat.memory.roundingWaypointIndex ?? 0;
      const round = boat.memory.roundingPhase ?? 'approach';
      if (
        (round === 'rounding' || prevRound === 'rounding') &&
        (wp !== prevWp || round !== prevRound)
      ) {
        const plan = resolveDriverPlan(boat.state, boat.memory, course);
        const mark = buoyByIndex(course, boat.memory.goalBuoyIndex);
        noteHelmConflict({
          id: boat.spec.id,
          helm: 'driver',
          foul: boat.foulPhase,
          clearPlan: boat.foulClearPlan,
          round,
          wp,
          goal: boat.memory.goalBuoyIndex,
          reason: round !== prevRound ? `round ${prevRound}→${round}` : `wp ${prevWp}→${wp}`,
          pos: helmConflictPos(boat.state),
          active: [
            round1(plan.activeTarget.x),
            round1(plan.activeTarget.y),
          ],
          chordClr: roundingChordClearancePx(
            boat.state,
            plan.activeTarget,
            mark,
          ),
        });
      }
      this.syncBoatView(boat);
    }

    const player = this.playerBoat();
    if (player) {
      this.goalBuoy.set(player.memory.goalBuoyIndex);
      this.laps.set(player.memory.lapsCompleted);
      this.trafficStatus.set(player.recoveryReason ?? player.trafficRule ?? 'Clear');
    }
    this.updateStrategyDebug(course);
  }

  /**
   * Rounding geometry debug. Filter DevTools by `[round-poly]`.
   * Logs approach side + locked entry/exit/sweep/waypoints near the mark.
   */
  private logRoundPoly(
    boat: RaceBoat,
    course: RaceCourse,
    decision: ReturnType<typeof decideDriverHeading>,
    nowMs: number,
  ): void {
    if (!isLocalDevHost()) {
      return;
    }
    if (this.roundPolyCount >= ROUND_POLY_MAX) {
      return;
    }
    if (boat.state.trueWindSpeedKnots <= 0) {
      return;
    }
    const goal = buoyByIndex(course, boat.memory.goalBuoyIndex);
    const distMark = distancePx(boat.state.x, boat.state.y, goal.x, goal.y);
    const near =
      distMark <= decision.plan.clearancePx * 7 ||
      boat.memory.roundingPhase === 'rounding';
    if (!near) {
      return;
    }

    const path = boat.memory.roundingPath;
    const key = [
      boat.memory.goalBuoyIndex,
      boat.memory.roundingPhase,
      boat.memory.roundingWaypointIndex,
      path ? Math.round(path.sweepDeg) : -1,
      Math.round(decision.plan.activeTarget.x),
      Math.round(decision.plan.activeTarget.y),
      decision.reason,
    ].join('·');
    const due =
      key !== this.roundPolyLastKey ||
      nowMs - this.roundPolyLastAtMs >= ROUND_POLY_INTERVAL_MS;
    if (!due) {
      return;
    }

    this.roundPolyLastKey = key;
    this.roundPolyLastAtMs = nowMs;
    this.roundPolyCount += 1;

    const snap = buildRoundGeoSnapshot(boat.state, boat.memory, course);
    debugLog(
      `[round-poly ${this.roundPolyCount}/${ROUND_POLY_MAX}]`,
      JSON.stringify({
        ...snap,
        reason: decision.reason,
        mode: decision.plan.legMode,
        active: [
          round1(decision.plan.activeTarget.x),
          round1(decision.plan.activeTarget.y),
        ],
      }),
    );
  }

  /**
   * Per-boat strategy map: cone In/Out gates (+ optional T) in hull color.
   */
  private updateStrategyDebug(course: RaceCourse): void {
    if (!this.aimDebug || !this.strategyLabelLayer) {
      return;
    }

    this.aimDebug.clear();
    this.strategyLabelLayer.removeChildren().forEach((child) => child.destroy());

    for (const boat of this.fleet) {
      const plan = buildRaceStrategy(boat.state, boat.memory, course);
      const color = boat.spec.fill;
      const points = plan.waypoints;

      // Formal rounding geometry: clearance circle, entry gate, arc, exit.
      const mark = buoyByIndex(course, boat.memory.goalBuoyIndex);
      const formal = buildMarkRoundingSpec(course, boat.memory.goalBuoyIndex);
      const polygon =
        plan.roundingPath ??
        buildRoundingPolygon(formal, {
          x: boat.state.x,
          y: boat.state.y,
          headingDegrees: boat.state.headingDegrees,
        });
      const locked = plan.roundingPath != null;
      const polyAlpha = locked ? 0.9 : 0.55;

      this.aimDebug
        .circle(mark.x, mark.y, formal.pathRadiusPx)
        .stroke({ width: 1.2, color, alpha: 0.35 });
      this.aimDebug
        .circle(mark.x, mark.y, formal.clearancePx)
        .stroke({ width: 1, color, alpha: 0.25 });

      this.aimDebug
        .moveTo(mark.x, mark.y)
        .lineTo(formal.entryGate.tip.x, formal.entryGate.tip.y)
        .stroke({ width: 1.8, color, alpha: 0.7 });
      this.aimDebug
        .circle(formal.entryGate.aim.x, formal.entryGate.aim.y, 6)
        .stroke({ width: 1.4, color, alpha: 0.8 });
      this.aimDebug
        .circle(formal.entryGate.through.x, formal.entryGate.through.y, 5)
        .fill({ color, alpha: 0.55 });

      const entryTag = new Text({
        text: 'Entry',
        style: {
          fontFamily: 'Sora, sans-serif',
          fontSize: 11,
          fill: color,
          fontWeight: '800',
        },
      });
      entryTag.anchor.set(0.5);
      entryTag.position.set(
        formal.entryGate.aim.x,
        formal.entryGate.aim.y - 14,
      );
      this.strategyLabelLayer.addChild(entryTag);

      let polyX = polygon.entryPoint.x;
      let polyY = polygon.entryPoint.y;
      this.aimDebug
        .circle(polyX, polyY, 4)
        .fill({ color, alpha: polyAlpha });
      for (const vertex of polygon.waypoints) {
        this.aimDebug
          .moveTo(polyX, polyY)
          .lineTo(vertex.x, vertex.y)
          .stroke({ width: locked ? 2.2 : 1.6, color, alpha: polyAlpha });
        this.aimDebug
          .circle(vertex.x, vertex.y, 5)
          .fill({ color, alpha: polyAlpha });
        polyX = vertex.x;
        polyY = vertex.y;
      }
      const exit = polygon.exitPoint;
      this.aimDebug
        .circle(exit.x, exit.y, 8)
        .stroke({ width: 1.8, color, alpha: 0.95 });
      this.aimDebug
        .moveTo(exit.x, exit.y)
        .lineTo(polygon.nextAim.x, polygon.nextAim.y)
        .stroke({ width: 1.2, color, alpha: 0.4 });
      const exitTag = new Text({
        text: locked ? 'Exit' : 'Exit*',
        style: {
          fontFamily: 'Sora, sans-serif',
          fontSize: 11,
          fill: color,
          fontWeight: '800',
        },
      });
      exitTag.anchor.set(0.5);
      exitTag.position.set(exit.x, exit.y - 14);
      this.strategyLabelLayer.addChild(exitTag);

      // Helm path: boat → T? → entry / polygon vertex.
      let prevX = boat.state.x;
      let prevY = boat.state.y;
      for (const point of points) {
        this.aimDebug
          .moveTo(prevX, prevY)
          .lineTo(point.x, point.y)
          .stroke({ width: 1.4, color, alpha: 0.45 });
        prevX = point.x;
        prevY = point.y;

        if (point.kind === 'tack') {
          this.aimDebug
            .circle(point.x, point.y, 7)
            .fill({ color, alpha: 0.94 })
            .stroke({ width: 1.4, color: 0x071018, alpha: 0.5 });
          const tag = new Text({
            text: point.label ?? 'T',
            style: {
              fontFamily: 'Sora, sans-serif',
              fontSize: 10,
              fill: 0x071018,
              fontWeight: '800',
            },
          });
          tag.anchor.set(0.5);
          tag.position.set(point.x, point.y);
          this.strategyLabelLayer.addChild(tag);
        } else if (point.label === 'Dest' || point.label) {
          const tag = new Text({
            text: point.label,
            style: {
              fontFamily: 'Sora, sans-serif',
              fontSize: 10,
              fill: color,
              fontWeight: '700',
            },
          });
          tag.anchor.set(0.5);
          tag.position.set(point.x, point.y - 12);
          this.strategyLabelLayer.addChild(tag);
        }
      }

      // Active transit aim (not an In/Out tip).
      this.aimDebug
        .circle(plan.activeTarget.x, plan.activeTarget.y, 11)
        .stroke({ width: 1.5, color, alpha: 0.7 });
    }
  }

  /** Station TWS + nearest puff direction (stale arrow knots ignored). */
  private drivingWindFor(
    boat: Pick<SailboatState, 'x' | 'y'>,
  ): ReturnType<typeof resolveDrivingWind> {
    const sample = this.latestSample();
    return resolveDrivingWind(
      boat,
      this.arrows,
      sample
        ? {
            knots: sample.knots,
            degrees: sample.degrees ?? FALLBACK_WIND_FROM_DEGREES,
          }
        : null,
    );
  }

  /** Keep already-spawned arrows on the live station speed. */
  private syncArrowWindSpeeds(knots: number): void {
    for (const arrow of this.arrows) {
      arrow.knots = knots;
      const label = arrow.root.children.find(
        (child): child is Text => child instanceof Text,
      );
      if (label) {
        label.text = `${knots.toFixed(1)} kn`;
      }
    }
  }

  private clearWindArrows(): void {
    for (const arrow of this.arrows) {
      arrow.root.destroy({ children: true });
    }
    this.arrows = [];
  }

  private refreshFleetPhysics(): void {
    for (const boat of this.fleet) {
      boat.state = applyWindToSailboat(boat.state, this.drivingWindFor(boat.state));
    }
  }

  private publishHud(force = false): void {
    const player = this.playerBoat();
    if (!player) {
      return;
    }

    if (this.course) {
      this.standings.set(computeRaceStandings(this.fleet, this.course));
    }

    if (!force) {
      const current = this.boat();
      if (
        current &&
        current.speedKnots === player.state.speedKnots &&
        Math.round(current.headingDegrees) === Math.round(player.state.headingDegrees) &&
        current.trueWindAngleDegrees === player.state.trueWindAngleDegrees &&
        current.x === player.state.x &&
        current.y === player.state.y
      ) {
        return;
      }
    }
    this.boat.set({ ...player.state });
  }

  private syncBoatView(boat: RaceBoat): void {
    const view = this.boatViews.get(boat.spec.id);
    if (!view) {
      return;
    }
    view.root.position.set(boat.state.x, boat.state.y);
    view.root.rotation = (boat.state.headingDegrees * Math.PI) / 180;
    view.label.rotation = -view.root.rotation;
    const spinLabel =
      boat.foulPhase === 'spin360'
        ? ` 360 ${Math.min(360, Math.round(boat.foulSpinAccumulatedDeg))}°`
        : boat.foulPhase === 'awaitingClear'
          ? ' foul'
          : '';
    view.label.text = `${boat.spec.shortName} ${boat.state.speedKnots.toFixed(1)}${spinLabel}`;
    view.hull.tint = boat.foulPhase !== 'none' ? FOUL_BROADCAST_TINT : 0xffffff;

    const clearActive = boat.steerClearSignalUntilMs > Date.now();
    view.clearBlink.visible = clearActive;
    if (clearActive) {
      // Blink ~4 Hz while the steer-clear skill is working.
      const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(Date.now() / 120));
      view.clearBlink.alpha = pulse;
    }
  }

  private tick(deltaMs: number): void {
    this.ensureCanvasMounted();

    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      const arrow = this.arrows[i];
      const travel = arrow.drift * deltaMs;
      const radians = ((arrow.degrees + 180 - 90) * Math.PI) / 180;
      arrow.x += Math.cos(radians) * travel;
      arrow.y += Math.sin(radians) * travel;
      arrow.root.position.set(arrow.x, arrow.y);
      arrow.life -= deltaMs / 4200;
      arrow.root.alpha = Math.max(0, arrow.life);

      if (arrow.life <= 0) {
        arrow.root.destroy({ children: true });
        this.arrows.splice(i, 1);
      }
    }

    this.steerAndDriveFleet(deltaMs);

    this.hudElapsed += deltaMs;
    if (this.hudElapsed >= HUD_UPDATE_MS) {
      this.hudElapsed = 0;
      this.publishHud();
    }
  }

  private teardownPixiOnly(): void {
    this.puffSub?.unsubscribe();
    this.puffSub = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearWindArrows();
    this.boatViews.clear();
    this.fleet = [];
    this.courseLayer = null;
    this.puffLayer = null;
    this.boatLayer = null;
    this.horizon = null;
    this.course = null;
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }

  private teardown(): void {
    this.keysDown.clear();
    this.teardownPixiOnly();
  }
}
