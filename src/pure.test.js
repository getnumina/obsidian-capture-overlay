const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAccelerator, nextAction, fitBounds, moveToArea } = require('./pure.js');

test('normalizeAccelerator normalises spelling and order', () => {
  assert.equal(normalizeAccelerator('cmd+shift+2'), 'Command+Shift+2');
  assert.equal(normalizeAccelerator(' Shift + Command + 2 '), 'Command+Shift+2');
  assert.equal(normalizeAccelerator('ctrl+alt+k'), 'Control+Alt+K');
  assert.equal(normalizeAccelerator('Command+Option+Space'), 'Command+Alt+Space');
  assert.equal(normalizeAccelerator('cmd+f5'), 'Command+F5');
});

test('normalizeAccelerator rejects chords macOS would not take', () => {
  assert.equal(normalizeAccelerator('Shift+2'), null);
  assert.equal(normalizeAccelerator('Alt+Shift+K'), null);
  assert.equal(normalizeAccelerator('Command+Shift'), null);
  assert.equal(normalizeAccelerator('Command+A+B'), null);
  assert.equal(normalizeAccelerator('Command+Command+A'), null);
  assert.equal(normalizeAccelerator('Command++A'), null);
  assert.equal(normalizeAccelerator(''), null);
  assert.equal(normalizeAccelerator(undefined), null);
});

test('nextAction follows the state table', () => {
  assert.equal(nextAction({ found: false }), 'create');
  assert.equal(nextAction({ found: true, visible: false, focused: false }), 'show');
  assert.equal(nextAction({ found: true, visible: true, focused: false }), 'focus');
  assert.equal(nextAction({ found: true, visible: true, focused: true }), 'hide');
});

const area = { x: 0, y: 25, width: 1440, height: 875 };
const size = { width: 420, height: 520 };

test('fitBounds places a new window top right', () => {
  assert.deepEqual(fitBounds(null, [area], size), { x: 996, y: 49, width: 420, height: 520 });
});

test('fitBounds keeps on-screen bounds', () => {
  const saved = { x: 100, y: 100, width: 400, height: 300 };
  assert.deepEqual(fitBounds(saved, [area], size), saved);
});

test('fitBounds recovers off-screen and oversize bounds', () => {
  assert.deepEqual(fitBounds({ x: 5000, y: 5000, width: 400, height: 300 }, [area], size),
    { x: 996, y: 49, width: 420, height: 520 });
  const big = fitBounds({ x: 0, y: 25, width: 4000, height: 4000 }, [area], size);
  assert.equal(big.width, 1440);
  assert.equal(big.height, 875);
  assert.deepEqual(fitBounds({ x: 'a' }, [area], size), { x: 996, y: 49, width: 420, height: 520 });
  assert.deepEqual(fitBounds(null, [], size), { x: 0, y: 0, width: 420, height: 520 });
});

test('moveToArea carries the window to another display', () => {
  const second = { x: 1440, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(moveToArea({ x: 996, y: 49, width: 420, height: 520 }, area, second),
    { x: 2436, y: 24, width: 420, height: 520 });
  const small = { x: -800, y: 0, width: 800, height: 600 };
  assert.deepEqual(moveToArea({ x: 996, y: 49, width: 420, height: 700 }, area, small),
    { x: -420, y: 0, width: 420, height: 600 });
});
