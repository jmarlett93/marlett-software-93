import { Component, inject } from '@angular/core';
import { Store, select } from '@ngrx/store';
import { range } from 'lodash';
import { ApplicationState } from '../app.state';
import * as primeCounterActions from '../reducers/webWorkerPrimeNumberCounter/web-worker-prime-number-counter.actions';
import { selectWebWorkerPrimeNumberCounterState } from '../reducers/webWorkerPrimeNumberCounter/web-worker-prime-number-counter.selectors';

@Component({
  selector: 'app-simulations',
  templateUrl: './simulations.component.html',
  styleUrls: ['./simulations.component.less'],
})
export class SimulationsComponent {
  mainThreadCount = 0;

  responsiveToggle = false;
  mainThreadSpinner = false;
  private store$ = inject(Store<ApplicationState>);

  primeNumberCounterState$ = this.store$.pipe(
    select(selectWebWorkerPrimeNumberCounterState),
  );

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
    array.forEach((item) => {
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
