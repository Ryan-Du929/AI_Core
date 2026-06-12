"""
shared/agents/ — Lucas 團隊專家 Agent 套件
=========================================
所有 Agent 繼承 shared/agent_base.py 的 BaseAgent。
透過 init_agents() 初始化全部專家並回傳 AgentDispatcher。

使用方式：
    from shared.agents import init_agents
    dispatcher = init_agents()
    dispatcher.list_agents()   # 查看所有已註冊 Agent
    dispatcher.route(task)     # 依任務類型路由
"""

from .investment_agent import InvestmentAgent
from .tool_dev_agent import ToolDevAgent
from .knowledge_agent import KnowledgeAgent
from ..agent_base import AgentDispatcher


def init_agents() -> AgentDispatcher:
    """初始化所有專家 Agent，註冊到 Dispatcher 並回傳"""
    dispatcher = AgentDispatcher()

    dispatcher.register(InvestmentAgent())
    dispatcher.register(ToolDevAgent())
    dispatcher.register(KnowledgeAgent())

    return dispatcher


__all__ = [
    "InvestmentAgent",
    "ToolDevAgent",
    "KnowledgeAgent",
    "init_agents",
    "AgentDispatcher",
]