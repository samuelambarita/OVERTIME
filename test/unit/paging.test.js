const test = require('node:test');
const assert = require('node:assert');
const { pageParams, PAGE_SIZE } = require('../../src/services/paging');

test('pageParams', () => {
  assert.strictEqual(PAGE_SIZE, 25);
  assert.strictEqual(pageParams('1.5').page, 1);
  assert.strictEqual(pageParams('1e30').page, 100000);
  assert.strictEqual(pageParams('abc').page, 1);
  assert.strictEqual(pageParams('0').page, 1);
  assert.strictEqual(pageParams(undefined).page, 1);
  assert.deepStrictEqual(pageParams(3), { page: 3, limit: 25, offset: 50 });
});
