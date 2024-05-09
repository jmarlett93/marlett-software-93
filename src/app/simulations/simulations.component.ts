import { Component, OnInit } from '@angular/core';
import { Store, select } from '@ngrx/store';
import { range } from 'lodash';
import { Observable } from 'rxjs';
import { ApplicationState } from '../app.state';
import * as primeCounterActions from '../reducers/webWorkerPrimeNumberCounter/web-worker-prime-number-counter.actions';
import { selectWebWorkerPrimeNumberCounterState } from '../reducers/webWorkerPrimeNumberCounter/web-worker-prime-number-counter.selectors';

@Component({
  selector: 'app-simulations',
  templateUrl: './simulations.component.html',
  styleUrls: ['./simulations.component.less'],
})
export class SimulationsComponent implements OnInit {
  mainThreadCount = 0;
  primeNumberCounterState$: Observable<{
    count: number;
    isCalculating: boolean;
  }>;
  responsiveToggle = false;
  mainThreadSpinner = false;

  constructor(private store$: Store<ApplicationState>) {}

  ngOnInit() {
    const start = Date.now();
    const end = Date.now() - start;
    this.primeNumberCounterState$ = this.store$.pipe(
      select(selectWebWorkerPrimeNumberCounterState),
    );
  }

  clear() {
    this.mainThreadCount = 0;
  }

  clearWebWorkerCount() {
    this.store$.dispatch(primeCounterActions.SetWebWorkerCount({ count: 0 }));
  }

  runWebWorkerPrimeCounter(): void {
    this.store$.dispatch(primeCounterActions.ToggleIsCalculating());
    this.store$.dispatch(
      primeCounterActions.CallWebWorkerCalculate({ numberLimit: 500000 }),
    );
  }

  toggleResponsive() {
    this.responsiveToggle = !this.responsiveToggle;
  }

  randomNumberGenerate() {
    this.mainThreadSpinner = true;
    let count = 0;
    const array = range(500000);
    array.forEach((item, index) => {
      this.isPrime(item) ? (count += 1) : null;
    });
    this.mainThreadCount = count;
    this.mainThreadSpinner = false;
  }

  isPrime(num) {
    if (num < 2) {
      return false;
    }
    for (let i = 2; i < num / 2; i++) {
      if (num % i === 0) {
        return false;
      }
    }
    return true;
  }
}
