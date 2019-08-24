import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AngularFontAwesomeModule } from 'angular-font-awesome';

import { SimulationsRoutingModule } from './simulations-routing.module';
import { SimulationsComponent } from './simulations.component';


@NgModule({
  declarations: [SimulationsComponent],
  imports: [
    CommonModule,
    SimulationsRoutingModule,
    AngularFontAwesomeModule
  ]
})
export class SimulationsModule { }
