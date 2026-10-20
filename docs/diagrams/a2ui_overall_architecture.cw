# session_id: 4dc1a1e4-1208-46a3-9a87-466e5120c0e5
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

# layoutopt:v1 candidate=direction-server-right generated-wrappers=


user: {
  label: "用户"
  class: entity
}

web: {
  label: "web · a2ui-playground"
  class: zone_1

  dialog: {
    label: "对话 + 示例场景下拉"
    class: entity
  }

  stream: {
    label: "Stream 模拟"
    class: entity
  }

  preview: {
    label: "渲染预览"
    class: entity
  }
}

server: {
  label: "server · a2ui-playground-server"
  class: zone_1

  route: {
    label: "路由 /api/a2ui/run"
    class: entity
  }

  registry: {
    label: "场景注册表"
    class: entity
  }

  agent: {
    label: "agent"
    class: entity
  }

  session_cache: {
    label: "session 缓存"
    class: entity
  }
  direction: right
}

sdk: {
  label: "packages · A2UI SDK"
  class: zone_1

  core: {
    label: "a2ui-core"
    class: entity
  }

  vue: {
    label: "a2ui-vue"
    class: entity
  }
}

user -> web.dialog
user -> web.stream
web.dialog -> server.registry
web.dialog -> server.route
server.(route -> registry)
server.(route -> agent)
server.agent -> web.dialog: {
  style: {
    stroke-dash: 4
  }
}
server.(route -> session_cache)
web.dialog -> sdk.core
server.registry -> web.stream: {
  style: {
    stroke-dash: 4
  }
}
web.stream -> sdk.core
sdk.(core -> vue)
sdk.vue -> web.preview

vars: {
  cw-layout: {
    version: 1
    anchors: {
      user: {target: "user"; x: 0.06; y: 0.34}
      web: {target: "web"; x: 0.38; y: 0.34}
      server: {target: "server"; x: 0.78; y: 0.34}
      sdk: {target: "sdk"; x: 0.50; y: 0.86}
      dialog: {target: "web.dialog"; x: 0.50; y: 0.18}
      stream: {target: "web.stream"; x: 0.50; y: 0.50}
      preview: {target: "web.preview"; x: 0.50; y: 0.82}
      core: {target: "sdk.core"; x: 0.35; y: 0.50}
      vue: {target: "sdk.vue"; x: 0.65; y: 0.50}
    }
  }
}
# layoutopt:v1 local-options={"auto_grid":true,"target_width":1600,"target_height":900,"min_font_size":10,"max_candidates":8,"budget_ms":10000,"constraints":{"allow_chain_reflow":true}}