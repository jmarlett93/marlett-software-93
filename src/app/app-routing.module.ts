import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';

const routes: Routes = [
  { path: 'home', component: HomeComponent },
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  {
    path: 'simulations',
    loadChildren: () =>
      import('./simulations/simulations.module').then(
        (m) => m.SimulationsModule,
      ),
  },
  {
    path: 'games',
    loadComponent: () =>
      import('./components/games/games.component').then(
        (x) => x.GameShellComponent,
      ),
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
