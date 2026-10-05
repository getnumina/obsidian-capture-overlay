const test = require('node:test');
const assert = require('node:assert/strict');

test('summarise groups by variant, arrangement and action', async () => {
  const { median, summarise } = await import('../tools/latency.mjs');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const row = (shown, action = 'show') => ({ at: 'x', build: 'b', variant: 'baseline', arrangement: 'desk', action, shown, typing: true });
  const [show, hide] = summarise([row(10), row(30), row(20), row(40), row(5, 'hide')]);
  assert.equal(show.key, 'baseline | desk | show');
  assert.equal(show.samples, 4);
  assert.equal(show.typing, 4);
  // even samples 10 and 20, odd samples 30 and 40
  assert.deepEqual(show.marks, [{ name: 'shown', n: 4, median: 25, worst: 40, noise: 20 }]);
  assert.equal(hide.samples, 1);
});
