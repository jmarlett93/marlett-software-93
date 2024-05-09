import { createAction, props } from '@ngrx/store';

export const WebWorkerPrimeNumberCounterActions = {
  CALL_WEB_WORKER_CALCULATE: 'CALL_WEB_WORKER_CALCULATE',
  SET_WEB_WORKER_COUNT: 'SET_WEB_WORKER_COUNT',
  TOGGLE_IS_CALCULATING: 'TOGGLE_IS_CALCULATING',
};

export const CallWebWorkerCalculate = createAction(
  WebWorkerPrimeNumberCounterActions.CALL_WEB_WORKER_CALCULATE,
  props<{ numberLimit: number }>(),
);

export const SetWebWorkerCount = createAction(
  WebWorkerPrimeNumberCounterActions.SET_WEB_WORKER_COUNT,
  props<{ count: number }>(),
);

export const ToggleIsCalculating = createAction(
  WebWorkerPrimeNumberCounterActions.TOGGLE_IS_CALCULATING,
);
