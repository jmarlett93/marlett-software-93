/// <reference lib="webworker" />
import {range} from 'lodash';

addEventListener('message', ({data}) => {
  const response = `worker response to ${data}`;

  const numberLimit = 10000;
  let count = 0;
  const array = range(500000);
  array.forEach((item, index) => {
    this.isPrime(item) ? count += 1 : null;
  });

  postMessage(count);
});
