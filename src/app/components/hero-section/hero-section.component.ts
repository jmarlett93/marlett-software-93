import { Component, OnInit, Output, EventEmitter  } from '@angular/core';

@Component({
  selector: 'app-hero-section',
  templateUrl: './hero-section.component.html',
  styleUrls: ['./hero-section.component.less']
})
export class HeroSectionComponent implements OnInit {

  @Output()onPageDownClick = new EventEmitter<any>();

  constructor() { }

  ngOnInit() {
  }

  handlePageDownButtonClicked() {
    this.onPageDownClick.emit();
  }
}
