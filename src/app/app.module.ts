import { BrowserModule } from "@angular/platform-browser";
import { NgModule } from "@angular/core";

import { AppRoutingModule } from "./app-routing.module";
import { AppComponent } from "./app.component";
import { HeaderComponent } from "./components/header/header.component";
import { HeroSectionComponent } from "./components/hero-section/hero-section.component";
import { AboutSectionComponent } from "./components/about-section/about-section.component";
import { GutterComponent } from "./components/gutter/gutter.component";
import { WheelItemComponent } from "./components/wheel-item/wheel-item.component";
import { StoreModule } from "@ngrx/store";
import { EffectsModule } from "@ngrx/effects";
import { reducers, metaReducers } from "./reducers";
import { StoreDevtoolsModule } from "@ngrx/store-devtools";
import { environment } from "../environments/environment";
import { HomeComponent } from "./components/home/home.component";
import { SimulationsModule } from "./simulations/simulations.module";
import { WebWorkerPrimeNumberCounterStateModule } from "./reducers/state-feature.modules";
import { ServiceWorkerModule } from "@angular/service-worker";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";

@NgModule({
  declarations: [
    AppComponent,
    HeaderComponent,
    HeroSectionComponent,
    AboutSectionComponent,
    GutterComponent,
    WheelItemComponent,
    HomeComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    SimulationsModule,
    WebWorkerPrimeNumberCounterStateModule,
    StoreModule.forRoot(reducers, {
      metaReducers,
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,
      },
    }),
    EffectsModule.forRoot([]),
    StoreDevtoolsModule.instrument({
      maxAge: 25,
      logOnly: environment.production,
    }),
    ServiceWorkerModule.register("ngsw-worker.js", {
      enabled: environment.production,
    }),
    StoreModule.forRoot({}, {}),
    FontAwesomeModule,
  ],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
