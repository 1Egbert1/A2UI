import { strict as assert } from 'assert';

import {
  readBoolean,
  readNumber,
  readPath,
  readString,
  readStringArray,
} from '../src/binding';

/** 构造一个「读数据模型」的函数，模拟渲染上下文里的 context.read。 */
const readerOf = (dataModel: Record<string, unknown>) => (path: string) =>
  readPath(dataModel, path);

describe('A2UI Binding', () => {
  describe('readPath', () => {
    it('should resolve a path with a leading slash', () => {
      assert.equal(readPath({ name: 'Bob' }, '/name'), 'Bob');
    });

    it('should resolve a path without a leading slash', () => {
      assert.equal(readPath({ name: 'Bob' }, 'name'), 'Bob');
    });

    it('should resolve nested paths', () => {
      const dataModel = { user: { address: { city: 'Anytown' } } };

      assert.equal(readPath(dataModel, '/user/address/city'), 'Anytown');
    });

    it('should return undefined for a missing segment', () => {
      assert.equal(readPath({ user: {} }, '/user/name'), undefined);
      assert.equal(readPath({}, '/anything'), undefined);
    });

    it('should stop instead of throwing when descending through a primitive', () => {
      assert.equal(readPath({ user: 'Bob' }, '/user/name'), undefined);
    });

    it('should return the whole data model for an empty path', () => {
      const dataModel = { a: 1 };

      assert.equal(readPath(dataModel, ''), dataModel);
    });
  });

  describe('readString', () => {
    it('should prefer literalString', () => {
      assert.equal(readString({ literalString: 'Hi' }, () => 'ignored'), 'Hi');
    });

    it('should fall back to the path value', () => {
      const read = readerOf({ title: 'Hello' });

      assert.equal(readString({ path: '/title' }, read), 'Hello');
    });

    it('should stringify a numeric path value', () => {
      const read = readerOf({ count: 3 });

      assert.equal(readString({ path: '/count' }, read), '3');
    });

    it('should return the fallback when the path is unset', () => {
      assert.equal(readString({ path: '/missing' }, readerOf({}), 'N/A'), 'N/A');
    });

    it('should accept a bare string', () => {
      assert.equal(readString('Hi', () => ''), 'Hi');
    });

    it('should fall back for non-object input', () => {
      assert.equal(readString(undefined, () => '', 'fallback'), 'fallback');
      assert.equal(readString(42, () => '', 'fallback'), 'fallback');
    });
  });

  describe('readNumber', () => {
    it('should prefer literalNumber', () => {
      assert.equal(readNumber({ literalNumber: 5 }, () => 0), 5);
    });

    it('should accept a numeric string from the data model', () => {
      assert.equal(readNumber({ path: '/cost' }, readerOf({ cost: '12.5' })), 12.5);
    });

    it('should fall back when the path value is not numeric', () => {
      assert.equal(readNumber({ path: '/cost' }, readerOf({ cost: 'free' }), -1), -1);
    });
  });

  describe('readBoolean', () => {
    it('should prefer literalBoolean', () => {
      assert.equal(readBoolean({ literalBoolean: true }, () => false), true);
    });

    it('should accept a boolean from the data model', () => {
      assert.equal(readBoolean({ path: '/open' }, readerOf({ open: true })), true);
    });

    it('should accept the strings "true" and "false"', () => {
      const read = readerOf({ open: 'false', closed: 'true' });

      assert.equal(readBoolean({ path: '/open' }, read), false);
      assert.equal(readBoolean({ path: '/closed' }, read), true);
    });

    it('should fall back when the path is unset', () => {
      assert.equal(readBoolean({ path: '/missing' }, readerOf({})), false);
    });
  });

  describe('readStringArray', () => {
    it('should return literalArray', () => {
      assert.deepEqual(readStringArray({ literalArray: ['a', 'b'] }, () => []), ['a', 'b']);
    });

    it('should return the array found at path', () => {
      assert.deepEqual(readStringArray({ path: '/tags' }, readerOf({ tags: ['x'] })), ['x']);
    });

    it('should stringify non-string elements', () => {
      assert.deepEqual(readStringArray({ literalArray: [1, true] }, () => []), ['1', 'true']);
    });

    it('should fall back when the value is not an array', () => {
      assert.deepEqual(readStringArray({ path: '/tags' }, readerOf({ tags: 'x' })), []);
      assert.deepEqual(readStringArray(undefined, () => []), []);
    });
  });
});
