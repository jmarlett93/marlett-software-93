import {Component, OnInit, ViewChild} from '@angular/core';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.less']
})
export class HomeComponent implements OnInit {
  @ViewChild('aboutSection', {static: false}) aboutSection;

  constructor() { }

  ngOnInit() {
  }

  handlePageDownClick() {
    this.aboutSection.nativeElement.scrollIntoView({ behavior: 'smooth' });
  }

}
