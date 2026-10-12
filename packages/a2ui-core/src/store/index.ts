import { createStore } from 'zustand/vanilla';
import { setRenderMap, type RenderMap } from '../renderer';
import type { ComponentTree, TreeMap } from '../treebuilder/types';
import type { A2uiStore, A2UIError, HydrateNode, Surface } from './types';

export * from './types';

export interface A2UIStoreState extends A2uiStore {
  errorMap: Record<string, A2UIError>;
  /** 每个 surface 各自一份数据模型，键为 surfaceId（协议 1.3：surface 拥有独立 data model）。 */
  dataModelMap: Record<string, Record<string, unknown>>;
  /** 每个 surface 各自的组件树，键为 surfaceId；由 parser 在整段 JSONL 解析完后重建。 */
  treeMap: TreeMap;
}

const createA2UIStore = () =>
  createStore<A2UIStoreState>(() => ({
    surfaceMap: {},
    hydrateNodeMap: {},
    errorMap: {},
    dataModelMap: {},
    treeMap: {},
  }));

export type A2UIStoreInstance = ReturnType<typeof createA2UIStore>;

let store: ReturnType<typeof createA2UIStore> | undefined;

/**
 * 初始化全局单例 store，并注入组件渲染表。
 *
 * renderMap 由渲染引擎提供（如 a2ui-vue 的 renderMap）。它是配置而非状态，
 * 因此不放进 store state，也不受 clearStore 影响；重复调用 init 会用新表整体替换。
 */
export const init = (renderMap?: RenderMap) => {
  if (renderMap) {
    setRenderMap(renderMap);
  }
  if (!store) {
    store = createA2UIStore();
  }
  return store;
};

export const initStore = init;

export const getA2UIStore = () => init();

export const resetA2UIStore = () => {
  store = createA2UIStore();
  return store;
};

// Surface CRUD
export const addSurface = (surface: Surface) => {
  getA2UIStore().setState((state) => ({
    surfaceMap: { ...state.surfaceMap, [surface.surfaceId]: surface },
  }));
};

export const updateSurface = (surfaceId: string, patch: Partial<Surface>) => {
  getA2UIStore().setState((state) => {
    const current = state.surfaceMap[surfaceId];
    if (!current) return state;
    return {
      surfaceMap: {
        ...state.surfaceMap,
        [surfaceId]: { ...current, ...patch },
      },
    };
  });
};

export const removeSurface = (surfaceId: string) => {
  getA2UIStore().setState((state) => {
    const surfaceMap = { ...state.surfaceMap };
    delete surfaceMap[surfaceId];
    return { surfaceMap };
  });
};

export const getSurface = (surfaceId: string): Surface | undefined => {
  return getA2UIStore().getState().surfaceMap[surfaceId];
};

export const getAllSurfaces = (): Record<string, Surface> => {
  return getA2UIStore().getState().surfaceMap;
};

export const clearSurfaces = () => {
  getA2UIStore().setState({ surfaceMap: {} });
};

/**
 * 删除 surface，并级联清理归属于它的 hydrateNode 与 dataModel。
 *
 * hydrateNodeMap 是跨 surface 的全局扁平结构（key 为 componentId），
 * 无法从 key 推断归属，只能按每个节点的 ownerSurfaceId 反向过滤。
 * 三张表在一次 setState 内原子更新，避免订阅者观察到中间态。
 *
 * 注意：errorMap 不参与级联——A2UIError 目前不携带 surfaceId，无法归属。
 */
export const removeSurfaceCascade = (surfaceId: string) => {
  getA2UIStore().setState((state) => {
    const surfaceMap = { ...state.surfaceMap };
    const hydrateNodeMap = { ...state.hydrateNodeMap };
    const dataModelMap = { ...state.dataModelMap };
    const treeMap = { ...state.treeMap };

    delete surfaceMap[surfaceId];
    delete dataModelMap[surfaceId];
    // treeMap 完全派生于 surfaceMap，surface 没了树也就没有意义。
    delete treeMap[surfaceId];

    for (const [componentId, node] of Object.entries(hydrateNodeMap)) {
      if (node.ownerSurfaceId === surfaceId) {
        delete hydrateNodeMap[componentId];
      }
    }

    return { surfaceMap, hydrateNodeMap, dataModelMap, treeMap };
  });
};

// HydrateNode CRUD
export const addHydrateNode = (node: HydrateNode) => {
  getA2UIStore().setState((state) => ({
    hydrateNodeMap: { ...state.hydrateNodeMap, [node.componentId]: node },
  }));
};

export const updateHydrateNode = (componentId: string, patch: Partial<HydrateNode>) => {
  getA2UIStore().setState((state) => {
    const current = state.hydrateNodeMap[componentId];
    if (!current) return state;
    return {
      hydrateNodeMap: {
        ...state.hydrateNodeMap,
        [componentId]: { ...current, ...patch },
      },
    };
  });
};

export const removeHydrateNode = (componentId: string) => {
  getA2UIStore().setState((state) => {
    const hydrateNodeMap = { ...state.hydrateNodeMap };
    delete hydrateNodeMap[componentId];
    return { hydrateNodeMap };
  });
};

export const getHydrateNode = (componentId: string): HydrateNode | undefined => {
  return getA2UIStore().getState().hydrateNodeMap[componentId];
};

export const getAllHydrateNodes = (): Record<string, HydrateNode> => {
  return getA2UIStore().getState().hydrateNodeMap;
};

export const clearHydrateNodes = () => {
  getA2UIStore().setState({ hydrateNodeMap: {} });
};

// Data Model CRUD（按 surfaceId 维度）
export const setDataModel = (surfaceId: string, dataModel: Record<string, unknown>) => {
  getA2UIStore().setState((state) => ({
    dataModelMap: { ...state.dataModelMap, [surfaceId]: dataModel },
  }));
};

export const updateDataModel = (surfaceId: string, patch: Record<string, unknown>) => {
  getA2UIStore().setState((state) => ({
    dataModelMap: {
      ...state.dataModelMap,
      [surfaceId]: { ...(state.dataModelMap[surfaceId] ?? {}), ...patch },
    },
  }));
};

export const removeDataModel = (surfaceId: string) => {
  getA2UIStore().setState((state) => {
    const dataModelMap = { ...state.dataModelMap };
    delete dataModelMap[surfaceId];
    return { dataModelMap };
  });
};

export const getDataModel = (surfaceId: string): Record<string, unknown> | undefined => {
  return getA2UIStore().getState().dataModelMap[surfaceId];
};

export const getAllDataModels = (): Record<string, Record<string, unknown>> => {
  return getA2UIStore().getState().dataModelMap;
};

export const clearDataModels = () => {
  getA2UIStore().setState({ dataModelMap: {} });
};

// 组件树 CRUD（按 surfaceId 维度）

/**
 * 整体替换组件树。
 *
 * parser 每解析完一整段 JSONL 就调一次：treeMap 是 surfaceMap 的派生结果，
 * 全量重建比增量维护简单且不会出现脏数据。
 */
export const setTrees = (trees: TreeMap) => {
  getA2UIStore().setState({ treeMap: trees });
};

export const setTree = (tree: ComponentTree) => {
  getA2UIStore().setState((state) => ({
    treeMap: { ...state.treeMap, [tree.surfaceId]: tree },
  }));
};

export const removeTree = (surfaceId: string) => {
  getA2UIStore().setState((state) => {
    const treeMap = { ...state.treeMap };
    delete treeMap[surfaceId];
    return { treeMap };
  });
};

export const getTree = (surfaceId: string): ComponentTree | undefined => {
  return getA2UIStore().getState().treeMap[surfaceId];
};

export const getAllTrees = (): TreeMap => {
  return getA2UIStore().getState().treeMap;
};

export const clearTrees = () => {
  getA2UIStore().setState({ treeMap: {} });
};

// Error CRUD
export const addError = (errorId: string, error: A2UIError) => {
  getA2UIStore().setState((state) => ({
    errorMap: { ...state.errorMap, [errorId]: error },
  }));
};

export const updateError = (errorId: string, patch: Partial<A2UIError>) => {
  getA2UIStore().setState((state) => {
    const current = state.errorMap[errorId];
    if (!current) return state;
    return {
      errorMap: {
        ...state.errorMap,
        [errorId]: { ...current, ...patch },
      },
    };
  });
};

export const removeError = (errorId: string) => {
  getA2UIStore().setState((state) => {
    const errorMap = { ...state.errorMap };
    delete errorMap[errorId];
    return { errorMap };
  });
};

export const getError = (errorId: string): A2UIError | undefined => {
  return getA2UIStore().getState().errorMap[errorId];
};

export const getAllErrors = (): Record<string, A2UIError> => {
  return getA2UIStore().getState().errorMap;
};

export const clearErrors = () => {
  getA2UIStore().setState({ errorMap: {} });
};

export const clearStore = () => {
  getA2UIStore().setState({
    surfaceMap: {},
    hydrateNodeMap: {},
    dataModelMap: {},
    treeMap: {},
    errorMap: {},
  });
};
