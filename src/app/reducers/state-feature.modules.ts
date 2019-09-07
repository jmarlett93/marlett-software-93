import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';

import * as fromWebWorkerPrimeNumber from './webWorkerPrimeNumberCounter/web-worker-prime-number-counter.reducer';
import { WebWorkerPrimeNumberCounterEffects } from './webWorkerPrimeNumberCounter/web-worker-prime-number-counter.effects';
@NgModule({
  declarations: [],
  imports: [
    StoreModule.forFeature('webWorkerPrimeNumberCounterState',
      fromWebWorkerPrimeNumber.reducer),
    EffectsModule.forFeature([WebWorkerPrimeNumberCounterEffects])
  ],
  providers: [WebWorkerPrimeNumberCounterEffects],
})
export class WebWorkerPrimeNumberCounterStateModule {}

