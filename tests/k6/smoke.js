import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 2,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://opencode:4096';

export default function () {
  const response = http.get(baseUrl);

  check(response, {
    'Homepage returns 200': (r) => r.status === 200,
  });

  sleep(1);
}

