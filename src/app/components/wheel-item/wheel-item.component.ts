import { Component, OnInit, Input } from '@angular/core';

@Component({
  selector: 'app-wheel-item',
  templateUrl: './wheel-item.component.html',
  styleUrls: ['./wheel-item.component.less']
})
export class WheelItemComponent implements OnInit {
  @Input('wheel-item')wheelItem: any;
  constructor() { }

  ngOnInit() {
  }

}
