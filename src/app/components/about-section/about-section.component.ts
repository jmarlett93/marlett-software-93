import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faConnectdevelop,
  faGithub,
  faLinkedin,
} from '@fortawesome/free-brands-svg-icons';
import { faFire, faWifiStrong } from '@fortawesome/free-solid-svg-icons';
import { WheelItemComponent } from '../wheel-item/wheel-item.component';
@Component({
  selector: 'app-about-section',
  standalone: true,
  imports: [FontAwesomeModule, WheelItemComponent, CommonModule],
  templateUrl: './about-section.component.html',
  styleUrls: ['./about-section.component.less'],
})
export class AboutSectionComponent implements OnInit {
  @ViewChild('linkWheel') linkWheel: ElementRef;
  constructor() {}
  fasLinkedIn = faLinkedin;

  linkElements = [
    {
      icon: faGithub,
      href: 'https://github.com/jmarlett93',
      text: 'GitHub Profile',
    },
    {
      icon: faLinkedin,
      href: 'https://www.linkedin.com/in/johnmarlett93/',
      text: 'LinkedIn Profile',
    },
    {
      icon: faFire,
      href: 'http://torchystacos.com',
      text: 'Torchys Tacos; Austin, TX',
    },
    {
      icon: faConnectdevelop,
      href: 'https://www.youtube.com/watch?v=bo36MrBfTk4',
      text: 'Douglas Crockford Lecture',
    },
    {
      icon: faWifiStrong,
      href: 'https://www.youtube.com/watch?v=W8_Kfjo3VjU',
      text: 'Eponymous Website is Down Sketch',
    },
  ];

  ngOnInit() {}

  positionTop(radius, index, arrayLength) {
    return (
      String(
        radius +
          -radius * Math.cos((360 / arrayLength / 180) * index * Math.PI) -
          20,
      ) + 'px'
    );
  }

  positionLeft(radius, index, arrayLength) {
    // NOTE: the the -20 is an offset, based on the radius of the child element with the font awesome links
    return (
      String(
        radius +
          radius * Math.sin((360 / arrayLength / 180) * index * Math.PI) -
          20,
      ) + 'px'
    );
  }
}
