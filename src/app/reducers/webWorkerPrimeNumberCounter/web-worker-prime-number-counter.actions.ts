import { Action } from '@ngrx/store';

export const WebWorkerPrimeNumberCounterActions = {
  CALL_WEB_WORKER_CALCULATE: 'CALL_WEB_WORKER_CALCULATE'
};

export class CallWebWorkerCalculate implements Action {
  type = WebWorkerPrimeNumberCounterActions.CALL_WEB_WORKER_CALCULATE;
  constructor( public payload: number ) { }
}

export type WebWorkerPrimeNumberCounterTypes =
| CallWebWorkerCalculate ;
