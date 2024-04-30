import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { StoreModule } from "@ngrx/store";
import { SimulationsRoutingModule } from "./simulations-routing.module";
import { SimulationsComponent } from "./simulations.component";
import { FormsModule } from "@angular/forms";
import {
  simulationsUiReducer,
  initialSimulationUiState,
} from "./reducers/simulations-ui.reducer";

@NgModule({
  declarations: [SimulationsComponent],
  imports: [
    CommonModule,
    SimulationsRoutingModule,
    FormsModule,
    StoreModule.forFeature("simulationsUiState", simulationsUiReducer),
  ],
})
export class SimulationsModule {}
