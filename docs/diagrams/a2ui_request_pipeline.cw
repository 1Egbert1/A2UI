# session_id: 7bc527dd33304b638456239cee4d5db6
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

post_run: {
  label: "POST /api/a2ui/run"
  class: entity
}

inbound: {
  label: "inbound\nRunAgentInput / message / scenario"
  class: entity
}

prepare: {
  label: "prepare()\n命中场景用 fixture.surfaceId\n非法入参：开流前 400"
  class: entity
}

query_stream: {
  label: "query.stream"
  shape: diamond
  class: entity
}

run_stream: {
  label: "runA2UIStream\nAG-UI 事件 → SSE 逐帧"
  class: entity
}

json_once: {
  label: "一次性 JSON\n同样内容一次返回"
  class: entity
}

agent_facade: {
  label: "agent 门面\nscenario→fixture，否则 provider"
  class: entity
}

commit: {
  label: "commit()\n写 history + 按 surface 累积\n不切换活跃 surface"
  class: entity
}

session_get: {
  label: "GET /api/a2ui/session/:threadId\n整段回放缓存会话"
  class: entity
}

note_shared: {
  label: "关键论证：单入口 · 分流只在最后一公里\nprepare()/commit() 两条路共用\n入参解析与缓存内容不因传输方式分叉"
  class: signal
}

post_run -> inbound
inbound -> prepare
prepare -> query_stream
query_stream -> run_stream: "缺省 / true"
query_stream -> json_once: "false / 0 / no / off / json"
run_stream -> agent_facade
json_once -> agent_facade
agent_facade -> commit
commit -> session_get

vars: {
  cw-layout: {
    version: 1
    anchors: {
      entry: {target: "post_run"; x: 0.25; y: 0.06}
      normalize: {target: "inbound"; x: 0.25; y: 0.18}
      prepare_step: {target: "prepare"; x: 0.25; y: 0.31}
      branch_point: {target: "query_stream"; x: 0.25; y: 0.45}
      stream_branch: {target: "run_stream"; x: 0.10; y: 0.58}
      json_branch: {target: "json_once"; x: 0.40; y: 0.58}
      merge_point: {target: "agent_facade"; x: 0.25; y: 0.71}
      persist_step: {target: "commit"; x: 0.25; y: 0.84}
      replay_api: {target: "session_get"; x: 0.25; y: 0.96}
      shared_note: {target: "note_shared"; x: 0.85; y: 0.35}
    }
  }
}
# layoutopt:v1 local-options={"auto_grid":true,"target_width":1600,"target_height":900,"min_font_size":10,"max_candidates":8,"budget_ms":10000,"constraints":{"allow_chain_reflow":true}}
