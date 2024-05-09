import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export interface LinkWheelInput {
  icon: IconDefinition;
  href: string;
  text: string;
}
@Component({
  selector: 'app-wheel-item',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './wheel-item.component.html',
  styleUrls: ['./wheel-item.component.less'],
})
export class WheelItemComponent {
  @Input() wheelItem: LinkWheelInput;
  constructor() {}
}
