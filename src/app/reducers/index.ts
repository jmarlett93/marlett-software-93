import {
  ActionReducer,
  ActionReducerMap,
  createFeatureSelector,
  createSelector,
  MetaReducer
} from '@ngrx/store';
import { environment } from '../../environments/environment';
import * as fromSimulationsUi from '../simulations/reducers/simulations-ui.reducer';

export interface State {
simulationsUiState: fromSimulationsUi.SimulationUiState;
}

export const reducers: ActionReducerMap<State> = {
simulationsUiState: fromSimulationsUi.simulationsUiReducer
};

export const metaReducers: MetaReducer<State>[] = !environment.production ? [] : [];
