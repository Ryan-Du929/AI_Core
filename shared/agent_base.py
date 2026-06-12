#!/usr/bin/env python3
"""
agent_base.py — 統一 Agent API 基礎類別 v1.0
==============================================
設計哲學：
  所有專家模組繼承此基底類別，確保一致的初始化、任務處理、記憶、報告與通訊介面。
  遵循「規約重於設定 (Convention over Configuration)」原則。

使用方式：
  from agent_base import BaseAgent

  class InvestmentAgent(BaseAgent):
      def __init__(self):
          super().__init__(name="投資顧問", role="專家")

      def process(self, task):
          # 實作你的領域邏輯
          ...
          return self.respond(result)
"""

import os
import json
import time
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Callable


# ══════════════════════════════════════════════════════
# 1. Agent 基礎類別
# ══════════════════════════════════════════════════════

class BaseAgent:
    """
    所有專家模組的基底類別。
    
    提供：
    - 統一初始化與設定檔載入
    - 標準化任務處理 pipeline
    - 記憶管理（短/長期）
    - 報告產生（純文字 / Embed / 檔案）
    - 通訊介面（queue / direct）
    - Token 用量追蹤
    - 錯誤處理與重試
    """

    # ── 子類別應覆寫的常數 ──
    NAME = "base_agent"
    ROLE = "generic"
    VERSION = "1.0"
    DESCRIPTION = "基礎 Agent"

    # ── 記憶門檻 ──
    MAX_SHORT_TERM = 30       # 短期記憶保留條數
    DISTILL_TRIGGER = 10      # 觸發蒸餾的對話數
    MAX_TOKENS_DISTILL = 500  # 蒸餾摘要最大 token 數

    def __init__(
        self,
        name: Optional[str] = None,
        role: Optional[str] = None,
        workspace: Optional[str] = None,
        config: Optional[Dict] = None,
    ):
        """
        初始化 Agent。
        
        Args:
            name: Agent 顯示名稱（預設 NAME）
            role: Agent 角色分類（預設 ROLE）
            workspace: 工作目錄（預設 /home/node/.openclaw/workspace-your）
            config: 自訂設定（可覆寫預設值）
        """
        self.name = name or self.NAME
        self.role = role or self.ROLE
        self.workspace = workspace or os.path.expanduser(
            "/home/node/.openclaw/workspace-your"
        )
        self.shared_dir = os.path.join(self.workspace, "shared")

        # ── 記憶 ──
        self.memory_dir = os.path.join(self.shared_dir, "memory")
        self.memory_file = os.path.join(self.memory_dir, f"{self.name}-memory.json")
        self.cache_file = os.path.join(self.memory_dir, f"{self.name}-distill-cache.json")
        self._memory: Optional[Dict] = None

        # ── 通訊 ──
        self.queue_dir = os.path.join(self.shared_dir, "queue")
        self.results_dir = os.path.join(self.shared_dir, "results")

        # ── Token 用量追蹤 ──
        self.token_usage = {
            "total_input": 0,
            "total_output": 0,
            "total_tokens": 0,
            "api_calls": 0,
            "last_reset": datetime.now(timezone.utc).isoformat(),
        }

        # ── 設定合併 ──
        self.config = {
            "max_short_term": self.MAX_SHORT_TERM,
            "distill_trigger": self.DISTILL_TRIGGER,
            "max_tokens_distill": self.MAX_TOKENS_DISTILL,
            "api_timeout": 120,
            "retry_max": 3,
            "retry_base": 1,
        }
        if config:
            self.config.update(config)

        # ── 初始化日誌 ──
        self._log(f"{self.name} ({self.role}) 初始化完成")

    # ────────── 記憶管理 ──────────

    def load_memory(self) -> Dict:
        """載入記憶檔，若不存在則建立預設結構"""
        if self._memory is not None:
            return self._memory

        os.makedirs(self.memory_dir, exist_ok=True)
        if os.path.exists(self.memory_file):
            try:
                with open(self.memory_file, "r", encoding="utf-8") as f:
                    self._memory = json.load(f)
                return self._memory
            except (json.JSONDecodeError, FileNotFoundError):
                pass

        self._memory = {
            "agent": self.name,
            "role": self.role,
            "version": self.VERSION,
            "conversations": [],
            "facts": [],
            "turnCount": 0,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        self.save_memory()
        return self._memory

    def save_memory(self):
        """儲存記憶至檔案"""
        if self._memory is None:
            return
        self._memory["updatedAt"] = datetime.now(timezone.utc).isoformat()
        os.makedirs(self.memory_dir, exist_ok=True)
        with open(self.memory_file, "w", encoding="utf-8") as f:
            json.dump(self._memory, f, indent=2, ensure_ascii=False)

    def add_conversation(self, role: str, content: str):
        """新增一則對話記錄（自動管理總量）"""
        mem = self.load_memory()
        entry = {
            "role": role,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        mem["conversations"].append(entry)
        mem["turnCount"] = mem.get("turnCount", 0) + 1

        # 超過上限時裁剪
        max_len = self.config["max_short_term"]
        if len(mem["conversations"]) > max_len:
            mem["conversations"] = mem["conversations"][-max_len:]

        self.save_memory()

    def needs_distill(self) -> bool:
        """檢查是否需要蒸餾"""
        mem = self.load_memory()
        turn_count = mem.get("turnCount", 0)
        trigger = self.config["distill_trigger"]

        # 檢查快取
        cache = self._load_cache()
        last_distill_turns = cache.get("turnCountAtLastDistill", 0)

        return turn_count >= trigger and turn_count > last_distill_turns

    def should_distill(self) -> bool:
        """公開介面 — 檢查是否需要蒸餾（供外部呼叫）"""
        return self.needs_distill()

    def distill(self, summary_func: Optional[Callable] = None) -> Optional[str]:
        """
        執行記憶蒸餾。
        
        Args:
            summary_func: 外部摘要函式，輸入 conversations list，回傳摘要字串
        
        Returns:
            摘要字串，若無需蒸餾則回傳 None
        """
        if not self.needs_distill():
            return None

        mem = self.load_memory()
        conversations = mem.get("conversations", [])

        if not conversations:
            return None

        # 呼叫外部摘要函式（若無提供則使用預設）
        history = conversations[-30:]
        if summary_func:
            summary = summary_func(history)
        else:
            summary = self._default_distill(history)

        if not summary:
            summary = f"[摘要失敗] 共 {len(history)} 條訊息。"

        # 壓縮記憶
        mem["conversations"] = [
            {
                "role": "system",
                "content": f"這是先前的記憶摘要：{summary}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ]
        mem["turnCount"] = 0

        # 更新快取
        cache = self._load_cache()
        cache["lastDistillAt"] = datetime.now(timezone.utc).isoformat()
        cache["turnCountAtLastDistill"] = len(conversations)
        if "hashHistory" not in cache:
            cache["hashHistory"] = []
        cache["hashHistory"].append(self._compute_hash(history))
        cache["hashHistory"] = cache["hashHistory"][-10:]
        self._save_cache(cache)

        self.save_memory()
        self._log(f"記憶蒸餾完成，摘要 {len(summary)} 字")
        return summary

    def get_facts(self) -> List[str]:
        """取得長期事實列表"""
        mem = self.load_memory()
        return mem.get("facts", [])

    def add_fact(self, fact: str):
        """新增一條長期事實"""
        mem = self.load_memory()
        if "facts" not in mem:
            mem["facts"] = []
        mem["facts"].append(fact)
        self.save_memory()

    # ────────── Token 追蹤 ──────────

    def track_tokens(self, input_tokens: int, output_tokens: int):
        """記錄 API token 用量"""
        self.token_usage["total_input"] += input_tokens
        self.token_usage["total_output"] += output_tokens
        self.token_usage["total_tokens"] += input_tokens + output_tokens
        self.token_usage["api_calls"] += 1

    def get_token_report(self) -> Dict:
        """回傳 Token 用量報告"""
        return dict(self.token_usage)

    def reset_token_tracking(self):
        """重設 Token 用量計數"""
        self.token_usage = {
            "total_input": 0,
            "total_output": 0,
            "total_tokens": 0,
            "api_calls": 0,
            "last_reset": datetime.now(timezone.utc).isoformat(),
        }

    # ────────── 通訊介面 ──────────

    def send_to_queue(self, content: str, task_type: str = "task", **kwargs) -> str:
        """
        寫入 queue 供其他 Agent 處理。
        
        Args:
            content: 任務內容
            task_type: 任務類型 (task / discuss / fetch / discord_report)
            **kwargs: 額外欄位 (author, channel, embeds, etc.)
        
        Returns:
            寫入的檔案名稱（含副檔名）
        """
        os.makedirs(self.queue_dir, exist_ok=True)
        msg_id = str(uuid.uuid4())
        item = {
            "id": msg_id,
            "type": task_type,
            "author": self.name,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "pending",
            **kwargs,
        }
        fname = f"{msg_id}.json"
        fpath = os.path.join(self.queue_dir, fname)
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(item, f, indent=2, ensure_ascii=False)
        self._log(f"queue 寫入: {fname}")
        return fname

    def read_results(self, max_count: int = 5) -> List[Dict]:
        """讀取最近的處理結果"""
        os.makedirs(self.results_dir, exist_ok=True)
        files = sorted(
            [f for f in os.listdir(self.results_dir) if f.endswith(".json")],
            reverse=True,
        )[:max_count]
        results = []
        for fname in files:
            fpath = os.path.join(self.results_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    results.append(json.load(f))
            except (json.JSONDecodeError, FileNotFoundError):
                continue
        return results

    # ────────── 報告產生 ──────────

    def make_embed(
        self,
        title: str = "",
        description: str = "",
        color: Optional[int] = None,
        fields: Optional[List[Dict]] = None,
        status: str = "info",
    ) -> Dict:
        """產生 Discord Embed 字典"""
        color_map = {
            "success": 0x00FF88, "warning": 0xFFAA00,
            "error": 0xFF4444, "info": 0x4488FF, "system": 0xAA88FF,
        }
        embed = {
            "color": color or color_map.get(status, 0x888888),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if title:
            embed["title"] = title[:256]
        if description:
            embed["description"] = description[:4096]
        if fields:
            embed["fields"] = [
                {"name": str(f.get("name", ""))[:256],
                 "value": str(f.get("value", ""))[:1024],
                 "inline": f.get("inline", False)}
                for f in fields
            ]
        return embed

    # ────────── 生命週期方法 ──────────

    def on_start(self):
        """啟動回呼 — 在 Agent 啟動時執行"""
        self._log(f"{self.name} 啟動")

    def on_stop(self):
        """停止回呼 — 在 Agent 停止時執行"""
        self.save_memory()
        self._log(f"{self.name} 停止")

    def process(self, task: Dict) -> Dict:
        """
        [子類別應覆寫] 處理任務的主方法。
        
        Args:
            task: 任務字典，包含 content, author, type 等欄位
        
        Returns:
            回應字典，包含 content, status 等欄位
        """
        raise NotImplementedError("子類別必須實作 process()")

    # ────────── 內部方法 ──────────

    def _log(self, message: str):
        """內部日誌"""
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] [{self.name}] {message}")

    def _load_cache(self) -> Dict:
        """載入蒸餾快取"""
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                pass
        return {}

    def _save_cache(self, cache: Dict):
        """儲存蒸餾快取"""
        os.makedirs(self.memory_dir, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)

    def _compute_hash(self, obj) -> str:
        """計算物件的 SHA256"""
        raw = json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()
        return hashlib.sha256(raw).hexdigest()

    def _default_distill(self, conversations: List) -> str:
        """預設蒸餾：取最後 conversation 內容"""
        texts = [
            c.get("content", "")[:200]
            for c in conversations[-5:]
        ]
        return " | ".join(texts)


# ══════════════════════════════════════════════════════
# 2. 回覆包裝器
# ══════════════════════════════════════════════════════

class AgentResponse:
    """標準化 Agent 回應結構"""
    
    def __init__(
        self,
        content: str = "",
        status: str = "success",
        embeds: Optional[List[Dict]] = None,
        files: Optional[List[str]] = None,
        metadata: Optional[Dict] = None,
    ):
        self.data = {
            "content": content,
            "status": status,
            "embeds": embeds or [],
            "files": files or [],
            "metadata": metadata or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def to_dict(self) -> Dict:
        return self.data

    def to_queue_item(self, task_type: str = "task", **kwargs) -> Dict:
        return {
            "type": task_type,
            "content": self.data["content"],
            "embeds": self.data["embeds"],
            **kwargs,
        }


# ══════════════════════════════════════════════════════
# 3. Agent 調度器（用於管理多個 Agent）
# ══════════════════════════════════════════════════════

class AgentDispatcher:
    """
    多 Agent 調度器。
    負責：
    - 註冊/取消 Agent
    - 根據任務類型路由到對應 Agent
    - 統一啟動/停止生命週期
    """
    
    def __init__(self):
        self._agents: Dict[str, BaseAgent] = {}

    def register(self, agent: BaseAgent):
        """註冊一個 Agent，使用顯示名稱 (ROLE) 為 key"""
        self._agents[agent.ROLE] = agent
        agent.on_start()

    def unregister(self, name: str):
        """取消註冊一個 Agent"""
        if name in self._agents:
            self._agents[name].on_stop()
            del self._agents[name]

    def get(self, name: str) -> Optional[BaseAgent]:
        """取得 Agent 實體"""
        return self._agents.get(name)

    def route(self, task: Dict) -> Dict:
        """
        根據任務類型路由到對應 Agent。
        
        路由規則：
        - type="investment" → 投資 Agent
        - type="tool_dev" → 工具開發 Agent
        - type="knowledge" → 知識管理 Agent
        - type="task" → 所有 Agent（由 Lucas 決定）
        """
        task_type = task.get("type", "task")
        target_agent = task.get("target_agent")

        if target_agent and target_agent in self._agents:
            return self._agents[target_agent].process(task)

        # 依類型自動路由
        route_map = {
            "investment": "投資顧問",
            "tool_dev": "工具開發師",
            "knowledge": "知識管理師",
            "price": "投資顧問",
            "quote": "投資顧問",
            "technical": "投資顧問",
            "news": "投資顧問",
            "portfolio": "投資顧問",
            "report": "投資顧問",
            "new_tool": "工具開發師",
            "pipeline": "工具開發師",
            "scraper": "工具開發師",
            "integration": "工具開發師",
            "monitor": "工具開發師",
            "fix": "工具開發師",
            "review": "工具開發師",
            "search": "知識管理師",
            "extract": "知識管理師",
            "classify": "知識管理師",
            "save_lesson": "知識管理師",
            "stats": "知識管理師",
        }
        if task_type in route_map and route_map[task_type] in self._agents:
            return self._agents[route_map[task_type]].process(task)

        return AgentResponse(
            content=f"找不到處理 '{task_type}' 的 Agent",
            status="error",
        ).to_dict()

    def list_agents(self) -> List[Dict]:
        """列出所有已註冊的 Agent"""
        return [
            {
                "name": a.name,
                "role": a.role,
                "version": a.VERSION,
                "description": a.DESCRIPTION,
                "turn_count": a.load_memory().get("turnCount", 0),
            }
            for a in self._agents.values()
        ]

    def broadcast(self, message: str):
        """向所有 Agent 廣播訊息"""
        for agent in self._agents.values():
            agent.add_conversation("system", message)

    def start_all(self):
        """啟動所有 Agent"""
        for agent in self._agents.values():
            agent.on_start()

    def stop_all(self):
        """停止所有 Agent"""
        for agent in self._agents.values():
            agent.on_stop()


# ══════════════════════════════════════════════════════
# 4. 測試與範例
# ══════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 60)
    print("Agent Base Class 測試")
    print("=" * 60)

    # 建立一個測試 Agent
    class TestAgent(BaseAgent):
        NAME = "test_agent"
        ROLE = "測試"
        VERSION = "1.0"
        DESCRIPTION = "測試用 Agent"

        def process(self, task):
            content = task.get("content", "")
            self.add_conversation("user", content)
            return AgentResponse(
                content=f"收到：{content}",
                status="success",
                embeds=[self.make_embed(title="測試回覆", description=f"內容: {content}")],
            ).to_dict()

    agent = TestAgent()
    agent.on_start()

    # 測試記憶
    agent.add_conversation("user", "今天天氣如何？")
    agent.add_conversation("assistant", "天氣很好，適合工作。")

    # 測試 process
    result = agent.process({"content": "幫我查一下股票"})
    print(f"Process 結果: {result['content']}")
    print(f"Embeds: {len(result['embeds'])} 個")

    # 測試 token 追蹤
    agent.track_tokens(100, 50)
    agent.track_tokens(200, 80)
    print(f"Token 用量: {agent.get_token_report()}")

    # 測試 dispatcher
    dispatcher = AgentDispatcher()
    dispatcher.register(agent)
    print(f"已註冊 Agent: {[a['name'] for a in dispatcher.list_agents()]}")

    agent.on_stop()
    print("\n✅ 所有測試通過")