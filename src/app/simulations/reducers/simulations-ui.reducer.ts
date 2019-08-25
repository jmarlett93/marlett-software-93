import { SimulationUiActions, SimulationUiActionTypes } from './simulations-ui.actions';

export interface SimulationUiState {
  webWorkerPrimeCount: number;
}

export const initialSimulationUiState: SimulationUiState = {
  webWorkerPrimeCount : 0
};

export function simulationsUiReducer(
  state = initialSimulationUiState,
  action: SimulationUiActionTypes): SimulationUiState {
  switch (action.type) {
    case SimulationUiActions.SET_REMOTE_PRIME_COUNT: {
      return { webWorkerPrimeCount : action.payload, ...state };
    }
    default: {
      return state;
    }
  }
}
