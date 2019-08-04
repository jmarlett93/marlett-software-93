import {Component, ViewChild} from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.less']
})
export class AppComponent {
  title = 'marlett-app';
  @ViewChild('aboutSection', {static: false}) aboutSection;

  handlePageDownClick() {
    this.aboutSection.nativeElement.scrollIntoView({ behavior: 'smooth' });
  }
}
