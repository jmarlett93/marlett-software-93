import { DoWork, ObservableWorker } from 'observable-webworker';
import { Observable } from 'rxjs';
import { range } from 'lodash';
import {
    map
} from 'rxjs/operators';

@ObservableWorker()
export class PrimeNumberCounterWorker implements DoWork<number, number> {
  public work(input$: Observable<number>): Observable<number> {

    return input$.pipe(
      map(numberLim => this.randomNumberGenerate(numberLim))
    );
  }

  randomNumberGenerate(rangeLimit: number): number {

    let count = 0;
    const array = range(rangeLimit);
    array.forEach((item, index) => {
      this.isPrime(item) ? count += 1 : null;
    });
    return count;
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
