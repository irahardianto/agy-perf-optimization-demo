import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createRequestHistory, redactHeaders } from '../src/platform/request-history.js';

describe('redactHeaders', () => {
  test('masks credentials and keeps everything else', () => {
    assert.deepEqual(
      redactHeaders({ 'x-api-key': 'fmk_web01.secret', 'x-internal-token': 't', authorization: 'Bearer x', cookie: 'a=b', 'user-agent': 'k6', accept: '*/*' }),
      { 'x-api-key': '[redacted]', 'x-internal-token': '[redacted]', authorization: '[redacted]', cookie: '[redacted]', 'user-agent': 'k6', accept: '*/*' },
    );
  });
});

describe('request history', () => {
  const entry = (n) => ({ id: `req-${n}`, method: 'GET', path: `/api/products/FM-00000${n}`, status: 200 });

  test('returns the most recent entries first', () => {
    const history = createRequestHistory();
    for (let n = 1; n <= 5; n += 1) history.record(entry(n));
    assert.deepEqual(history.recent(3).map((e) => e.id), ['req-5', 'req-4', 'req-3']);
    assert.equal(history.size(), 5);
  });

  test('returns everything when fewer entries than the limit exist', () => {
    const history = createRequestHistory();
    history.record(entry(1));
    history.record(entry(2));
    assert.deepEqual(history.recent(50).map((e) => e.id), ['req-2', 'req-1']);
  });

  test('starts empty', () => {
    const history = createRequestHistory();
    assert.deepEqual(history.recent(), []);
    assert.equal(history.size(), 0);
  });
});
