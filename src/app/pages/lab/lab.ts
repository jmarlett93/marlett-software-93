import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SailingSimulator } from '../../sailing-simulator/sailing-simulator';
import { PRIME_RANGE, countPrimesInRange } from '../../workers/prime-count';

type LaneStatus = 'idle' | 'running' | 'done';

type LabSection = {
  id: string;
  label: string;
};

type Experiment = {
  id: 'A' | 'B';
  title: string;
  tone: string;
  buttonTone: string;
  flash: string;
  busy: boolean;
  count: number | null;
  elapsed: number | null;
  run: () => void;
  clear: () => void;
};

@Component({
  selector: 'app-lab',
  imports: [DecimalPipe, RouterLink, SailingSimulator],
  templateUrl: './lab.html',
  styleUrl: './lab.css',
})
export class Lab {
  private readonly destroyRef = inject(DestroyRef);

  readonly range = PRIME_RANGE;
  readonly mdnWorkersUrl =
    'https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API';

  readonly sections: readonly LabSection[] = [
    { id: 'sailing', label: 'Sailing' },
    { id: 'web-workers', label: 'Threads' },
  ];

  readonly numerals = ['I', 'II', 'III', 'IV', 'V'];

  readonly mainStatus = signal<LaneStatus>('idle');
  readonly workerStatus = signal<LaneStatus>('idle');
  readonly mainCount = signal<number | null>(null);
  readonly workerCount = signal<number | null>(null);
  readonly mainElapsedMs = signal<number | null>(null);
  readonly workerElapsedMs = signal<number | null>(null);
  readonly clickerCount = signal(0);

  readonly mainBusy = computed(() => this.mainStatus() === 'running');
  readonly workerBusy = computed(() => this.workerStatus() === 'running');

  readonly experiments = computed<Experiment[]>(() => [
    {
      id: 'A',
      title: 'Main thread',
            tone: 'text-ember',
      buttonTone: 'border-ember/45 hover:border-ember hover:bg-ember/10',
      flash: 'var(--ember)',
      busy: this.mainBusy(),
      count: this.mainCount(),
      elapsed: this.mainElapsedMs(),
      run: () => void this.runMainThread(),
      clear: () => this.clearMain(),
    },
    {
      id: 'B',
      title: 'Web worker',
            tone: 'text-phosphor',
      buttonTone: 'border-phosphor/45 hover:border-phosphor hover:bg-phosphor/10',
      flash: 'var(--phosphor)',
      busy: this.workerBusy(),
      count: this.workerCount(),
      elapsed: this.workerElapsedMs(),
      run: () => this.runWebWorker(),
      clear: () => this.clearWorker(),
    },
  ]);

  private worker: Worker | null = null;
  private workerRunStartedAt = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.terminateWorker());

    // Base href breaks bare `#id` links; router fragments + manual scroll
    // also cover lazy-loaded section targets that miss in-memory anchor scroll.
    inject(ActivatedRoute)
      .fragment.pipe(takeUntilDestroyed())
      .subscribe((id) => {
        if (!id) {
          return;
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
      });
  }

  async runMainThread(): Promise<void> {
    if (this.mainBusy()) {
      return;
    }

    this.mainStatus.set('running');
    this.mainCount.set(null);
    this.mainElapsedMs.set(null);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const startedAt = performance.now();
    const count = countPrimesInRange(this.range);
    this.mainElapsedMs.set(Math.round(performance.now() - startedAt));
    this.mainCount.set(count);
    this.mainStatus.set('done');
  }

  runWebWorker(): void {
    if (this.workerBusy()) {
      return;
    }

    this.workerStatus.set('running');
    this.workerCount.set(null);
    this.workerElapsedMs.set(null);
    this.workerRunStartedAt = performance.now();

    this.ensureWorker();
    this.worker?.postMessage(this.range);
  }

  clearMain(): void {
    this.mainStatus.set('idle');
    this.mainCount.set(null);
    this.mainElapsedMs.set(null);
  }

  clearWorker(): void {
    this.workerStatus.set('idle');
    this.workerCount.set(null);
    this.workerElapsedMs.set(null);
  }

  registerClick(): void {
    this.clickerCount.update((n) => n + 1);
  }

  private ensureWorker(): void {
    if (this.worker) {
      return;
    }

    this.worker = new Worker(new URL('../../workers/prime-counter.worker', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = ({ data }: MessageEvent<number>) => {
      this.workerElapsedMs.set(Math.round(performance.now() - this.workerRunStartedAt));
      this.workerCount.set(data);
      this.workerStatus.set('done');
    };

    this.worker.onerror = (error) => {
      console.error('Web Worker failed', error);
      this.workerStatus.set('idle');
    };
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
