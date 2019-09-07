import {Injectable} from '@angular/core';
import {Actions, createEffect, ofType} from '@ngrx/effects';
import {EMPTY, Observable, of} from 'rxjs';
import {map, mergeMap, catchError, switchMap} from 'rxjs/operators';
import * as primeNumberActions from './web-worker-prime-number-counter.actions';
import {fromWorker} from 'observable-webworker';

@Injectable()
export class WebWorkerPrimeNumberCounterEffects {

  runWebWorkerPrimeNumberCounter$ = createEffect(() => this.actions$.pipe(
    ofType(primeNumberActions.CallWebWorkerCalculate),
    switchMap(({numberLimit}) => {

      return fromWorker(() => new Worker('../../simulations/prime-number-counter.worker',
        {type: 'module'}),
        of(numberLimit));
    }),
    switchMap((data: number) => {
      return [
        primeNumberActions.SetWebWorkerCount({count: data}),
        primeNumberActions.ToggleIsCalculating()
      ];
    })
    )
  );

  constructor(private actions$: Actions) {
  }
}
