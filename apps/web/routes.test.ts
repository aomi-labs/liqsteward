import assert from 'node:assert/strict';
import test from 'node:test';
import { viewForLocation } from './src/routes';

test('public landing remains the default', () => {
  assert.equal(viewForLocation('/'), 'landing');
});
test('application routes survive direct loads and refresh', () => {
  assert.equal(viewForLocation('/app'), 'nav');
  assert.equal(viewForLocation('/app/nav-oracle'), 'nav');
  assert.equal(viewForLocation('/app/nav-oracle/'), 'nav');
  assert.equal(viewForLocation('/app/replay'), 'replay');
});
test('old demo URL opens the NAV application', () => {
  assert.equal(viewForLocation('/', '?demo=1'), 'nav');
  assert.equal(viewForLocation('/app/replay', '?demo=1'), 'replay');
});
