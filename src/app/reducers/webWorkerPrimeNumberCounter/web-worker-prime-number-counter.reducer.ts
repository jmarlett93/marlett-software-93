import { WebWorkerPrimeNumberCounterTypes,
  WebWorkerPrimeNumberCounterActions} from 'src/app/reducers/webWorkerPrimeNumberCounter/web-worker-prime-number-counter.actions';


export interface WebWorkerPrimeNumberCounterState {
  count: number;
}


export const initialWebWorkerPrimeNumberCounterState: WebWorkerPrimeNumberCounterState = {
  count: 0
};

export function webWorkerPrimeNumberCounterReducer(
  state = initialWebWorkerPrimeNumberCounterState,
  action: WebWorkerPrimeNumberCounterTypes): WebWorkerPrimeNumberCounterState {
  switch (action.type) {
    default: {
      return state;
    }
  }
}
