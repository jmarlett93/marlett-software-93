import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { fromWorker } from 'observable-webworker';
import { EMPTY, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import * as primeNumberActions from './web-worker-prime-number-counter.actions';

@Injectable()
export class WebWorkerPrimeNumberCounterEffects {
  runWebWorkerPrimeNumberCounter$ = createEffect(() =>
    this.actions$.pipe(
      ofType(primeNumberActions.CallWebWorkerCalculate),
      switchMap(({ numberLimit }) => {
        return fromWorker<number, number>(
          () =>
            new Worker(
              new URL('./prime-number-counter.worker', import.meta.url),
              {
                type: 'module',
              },
            ),
          of(numberLimit),
        );
      }),
      switchMap((data: number) => {
        return [
          primeNumberActions.SetWebWorkerCount({ count: data }),
          primeNumberActions.ToggleIsCalculating(),
        ];
      }),
      catchError((err) => {
        console.error(err);
        return EMPTY;
      }),
    ),
  );

  constructor(private actions$: Actions) {}
}
