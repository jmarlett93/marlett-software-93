import { Component, ViewChild } from '@angular/core';
import { AboutSectionComponent } from '../about-section/about-section.component';
import { HeroSectionComponent } from '../hero-section/hero-section.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AboutSectionComponent, HeroSectionComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.less'],
})
export class HomeComponent {
  @ViewChild('aboutSection') aboutSection;

  constructor() {}

  handlePageDownClick() {
    this.aboutSection.nativeElement.scrollIntoView({ behavior: 'smooth' });
  }
}
