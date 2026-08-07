import { Injectable, signal } from '@angular/core';
import {
  Observable,
  catchError,
  filter,
  from,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';

export type WindSample = {
  at: number;
  knots: number;
  degrees: number | null;
  station: string;
};

export type WindPuff = {
  at: number;
  knots: number;
  degrees: number;
};

export type WindStation = {
  id: string;
  label: string;
  shortLabel: string;
  region: 'monterey' | 'san-francisco';
};

/**
 * Maritime NOAA / NDBC stations exposed via api.weather.gov.
 * 46042 — Monterey buoy, 27 NM WNW of Monterey
 * 46026 — San Francisco buoy, 18 NM west of San Francisco
 */
export const WIND_STATIONS: readonly WindStation[] = [
  {
    id: '46042',
    label: 'Monterey Bay buoy (46042)',
    shortLabel: 'Monterey 46042',
    region: 'monterey',
  },
  {
    id: '46026',
    label: 'San Francisco buoy (46026)',
    shortLabel: 'SF 46026',
    region: 'san-francisco',
  },
] as const;

export const DEFAULT_WIND_STATION_ID = WIND_STATIONS[0].id;

type NwsObservationProperties = {
  timestamp?: string;
  windSpeed?: { value: number | null; unitCode?: string };
  windGust?: { value: number | null; unitCode?: string };
  windDirection?: { value: number | null };
};

const BUFFER_MS = 30_000;
/** How often we refresh the NWS observation into the buffer. */
const POLL_MS = 1_000;
/** How often we emit a wind puff from the buffer onto the board. */
const PUFF_EMIT_MS = 50;
const KMH_TO_KNOTS = 1 / 1.852;
/** Used when NWS omits wind direction (or feed is down). */
export const FALLBACK_WIND_FROM_DEGREES = 0;

const toKnots = (value: number, unitCode?: string): number => {
  if (!unitCode || unitCode.includes('km_h')) {
    return value * KMH_TO_KNOTS;
  }
  if (unitCode.includes('m_s')) {
    return value * 1.94384;
  }
  if (unitCode.includes('kn')) {
    return value;
  }
  return value * KMH_TO_KNOTS;
};

const observationUrl = (stationId: string): string =>
  `https://api.weather.gov/stations/${stationId}/observations/latest`;

@Injectable({ providedIn: 'root' })
export class MontereyWindService {
  readonly stations = WIND_STATIONS;
  readonly selectedStationId = signal<string>(DEFAULT_WIND_STATION_ID);
  readonly latestSample = signal<WindSample | null>(null);
  readonly bufferSize = signal(0);
  readonly status = signal<'idle' | 'live' | 'error'>('idle');
  readonly errorMessage = signal<string | null>(null);
  /** True when board wind-from is the due-north fallback, not a live NWS direction. */
  readonly usingDirectionFallback = signal(false);

  private readonly samples: WindSample[] = [];

  selectedStation(): WindStation {
    return (
      WIND_STATIONS.find((station) => station.id === this.selectedStationId()) ??
      WIND_STATIONS[0]
    );
  }

  /** Switch NOAA station and clear the local sample buffer so puffs restart cleanly. */
  setStation(stationId: string): void {
    if (!WIND_STATIONS.some((station) => station.id === stationId)) {
      return;
    }
    if (this.selectedStationId() === stationId) {
      return;
    }

    this.selectedStationId.set(stationId);
    this.samples.length = 0;
    this.bufferSize.set(0);
    this.latestSample.set(null);
    this.status.set('idle');
    this.errorMessage.set(null);
    this.usingDirectionFallback.set(false);
  }

  /**
   * Poll NWS once per second into a 30s buffer, but emit board puffs much
   * faster (~20 Hz) so wind vectors / driving wind feel continuous.
   */
  watchPuffs(): Observable<WindPuff> {
    const polling$ = timer(0, POLL_MS).pipe(
      switchMap(() =>
        from(this.fetchLatestSample()).pipe(
          catchError((error: unknown) => {
            this.status.set('error');
            this.errorMessage.set(
              error instanceof Error ? error.message : 'Unable to reach NWS',
            );
            return of(null);
          }),
        ),
      ),
      tap((sample) => {
        if (!sample) {
          return;
        }
        this.pushSample(sample);
        this.latestSample.set(sample);
        this.bufferSize.set(this.samples.length);
        this.status.set('live');
        this.errorMessage.set(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return timer(0, PUFF_EMIT_MS).pipe(
      withLatestFrom(polling$.pipe(startWith(null))),
      map(() => this.pickPuffFromBuffer()),
      filter((puff): puff is WindPuff => puff !== null),
    );
  }

  private async fetchLatestSample(): Promise<WindSample> {
    const stationId = this.selectedStationId();
    const response = await fetch(observationUrl(stationId), {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'marlett-software-93 (sailing-simulator)',
      },
    });

    if (!response.ok) {
      throw new Error(`NWS responded ${response.status}`);
    }

    const payload = (await response.json()) as { properties?: NwsObservationProperties };
    const properties = payload.properties;
    if (!properties) {
      throw new Error('NWS observation missing properties');
    }

    const speedValue = properties.windSpeed?.value;
    const gustValue = properties.windGust?.value;
    const rawSpeed = speedValue ?? gustValue;
    if (rawSpeed == null) {
      return {
        at: Date.now(),
        knots: 0,
        degrees: properties.windDirection?.value ?? null,
        station: stationId,
      };
    }

    const unit =
      speedValue != null ? properties.windSpeed?.unitCode : properties.windGust?.unitCode;

    return {
      at: Date.now(),
      knots: Math.max(0, Number(toKnots(rawSpeed, unit).toFixed(1))),
      degrees: properties.windDirection?.value ?? null,
      station: stationId,
    };
  }

  private pushSample(sample: WindSample): void {
    this.samples.push(sample);
    const cutoff = Date.now() - BUFFER_MS;
    while (this.samples.length > 0 && this.samples[0].at < cutoff) {
      this.samples.shift();
    }
  }

  private pickPuffFromBuffer(): WindPuff | null {
    if (this.samples.length === 0) {
      this.usingDirectionFallback.set(this.status() === 'error');
      return null;
    }

    // Direction may sample the recent buffer for swirl; knots always follow the
    // latest observation so boats don't keep sailing on stale 6 kn puffs while
    // the HUD already shows light air.
    const latest = this.samples[this.samples.length - 1]!;
    const pick = this.samples[Math.floor(Math.random() * this.samples.length)]!;
    const missingDirection = pick.degrees == null && latest.degrees == null;
    this.usingDirectionFallback.set(missingDirection || this.status() === 'error');

    return {
      at: Date.now(),
      knots: latest.knots,
      degrees:
        pick.degrees ?? latest.degrees ?? FALLBACK_WIND_FROM_DEGREES,
    };
  }
}
