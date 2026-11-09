import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';

const QUOTES = [
  'Dream manfully and well, and your dreams will be your prophets.',
  'Late have I loved you, O Beauty ever ancient, ever new.',
  'The nymphs are departed… Departed, have left no addresses.',
  'You called, you shouted, and you broke through my deafness.',
  'If you can trust yourself when all men doubt you, but make allowance for their doubting too;',
];

const FADE_MS = 900;
const HOLD_MS = 1600;
const SCROLL_PX_PER_S = 45;
const READ_MS = 5000; // Hold time for quotes that fit without scrolling.

type Jump = 'restart' | 'back';

/**
 * Header quote rotation: fade in, scroll sideways if it overflows, fade out, next.
 * Hovering pauses the motion; the ‹ button rewinds the quote, or steps back one if already at its start.
 */
@Component({
  selector: 'app-quote-ticker',
  host: {
    '(mouseenter)': 'paused = true',
    '(mouseleave)': 'paused = false',
  },
  template: `
    <button
      type="button"
      class="ticker__back text-marble-dim transition-[opacity,color] hover:text-phosphor"
      aria-label="Rewind quote, or show the previous one"
      (click)="rewind()"
    >
      ‹
    </button>
    <div #viewport class="ticker">
      <p #line class="display ticker__line text-[1.3125rem] leading-none italic text-marble-dim"></p>
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-width: 0;
      width: 50vw;
    }

    @media (min-width: 768px) {
      :host {
        width: 25vw;
      }
    }

    /* Oval vignette: the line dissolves toward the ends and edges of an ellipse. */
    .ticker {
      overflow: hidden;
      padding-block: 0.6rem;
      mask-image: radial-gradient(ellipse 50% 85% at 50% 50%, #000 66%, transparent 100%);
    }

    .ticker__line {
      width: max-content;
      padding-inline: 18%;
      white-space: nowrap;
      opacity: 0;
      will-change: transform, opacity;
    }

    /* Sits in the faded left edge; shown on hover or keyboard focus. */
    .ticker__back {
      position: absolute;
      z-index: 1;
      inset-block: 0;
      left: 0;
      padding-inline: 0.5rem;
      font-size: 1.25rem;
      line-height: 1;
      opacity: 0;
      cursor: pointer;
    }

    :host(:hover) .ticker__back,
    .ticker__back:focus-visible {
      opacity: 1;
    }

    @media (hover: none) {
      .ticker__back {
        opacity: 0.6;
      }
    }
  `,
})
export class QuoteTicker {
  protected paused = false;

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly line = viewChild.required<ElementRef<HTMLElement>>('line');
  private alive = true;
  private jump: Jump | null = null;
  private scrolled = false; // Has the current quote moved off its first word?

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.alive = false));
    afterNextRender(() => void this.cycle());
  }

  protected rewind(): void {
    this.jump = this.scrolled ? 'restart' : 'back';
  }

  private async cycle(): Promise<void> {
    const line = this.line().nativeElement;
    await document.fonts.ready; // Measure with the real serif, not the fallback.
    let i = 0;
    let instant = false;

    while (this.alive) {
      await this.show(line, QUOTES[i], instant);
      const jump = this.jump;
      this.jump = null;
      instant = jump !== null;
      if (jump === 'back') i = (i - 1 + QUOTES.length) % QUOTES.length;
      else if (!jump) i = (i + 1) % QUOTES.length;
    }
  }

  /** One quote's run. Returns early when the reader rewinds. */
  private async show(line: HTMLElement, quote: string, instant: boolean): Promise<void> {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Drop the previous run's held (fill: forwards) offset and opacity.
    line.getAnimations().forEach((a) => a.cancel());
    // Set text directly so the width below is measured on this quote, not the last.
    line.textContent = quote;
    this.scrolled = false;
    const distance = Math.max(0, line.scrollWidth - this.viewport().nativeElement.clientWidth);

    // A rewind shows the start at once, so it reads even while hover holds the motion.
    if (instant) line.animate([{ opacity: 1 }, { opacity: 1 }], { fill: 'forwards' }).finish();
    else if (!(await this.play(line, [{ opacity: 0 }, { opacity: 1 }], FADE_MS))) return;

    if (!(await this.wait(HOLD_MS))) return;

    if (distance > 0 && !still) {
      this.scrolled = true;
      const keyframes = [{ transform: 'translateX(0)' }, { transform: `translateX(${-distance}px)` }];
      if (!(await this.play(line, keyframes, (distance / SCROLL_PX_PER_S) * 1000, 'linear'))) return;
      if (!(await this.wait(HOLD_MS))) return;
    } else if (!(await this.wait(READ_MS))) {
      return;
    }

    await this.play(line, [{ opacity: 1 }, { opacity: 0 }], FADE_MS);
  }

  /** Runs an animation that pauses on hover. Resolves false if interrupted by a rewind. */
  private async play(
    el: HTMLElement,
    keyframes: Keyframe[],
    duration: number,
    easing = 'ease-in-out',
  ): Promise<boolean> {
    const anim = el.animate(keyframes, { duration, easing, fill: 'forwards' });
    const poll = setInterval(() => {
      if (this.jump || !this.alive) anim.cancel();
      else if (this.paused) anim.pause();
      else anim.play();
    }, 50);
    try {
      await anim.finished;
      return true;
    } catch {
      return false;
    } finally {
      clearInterval(poll);
    }
  }

  /** Sleep that stops counting while hovered. Resolves false if interrupted by a rewind. */
  private async wait(ms: number): Promise<boolean> {
    let last = performance.now();
    while (ms > 0) {
      await new Promise((r) => setTimeout(r, 50));
      if (this.jump || !this.alive) return false;
      const now = performance.now();
      if (!this.paused) ms -= now - last; // Real elapsed time; timer ticks drift.
      last = now;
    }
    return true;
  }
}
