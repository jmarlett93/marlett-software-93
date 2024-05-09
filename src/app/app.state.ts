import { ActionReducerMap } from '@ngrx/store';
import * as fromWebWorkerPrimeCounterState from './reducers/webWorkerPrimeNumberCounter/web-worker-prime-number-counter.reducer';

export function defaultReducer<T>(state: T) {
  return state;
}

export const initialReducerMap = {
  webWorkerPrimeNumberCounterState: defaultReducer,
} as ActionReducerMap<ApplicationState>;

export function getInitialState() {
  const g = {
    webWorkerPrimeNumberCounterState:
      fromWebWorkerPrimeCounterState.initialState,
  } as ApplicationState;
  return g;
}

export interface ApplicationState {
  webWorkerPrimeNumberCounterState: fromWebWorkerPrimeCounterState.State;
}
