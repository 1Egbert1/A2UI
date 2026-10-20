# layoutopt:v1 candidate=direction-root-right generated-wrappers=
classes: {
  zone_1: {
    style: {
      fill: "#F0F5FA"
      stroke: "#4185BF"
      font-color: "#333333"
      border-radius: 8
    }
  }
  zone_2: {
    style: {
      fill: "#F2F7FB"
      stroke: "#4185BF"
      font-color: "#333333"
      border-radius: 8
    }
  }
  zone_3: {
    style: {
      fill: "#F6F9FC"
      stroke: "#4185BF"
      font-color: "#333333"
      border-radius: 8
    }
  }
  zone_4: {
    style: {
      fill: "#F9FBFD"
      stroke: "#4185BF"
      font-color: "#333333"
      border-radius: 8
    }
  }
  zone_5: {
    style: {
      fill: "#FCFDFE"
      stroke: "#4185BF"
      font-color: "#333333"
      border-radius: 8
    }
  }
  entity: {
    style: {
      fill: "#FFFFFF"
      stroke: "#E8ECF5"
      font-color: "#333333"
      border-radius: 6
      shadow: true
    }
  }
  signal: {
    style: {
      fill: transparent
      font-color: "#6B7280"
    }
  }
}

vars: {
  cw-layout: {
    version: 1
    anchors: {
      protocol_jsonl: {target: "protocol_jsonl"; x: 0.08; y: 0.52}
      parser: {target: "parser"; x: 0.24; y: 0.52}
      store: {target: "store"; x: 0.40; y: 0.52}
      hydrate: {target: "hydrate"; x: 0.56; y: 0.52}
      treebuilder: {target: "treebuilder"; x: 0.72; y: 0.52}
      tree_render: {target: "tree_render"; x: 0.88; y: 0.52}
      renderer: {target: "renderer"; x: 0.48; y: 0.16}
      binding: {target: "binding"; x: 0.68; y: 0.16}
      scheduler: {target: "scheduler"; x: 0.68; y: 0.86}
      action: {target: "action"; x: 0.32; y: 0.86}
    }
  }
}

protocol_jsonl: {
  label: "协议消息 JSONL\n输入原始数据"
  class: entity
}

parser: {
  label: "parser\n逐行框定协议"
  class: entity
}

store: {
  label: "store\n组件表 / 数据模型 / 错误"
  class: entity
}

hydrate: {
  label: "hydrate\n核心：逐个生成 vnode"
  class: entity
}

treebuilder: {
  label: "treebuilder\n按 children 建树"
  class: entity
}

tree_render: {
  label: "tree-render\n整树交宿主挂载"
  class: entity
}

renderer: {
  label: "renderer\n组件类型 → 渲染函数"
  class: entity
}

binding: {
  label: "binding\nliteralString / path 取值"
  class: entity
}

scheduler: {
  label: "scheduler\n合帧刷新，每帧一次"
  class: entity
}

action: {
  label: "action\n客户端本地动作"
  class: entity
}

protocol_jsonl -> parser: "JSONL 一行"
parser -> store: "解析结果落库"
store -> hydrate: "取节点水合"
hydrate -> treebuilder: "vnode 进入建树"
treebuilder -> tree_render: "整树挂载"
renderer -> hydrate: "提供渲染函数"
binding -> hydrate: "提供取值来源"
scheduler -> hydrate: {
  label: "合帧后触发重算"
  style: {
    stroke-dash: 4
  }
}
action -> store: {
  label: "本地动作写回数据模型"
  style: {
    stroke-dash: 4
  }
}
# layoutopt:v1 local-options={"auto_grid":true,"target_width":1600,"target_height":900,"min_font_size":10,"max_candidates":8,"budget_ms":10000,"constraints":{"allow_chain_reflow":true}}
direction: right
