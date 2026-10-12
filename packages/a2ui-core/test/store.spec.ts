import { strict as assert } from 'assert';
import {
  init,
  initStore,
  resetA2UIStore,
  getA2UIStore,
  getAllSurfaces,
  getAllHydrateNodes,
  getAllDataModels,
  getAllErrors,
  getAllTrees,
} from '../src/store';

describe('A2UI Store', () => {
  beforeEach(() => {
    resetA2UIStore();
  });

  describe('init', () => {
    it('should create a store instance when none exists', () => {
      resetA2UIStore();
      const instance = init();
      assert.ok(instance, 'init should return a store instance');
      assert.equal(instance, getA2UIStore(), 'init should use the singleton store');
    });

    it('should initialize empty maps', () => {
      init();
      assert.deepEqual(getAllSurfaces(), {}, 'surfaceMap should be empty');
      assert.deepEqual(getAllHydrateNodes(), {}, 'hydrateNodeMap should be empty');
      assert.deepEqual(getAllDataModels(), {}, 'dataModelMap should be empty');
      assert.deepEqual(getAllTrees(), {}, 'treeMap should be empty');
      assert.deepEqual(getAllErrors(), {}, 'errorMap should be empty');
    });

    it('should return the existing store on subsequent calls', () => {
      const first = init();
      const second = init();
      assert.equal(first, second, 'init should return the same singleton instance');
    });

    it('should keep previously added data after init', () => {
      const store = init();
      store.setState({
        surfaceMap: {
          s1: {
            surfaceId: 's1',
            beginRender: true,
            rootNode: {
              componentId: 'c1',
              _vnode: null,
              ownerSurfaceId: 's1',
              protocol: '{}',
            },
          },
        },
      });

      init();

      assert.equal(getAllSurfaces().s1.surfaceId, 's1', 'surface data should be preserved');
    });

    it('should expose initStore as an alias of init', () => {
      assert.equal(initStore, init, 'initStore should be an alias of init');
    });
  });
});
