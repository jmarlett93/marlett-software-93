import { Action } from '@ngrx/store';

export const SimulationUiActions = {
  SET_REMOTE_PRIME_COUNT: 'SET_REMOTE_PRIME_COUNT'
};

export class SetRemotePrimeCount implements Action {
  readonly type = SimulationUiActions.SET_REMOTE_PRIME_COUNT;
  payload: number;
  constructor( payload: number ) {
    this.payload = payload;
  }
}

export type SimulationUiActionTypes =
| SetRemotePrimeCount ;
