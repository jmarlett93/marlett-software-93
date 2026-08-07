import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
    title: 'John Marlett',
  },
  {
    path: 'lab',
    loadComponent: () => import('./pages/lab/lab').then((m) => m.Lab),
    title: 'Lab | John Marlett',
  },
  { path: 'workers', redirectTo: 'lab', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
