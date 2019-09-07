import * as  WebWorkerPrimeNumberCounterActions from 'src/app/reducers/webWorkerPrimeNumberCounter/web-worker-prime-number-counter.actions';
import {createReducer, Action, on} from '@ngrx/store';

export interface State {
  count: number;
  isCalculating: boolean;
}

export const initialState: State = {
  count: 0,
  isCalculating: false
};

const webWorkerPrimeNumberCounterReducer = createReducer(
  initialState,
  on(WebWorkerPrimeNumberCounterActions.SetWebWorkerCount, (state, {count}) => ({...state, count })),
  on(WebWorkerPrimeNumberCounterActions.ToggleIsCalculating,
    ( state ) => ({ ...state, isCalculating: !state.isCalculating }))
);

export function reducer(state: State | undefined, action: Action) {
  return webWorkerPrimeNumberCounterReducer(state, action);
}
