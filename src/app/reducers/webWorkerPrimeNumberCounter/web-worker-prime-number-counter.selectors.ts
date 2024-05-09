import { ApplicationState } from '../../app.state';

export const selectWebWorkerPrimeNumberCounterState = (
  state: ApplicationState,
) => state.webWorkerPrimeNumberCounterState;
