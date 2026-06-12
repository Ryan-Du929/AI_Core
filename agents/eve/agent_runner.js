// ═══════════════════════════════════════════════════════════
// agent_runner.js — Python 專家 Agent 非同步橋接層
//
// 設計原則：
//   - 100% 非同步 — execFile + Promise，零 Event Loop 阻塞
//   - Agent 路由表集中管理
//   - 暫存檔案寫入 + 非同步子行程（避免 inline 腳本跳脫）
//   - 內建 timeout 60s
//   - 自動清理暫存
// ═══════════════════════════════════════════════════════════

var fs = require("fs");
var path = require("path");
var { execFile } = require("child_process");

// ══════════════════════════════════════════════════════
// 設定
// ══════════════════════════════════════════════════════

var WORKSPACE = path.resolve(__dirname, "..", "..");
var SHARED_DIR = path.join(WORKSPACE, "shared");
var AGENTS_DIR = path.join(WORKSPACE, "shared", "agents");

// Agent 路由表：taskType → Python 模組路徑（相對 AGENTS_DIR）
var AGENT_ROUTES = {
  // 投資顧問
  price:      "investment_agent.py",
  quote:      "investment_agent.py",
  technical:  "investment_agent.py",
  news:       "investment_agent.py",
  portfolio:  "investment_agent.py",
  report:     "investment_agent.py",
  investment: "investment_agent.py",
  // 知識管理師
  search:      "knowledge_agent.py",
  extract:     "knowledge_agent.py",
  classify:    "knowledge_agent.py",
  save_lesson: "knowledge_agent.py",
  stats:       "knowledge_agent.py",
  knowledge:   "knowledge_agent.py",
  // 工具開發師
  new_tool:   "tool_dev_agent.py",
  pipeline:   "tool_dev_agent.py",
  scraper:    "tool_dev_agent.py",
  integration:"tool_dev_agent.py",
  monitor:    "tool_dev_agent.py",
  fix:        "tool_dev_agent.py",
  tool_dev:   "tool_dev_agent.py",
};

// ══════════════════════════════════════════════════════
// 輔助：非同步 execFile → Promise
// 100% 非阻塞 — 取代 execFileSync
// ══════════════════════════════════════════════════════

function execFileAsync(command, args, options) {
  return new Promise(function (resolve, reject) {
    var opts = options || {};
    opts.timeout = opts.timeout || 60000;
    var child = execFile(command, args, opts, function (error, stdout, stderr) {
      if (error) {
        reject(new Error((stderr || error.message).slice(0, 500)));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ══════════════════════════════════════════════════════
// 偵測 Agent 類型
// ══════════════════════════════════════════════════════

function detectAgentType(taskType) {
  if (AGENT_ROUTES[taskType]) return AGENT_ROUTES[taskType];

  for (var key in AGENT_ROUTES) {
    if (AGENT_ROUTES.hasOwnProperty(key)) {
      if (taskType.indexOf(key) !== -1 || key.indexOf(taskType) !== -1) {
        return AGENT_ROUTES[key];
      }
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════
// 執行 Python Agent（非同步）
//
// 流程：
//   1. 寫入 runner script（.lucas_run_<ts>.py）
//   2. 寫入 input JSON（.lucas_input_<ts>.json）
//   3. 非同步 execFile
//   4. 解析 stdout JSON
//   5. setImmediate 清理暫存
// ══════════════════════════════════════════════════════

async function runAgent(agentScript, task) {
  var scriptPath = path.join(AGENTS_DIR, agentScript);
  if (!fs.existsSync(scriptPath)) {
    throw new Error("Agent script not found: " + agentScript);
  }

  var ts = Date.now();
  var tmpScript = path.join(AGENTS_DIR, ".lucas_run_" + ts + ".py");
  var tmpInput  = path.join(AGENTS_DIR, ".lucas_input_" + ts + ".json");

  var safeAgentsDir = AGENTS_DIR.replace(/\\/g, "/");
  var safeSharedDir = SHARED_DIR.replace(/\\/g, "/");
  var safeScriptPath = scriptPath.replace(/\\/g, "/");
  var inputJson = JSON.stringify(task);

  // 建立 runner script（用陣列拼接避免跳脫問題）
  var runnerLines = [
    "import sys, json, importlib.util",
    "sys.path.insert(0, '" + safeAgentsDir + "')",
    "sys.path.insert(0, '" + safeSharedDir + "')",
    "",
    "spec = importlib.util.spec_from_file_location('agent_module', r'" + safeScriptPath + "')",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "",
    "agent_class = None",
    "for attr in dir(mod):",
    "    obj = getattr(mod, attr)",
    "    if isinstance(obj, type) and hasattr(obj, 'process') and attr != 'BaseAgent':",
    "        agent_class = obj",
    "        break",
    "",
    "if not agent_class:",
    "    print(json.dumps({'status': 'error', 'data': '找不到 Agent class'}))",
    "    sys.exit(1)",
    "",
    "with open(r'" + tmpInput.replace(/\\/g, "/") + "', 'r', encoding='utf-8') as f:",
    "    input_data = json.load(f)",
    "",
    "agent = agent_class()",
    "agent.on_start()",
    "result = agent.process(input_data)",
    "agent.on_stop()",
    "print(json.dumps(result, ensure_ascii=False))",
  ];
  var runnerCode = runnerLines.join("\n");

  try {
    fs.writeFileSync(tmpScript, runnerCode, "utf-8");
    fs.writeFileSync(tmpInput, inputJson, "utf-8");

    // ⬅️ 非同步 execFile —— 不阻塞 Event Loop！
    var stdout = await execFileAsync("python3", [tmpScript]);

    try {
      return JSON.parse(stdout.trim());
    } catch (e) {
      return { status: "success", data: stdout.trim() };
    }
  } finally {
    // 清理暫存（setImmediate = 下一個 tick，不阻擋回傳）
    setImmediate(function () {
      try { fs.unlinkSync(tmpScript); } catch (e) {}
      try { fs.unlinkSync(tmpInput);  } catch (e) {}
    });
  }
}

// ══════════════════════════════════════════════════════
// 匯出
// ══════════════════════════════════════════════════════

module.exports = {
  runAgent: runAgent,
  detectAgentType: detectAgentType,
  AGENT_ROUTES: AGENT_ROUTES,
};