import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-hero-section',
  standalone: true,
  templateUrl: './hero-section.component.html',
  styleUrls: ['./hero-section.component.less'],
})
export class HeroSectionComponent {
  @Output() pageDownClick = new EventEmitter<void>();

  constructor() {}

  handlePageDownButtonClicked() {
    this.pageDownClick.emit();
  }
}
