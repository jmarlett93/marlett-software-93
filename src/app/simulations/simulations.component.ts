import { Component, OnInit } from '@angular/core';
import { range } from 'lodash';

@Component({
  selector: 'app-simulations',
  templateUrl: './simulations.component.html',
  styleUrls: ['./simulations.component.less']
})
export class SimulationsComponent implements OnInit {

  constructor() {
  }

  ngOnInit() {
    console.log(range(10));
    const start = Date.now();
    // this.randomNumberGenerate();
    const end = Date.now() - start;
    console.log(end);
    console.log(Math.floor(end  / 1000));
  }


  randomNumberGenerate() {

    const numberLimit = 10000;
    let count = 0;
    const array = range(900000);
    array.forEach((item, index) => {
      this.isPrime(item) ? count += 1 : null;
    });
  }

  isPrime(num) {
    if (num < 2) {
      return false;
    }
    for (let i = 2; i < num / 2; i++) {
      if (num % i === 0) {
        return false;
      }
    }
    return true;
  }

}
