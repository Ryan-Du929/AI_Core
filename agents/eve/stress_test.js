// ═══════════════════════════════════════════════════════════
// stress_test.js — Lucas API v3.1 壓力測試腳本
//
// 使用方式：
//   node agents/eve/stress_test.js
//
// 行為：
//   1. 同時發送 5 個不同類型的任務（Promise.all）
//   2. 紀錄每個任務的結果與耗時
//   3. 統計成功/失敗數量
//   4. 若測試通過 exit code 0，否則 exit code 1
// ═══════════════════════════════════════════════════════════

const http = require("http");

const BASE_URL = "http://localhost:3080";
const TIMEOUT_MS = 60000;

// ══════════════════════════════════════════════════════
// 輔助：HTTP POST 回傳 Promise
// ══════════════════════════════════════════════════════

function postJSON(path, body) {
  return new Promise(function (resolve, reject) {
    var url = BASE_URL + path;
    var data = JSON.stringify(body);
    var options = {
      hostname: "localhost",
      port: 3080,
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: TIMEOUT_MS,
    };

    var req = http.request(options, function (res) {
      var chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        try {
          var parsed = JSON.parse(Buffer.concat(chunks).toString());
          parsed._statusCode = res.statusCode;
          resolve(parsed);
        } catch (e) {
          reject(new Error("JSON parse error: " + e.message));
        }
      });
    });

    req.on("error", function (e) { reject(e); });
    req.on("timeout", function () { req.destroy(); reject(new Error("timeout")); });

    req.write(data);
    req.end();
  });
}

// ══════════════════════════════════════════════════════
// 測試任務定義（5 種不同類型）
// ══════════════════════════════════════════════════════

var testTasks = [
  {
    name: "簡單問候",
    body: { prompt: "嗨，你是誰？", taskId: "stress-llm-001" },
    expectAgent: "llm",
  },
  {
    name: "查台股 (Agent 路由)",
    body: { prompt: "台積電 2330 目前價格", taskId: "stress-agent-001", taskType: "price" },
    expectAgent: "investment_agent.py",
  },
  {
    name: "長文生成（測試 chunking）",
    body: { prompt: "請用 500 字介紹台灣的 AI 產業發展現況", taskId: "stress-long-001" },
    expectAgent: "llm",
  },
  {
    name: "帶歷史對話",
    body: {
      prompt: "那鴻海呢？",
      taskId: "stress-hist-001",
      history: [
        { role: "user", content: "台積電多少錢" },
        { role: "assistant", content: "2330 目前 785 元" },
      ],
    },
    expectAgent: "llm",
  },
  {
    name: "無效 taskType（應 fallback 到 LLM）",
    body: { prompt: "隨機亂數產生一個 1-100 的數字", taskId: "stress-fallback-001", taskType: "random_thing" },
    expectAgent: "llm",
  },
];

// ══════════════════════════════════════════════════════
// 執行
// ══════════════════════════════════════════════════════

async function runTests() {
  console.log("🔥 Lucas API v3.1 壓力測試開始");
  console.log("   目標: " + BASE_URL + "/api/execute");
  console.log("   任務數: " + testTasks.length);
  console.log("   超時: " + TIMEOUT_MS + "ms");
  console.log("");

  var promises = testTasks.map(function (task) {
    return postJSON("/api/execute", task.body)
      .then(function (result) {
        return { task: task, result: result, error: null };
      })
      .catch(function (err) {
        return { task: task, result: null, error: err.message };
      });
  });

  var results = await Promise.all(promises);

  // 輸出結果
  var passed = 0;
  var failed = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var status = "❌";
    var reason = "";

    if (r.error) {
      reason = "Request failed: " + r.error;
      failed++;
    } else if (r.result.status !== "success") {
      reason = "status=" + r.result.status + ": " + r.result.data;
      failed++;
    } else if (r.result.agent !== r.task.expectAgent) {
      reason = "預期 agent='" + r.task.expectAgent + "', 實際 agent='" + r.result.agent + "'";
      failed++;
    } else {
      status = "✅";
      passed++;
    }

    console.log("  " + status + " [" + (i + 1) + "/" + results.length + "] " + r.task.name);
    console.log("     taskId: " + (r.task.body.taskId || "無"));
    console.log("     status: " + (r.result ? r.result.status : "N/A") + " | agent: " + (r.result ? r.result.agent : "N/A") + " | " + (r.result ? r.result.elapsed + "ms" : ""));
    if (reason) {
      console.log("     reason: " + reason);
    }
    if (r.result && r.result.data) {
      var preview = r.result.data.slice(0, 80);
      console.log("     data: " + preview + (r.result.data.length > 80 ? "..." : ""));
    }
    console.log("");
  }

  // 總結
  console.log("═══════════════════════════════════");
  console.log("  通過: " + passed + " / " + results.length);
  console.log("  失敗: " + failed + " / " + results.length);
  console.log("  結果: " + (failed === 0 ? "✅ ALL PASSED" : "❌ FAILURES DETECTED"));
  console.log("═══════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function (err) {
  console.error("💥 測試執行異常:", err.message);
  process.exit(1);
});