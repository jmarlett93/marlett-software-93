import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';

@Component({
  selector: 'app-about-section',
  templateUrl: './about-section.component.html',
  styleUrls: ['./about-section.component.less']
})
export class AboutSectionComponent implements OnInit {

  @ViewChild('linkWheel', {static: false})linkWheel: ElementRef;
  constructor() { }

  linkElements = [
    {icon: 'github', href: 'https://github.com/jmarlett93', text: 'GitHub Profile'},
    {icon: 'linkedin', href: 'https://www.linkedin.com/in/johnmarlett93/', text: 'LinkedIn Profile'},
    {icon: 'fire', href: 'http://torchystacos.com', text: 'Torchys Tacos; Austin, TX'},
    {icon: 'connectdevelop', href: 'https://www.youtube.com/watch?v=bo36MrBfTk4', text: 'Douglas Crockford Lecture'},
    {icon: 'wifi', href: 'https://www.youtube.com/watch?v=W8_Kfjo3VjU', text: 'Eponymous Website is Down Sketch'}
  ];

  ngOnInit() {
  }

  positionTop(radius, index, arrayLength) {
   return String((radius + -radius * Math.cos((360 / arrayLength/ 180) * index * Math.PI)) - 20 ) + 'px';
  }

  positionLeft(radius, index, arrayLength){
    console.log(radius);
    // NOTE: the the -15 is an offset, based on the radius of the child element with the font awesome links
    return String( (radius + radius * Math.sin((360 / arrayLength / 180) * index * Math.PI)) - 20) + 'px';
  }

}
