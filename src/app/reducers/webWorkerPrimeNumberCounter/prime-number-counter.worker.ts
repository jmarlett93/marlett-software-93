import { range } from 'lodash';
import { DoWork, runWorker } from 'observable-webworker';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export class PrimeNumberCounterWorker implements DoWork<number, number> {
  public work(input$: Observable<number>): Observable<number> {
    return input$.pipe(
      map((numberLim) => this.randomNumberGenerate(numberLim)),
    );
  }

  randomNumberGenerate(rangeLimit: number): number {
    let count = 0;
    const array = range(rangeLimit);
    array.forEach((item) => {
      this.isPrime(item) ? (count += 1) : null;
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
runWorker(PrimeNumberCounterWorker);
