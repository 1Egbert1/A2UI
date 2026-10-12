Store 设计（Zustand 模式）
职责：
1. 统一管理组件定义（componentMap）
2. 统一管理渲染后的VNode实例（hydrateNodeMap）
3. 维护组件之间的关系（父子引用）
4. Error信息


store接口定义

interface A2uiStore { 
    surfaceMap: <record, Surface>
    HydrateNodeMap: <record, HydrateNode>
}

interface Surface {
    surfaceId: String,
    beginrender: Bool,
    rootNode: HyrateNode，
}

interface HydrateNode {
    componentId: string,
    _vnode: ReactElement,
    ownerSurfaceId: string,
    protocal: string (JSONL协议)
}

enum ErrorType = {
    PARE_ERROR,
}

interface Error {
    type: ErrorType,
    content: string
}


更新、删除、查找、添加（by Id纬度）



store里面还有对surfaceMap，hydrateNodeMap，ErrorMap的增删改查操作

为了解除对vue依赖，store通过 Zustand/vanilla 实现状态管理

store 是一个全局单例，需要导出一个方法，用于获取store实例。

