import http from 'k6/http';

export const options = {
  // iterations: 10,
  vus: 20,
  duration: 10
};

export default function () {
  http.get('http://localhost:3005/v1/marketplace/listings');
}
