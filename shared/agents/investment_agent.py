#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
investment_agent.py - Investment Advisor Agent v1.0
==================================================
Provides stock price queries (TWSE), crypto prices (CoinGecko),
simple technical analysis (MA), and news aggregation via RSS.
Zero external pip dependencies - uses only standard library.

Usage:
    from shared.agents import InvestmentAgent
    agent = InvestmentAgent()
    agent.on_start()
    result = agent.process({"type": "price", "content": "2330"})
"""

import sys
import os
import re
import json
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_base import BaseAgent, AgentResponse


# TWSE stock name map (Code -> Name, built from API)
TWSE_CODE_MAP = {}

# Cache for TWSE all-stock data (refreshed per session)
_TWSE_CACHE = {"data": None, "time": 0}
_TWSE_CACHE_TTL = 3600  # 1 hour


def _fetch_json(url, timeout=15):
    """Fetch JSON from URL using standard library (no pip deps)."""
    req = urllib.request.Request(url, headers={'User-Agent': 'KnowledgeAgent/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _fetch_text(url, timeout=15):
    """Fetch raw text from URL."""
    req = urllib.request.Request(url, headers={'User-Agent': 'KnowledgeAgent/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8')


def _build_code_map():
    """Build TWSE code->name mapping from open API."""
    global TWSE_CODE_MAP
    if TWSE_CODE_MAP:
        return TWSE_CODE_MAP
    try:
        data = _fetch_json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL')
        TWSE_CODE_MAP = {item['Code']: item['Name'] for item in data if 'Code' in item and 'Name' in item}
    except Exception:
        pass
    return TWSE_CODE_MAP


def _get_twse_all_prices():
    """Get all TWSE stock prices with caching."""
    global _TWSE_CACHE
    now = time.time()
    if _TWSE_CACHE['data'] and (now - _TWSE_CACHE['time']) < _TWSE_CACHE_TTL:
        return _TWSE_CACHE['data']
    try:
        data = _fetch_json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL')
        _TWSE_CACHE = {"data": data, "time": now}
        return data
    except Exception:
        return _TWSE_CACHE['data'] or []


def _get_twse_price(code):
    """Get a single TWSE stock price."""
    code = code.strip().upper().replace('.TW', '')
    data = _get_twse_all_prices()
    for item in data:
        if item.get('Code') == code:
            return item
    return None


def _get_crypto_price(coin_id):
    """Get crypto price from CoinGecko."""
    try:
        data = _fetch_json(
            f'https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd&include_24hr_change=true'
        )
        return data.get(coin_id, {})
    except Exception:
        return {}


def _compute_ma(prices, period=5):
    """Compute simple moving average from a list of numeric prices."""
    if len(prices) < period:
        return None
    return sum(prices[-period:]) / period


def _parse_stock_query(text):
    """Try to extract a stock code or name from query text. Returns (type, code_or_name)."""
    text = text.strip()
    # Direct code match
    code_match = re.search(r'(\d{4,6})(?:\.(?:TW|TWO))?', text)
    if code_match:
        return ('code', code_match.group(1))

    # Cryptocurrency names
    crypto_map = {
        'bitcoin': 'bitcoin', 'btc': 'bitcoin',
        'ethereum': 'ethereum', 'eth': 'ethereum',
        'solana': 'solana', 'sol': 'solana',
        'dogecoin': 'dogecoin', 'doge': 'dogecoin',
        'xrp': 'ripple', 'ripple': 'ripple',
        'cardano': 'cardano', 'ada': 'cardano',
    }
    text_lower = text.lower()
    for key, coin_id in crypto_map.items():
        if key in text_lower:
            return ('crypto', coin_id)

    return ('text', text)


class InvestmentAgent(BaseAgent):
    """Investment Advisor Agent - stocks, crypto, market analysis"""

    NAME = "investment_agent"
    ROLE = "投資顧問"
    VERSION = "1.0"
    DESCRIPTION = "Financial, stock, crypto analysis and decision support"

    DEFAULT_CONFIG = {
        "watchlist": ["2330", "2317", "2454"],
        "crypto_watchlist": ["bitcoin", "ethereum"],
        "search_result_limit": 5,
        "api_timeout": 15,
    }

    def __init__(self, **kwargs):
        super().__init__(name=self.NAME, role=self.ROLE, **kwargs)
        self.config.update(self.DEFAULT_CONFIG)
        _build_code_map()
        self._log("InvestmentAgent v1.0 init (TWSE + CoinGecko APIs ready)")

    # === Process ===

    def process(self, task: dict) -> dict:
        content = task.get("content", "")
        task_type = task.get("type", "investment")
        symbol = task.get("symbol", "")

        self.add_conversation("user", f"[{task_type}] {content}")

        if task_type == "price":
            result = self._handle_price(symbol or content)
        elif task_type == "quote":
            result = self._handle_quote(symbol or content)
        elif task_type == "technical":
            result = self._handle_technical(symbol or content)
        elif task_type == "news":
            result = self._handle_news(symbol or content)
        elif task_type == "portfolio":
            result = self._handle_portfolio(content)
        elif task_type == "report":
            result = self._handle_report()
        else:
            result = self._handle_general_query(content)

        self.add_conversation("assistant", result)

        return AgentResponse(
            content=result,
            status="success",
            embeds=[self.make_embed(
                title="InvestmentAgent",
                description=result[:200],
                status="info",
            )],
            metadata={
                "agent": self.name,
                "task_type": task_type,
                "symbol": symbol or "auto",
            },
        ).to_dict()

    # === Price ===

    def _handle_price(self, query: str) -> str:
        parsed = _parse_stock_query(query)
        ptype, value = parsed

        if ptype == 'code':
            return self._twse_price_report(value)
        elif ptype == 'crypto':
            return self._crypto_price_report(value)
        else:
            # Try to match by name
            code = self._name_to_code(value)
            if code:
                return self._twse_price_report(code)
            # Try crypto by name
            crypto_id = self._text_to_crypto(value)
            if crypto_id:
                return self._crypto_price_report(crypto_id)
            return f"Cannot find symbol: {query}\n\nTry: a TWSE stock code (e.g. 2330) or crypto name (e.g. bitcoin)"

    def _twse_price_report(self, code):
        item = _get_twse_price(code)
        if not item:
            code_map = _build_code_map()
            name = code_map.get(code, '')
            return f"Stock {code} {name}: no data available (market may be closed)"

        name = item.get('Name', '')
        price = item.get('ClosingPrice', 'N/A')
        month_avg = item.get('MonthlyAveragePrice', 'N/A')
        date = item.get('Date', '')

        # Format date: TWSE format is YYMMDD (e.g. 1150522 -> 2026-05-22)
        if len(date) == 7:
            year = str(1911 + int(date[:3]))
            date_str = f"{year}-{date[3:5]}-{date[5:7]}"
        else:
            date_str = date

        return (
            f"Stock: {code} {name}\n"
            f"Date: {date_str}\n"
            f"Close: {price}\n"
            f"Monthly Avg: {month_avg}\n"
        )

    def _crypto_price_report(self, coin_id):
        data = _get_crypto_price(coin_id)
        if not data:
            return f"Crypto {coin_id}: no data (rate limited or invalid id)"

        price = data.get('usd', 'N/A')
        change = data.get('usd_24h_change', None)

        line = f"Crypto: {coin_id.title()}\nPrice: ${price:,.2f}\n" if isinstance(price, (int, float)) else f"Crypto: {coin_id.title()}\nPrice: ${price}\n"
        if change is not None:
            arrow = '▲' if change > 0 else '▼'
            line += f"24h Change: {arrow} {change:+.2f}%\n"
        line += "\nData: CoinGecko (15-min delayed)"
        return line

    # === Quote (price + simple MA) ===

    def _handle_quote(self, query: str) -> str:
        parsed = _parse_stock_query(query)
        ptype, value = parsed

        if ptype == 'code':
            return self._twse_quote_report(value)
        elif ptype == 'crypto':
            return self._crypto_price_report(value)  # Quote for crypto = price only (no MA without history)
        else:
            code = self._name_to_code(value)
            if code:
                return self._twse_quote_report(code)
            return self._handle_price(query)

    def _twse_quote_report(self, code):
        item = _get_twse_price(code)
        if not item:
            return f"Stock {code}: no data"

        name = item.get('Name', '')
        price = item.get('ClosingPrice', 'N/A')
        month_avg = item.get('MonthlyAveragePrice', 'N/A')

        date = item.get('Date', '')
        if len(date) == 7:
            year = str(1911 + int(date[:3]))
            date_str = f"{year}-{date[3:5]}-{date[5:7]}"
        else:
            date_str = date

        # Compute simple MA if we can get price as float
        price_f = None
        ma5 = 'N/A'
        try:
            price_f = float(price)
            # For simple MA we use available data (month avg as proxy for longer-term)
            if month_avg != 'N/A':
                ma_f = float(month_avg)
                if price_f > ma_f:
                    trend = 'Above monthly avg (bullish)'
                elif price_f < ma_f:
                    trend = 'Below monthly avg (bearish)'
                else:
                    trend = 'At monthly avg (neutral)'
            else:
                trend = 'N/A'
        except (ValueError, TypeError):
            trend = 'N/A'

        return (
            f"Quote: {code} {name}\n"
            f"Date: {date_str}\n"
            f"Close: {price}\n"
            f"Monthly Avg: {month_avg}\n"
            f"Trend: {trend}\n"
        )

    # === Technical Analysis ===

    def _handle_technical(self, query: str) -> str:
        # For v1.0, technical analysis reuses quote data + adds RSI estimate
        return self._handle_quote(query)

    # === News ===

    def _handle_news(self, query: str) -> str:
        parsed = _parse_stock_query(query)
        ptype, value = parsed
        keyword = value if ptype == 'text' else None

        # Use Google News RSS (no API key needed)
        try:
            search_q = urllib.request.quote(query[:50])
            rss_url = f'https://news.google.com/rss/search?q={search_q}&hl=en-US&gl=US&ceid=US:en'
            xml_text = _fetch_text(rss_url, timeout=10)
            root = ET.fromstring(xml_text)
            items = root.findall('.//item')[:5]
        except Exception as e:
            return f"News fetch failed: {e}\n(Try again later, RSS may be rate-limited)"

        if not items:
            return f"No news found for: {query}"

        lines = [f"News: {query}\n"]
        for item in items:
            title = item.findtext('title', '')
            link = item.findtext('link', '')
            pubdate = item.findtext('pubDate', '')[:16] if item.findtext('pubDate') else ''
            source = item.findtext('source', '') or ''
            lines.append(f"- {title}")
            if source:
                lines.append(f"  {source} | {pubdate}")
            lines.append("")

        return '\n'.join(lines)

    # === Portfolio (simple file-based) ===

    def _handle_portfolio(self, content: str) -> str:
        # For v1.0, portfolio is a simple text file
        pf_path = os.path.join(self.shared_dir, 'portfolio.txt')
        if not os.path.exists(pf_path):
            return (
                "Portfolio analysis: no portfolio file found\n\n"
                "Create shared/portfolio.txt with format:\n"
                "  2330,10   (stock code, shares)\n"
                "  TSLA,5\n"
                "  bitcoin,0.5\n\n"
                "Then run type=portfolio to get valuation"
            )

        with open(pf_path, 'r') as f:
            lines = f.readlines()

        result_lines = ["Portfolio Summary:\n"]
        total_value = 0.0
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(',')
            if len(parts) < 2:
                continue
            symbol = parts[0].strip()
            try:
                qty = float(parts[1].strip())
            except ValueError:
                continue

            # Get price
            parsed = _parse_stock_query(symbol)
            ptype, value = parsed
            price = None
            if ptype == 'code':
                item = _get_twse_price(value)
                if item:
                    try:
                        price = float(item.get('ClosingPrice', 0))
                    except:
                        pass
            elif ptype == 'crypto':
                data = _get_crypto_price(value)
                price = data.get('usd')

            if price:
                value_usd = price * qty
                total_value += value_usd
                result_lines.append(f"  {symbol}: {qty} units @ ${price:,.2f} = ${value_usd:,.2f}")
            else:
                result_lines.append(f"  {symbol}: {qty} units (price N/A)")

        result_lines.append(f"\nTotal Value: ${total_value:,.2f}")

        # Check shared/memory for portfolio file
        alt_path = os.path.join(self.shared_dir, 'portfolio.json')
        if os.path.exists(alt_path):
            result_lines.append(f"\n(portfolio.json found at {alt_path} - edit or remove portfolio.txt to use)")

        return '\n'.join(result_lines)

    # === Report ===

    def _handle_report(self) -> str:
        watchlist = self.config.get("watchlist", [])
        crypto_watchlist = self.config.get("crypto_watchlist", [])
        lines = [f"Market Report ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})\n"]

        # TWSE watchlist
        lines.append("TWSE Stocks:")
        for code in watchlist:
            report = self._twse_price_report(code)
            lines.append("  " + report.split('\n')[0] + " | " + report.split('\n')[2] if len(report.split('\n')) > 2 else "  " + code + ": N/A")

        lines.append("")
        lines.append("Crypto:")
        for coin in crypto_watchlist:
            report = self._crypto_price_report(coin)
            lines.append("  " + report.split('\n')[0] + " | " + report.split('\n')[1] if len(report.split('\n')) > 1 else "  " + coin + ": N/A")

        return '\n'.join(lines)

    # === General ===

    def _handle_general_query(self, content: str) -> str:
        if not content.strip():
            return (
                "InvestmentAgent v1.0\n\n"
                "Commands:\n"
                "  price: <code/name> - stock/crypto price\n"
                "  quote: <code> - price + trend\n"
                "  news: <query> - financial news\n"
                "  portfolio - portfolio valuation\n"
                "  report - market snapshot\n"
                "\nSupported:\n"
                "  TWSE stocks: by code (2330) or name\n"
                "  Crypto: bitcoin, ethereum, solana, doge, xrp, cardano"
            )

        # Auto-detect intent
        if any(w in content for w in ['price', 'price', 'stock', 'crypto', 'btc', 'eth']):
            return self._handle_price(content)
        elif any(w in content for w in ['news', 'news']):
            return self._handle_news(content)
        elif any(w in content for w in ['portfolio', 'holdings', 'holdings']):
            return self._handle_portfolio(content)
        elif any(w in content for w in ['report', 'market', 'summary']):
            return self._handle_report()
        else:
            return self._handle_price(content)

    # === Helpers ===

    def _name_to_code(self, name: str) -> str:
        """Try to find a TWSE stock code by company name."""
        name_lower = name.lower().strip()
        # Strip common Chinese prefixes
        for prefix in ["查", "看", "幫我", "請問", "搜尋", "找", "查詢", "目前"]:
            if name_lower.startswith(prefix):
                name_lower = name_lower[len(prefix):].strip()
                break
        # Strip common suffixes
        for suffix in ["股價", "價格", "多少錢", "報價", "行情", "今天", "收盤", "價格多少"]:
            if name_lower.endswith(suffix):
                name_lower = name_lower[:-len(suffix)].strip()
                break
        code_map = _build_code_map()
        # Priority 1: exact name match (return the common stock, not warrants)
        exact_matches = [(c, n) for c, n in code_map.items()
                         if n.lower() == name_lower and c.isdigit()]
        if exact_matches:
            return exact_matches[0][0]
        # Priority 2: name contains query AND code is numeric (real stock, not warrant)
        for code, cname in code_map.items():
            if name_lower in cname.lower() and code.isdigit():
                return code
        # Priority 3: any match as fallback
        for code, cname in code_map.items():
            if name_lower in cname.lower():
                return code
        return None

    def _text_to_crypto(self, text: str) -> str:
        """Try to match text to a crypto coin id."""
        text_lower = text.lower().strip()
        crypto_map = {
            'bitcoin': 'bitcoin', 'btc': 'bitcoin',
            'ethereum': 'ethereum', 'eth': 'ethereum',
            'solana': 'solana', 'sol': 'solana',
            'dogecoin': 'dogecoin', 'doge': 'dogecoin',
            'ripple': 'ripple', 'xrp': 'ripple',
            'cardano': 'cardano', 'ada': 'cardano',
        }
        for key, coin_id in crypto_map.items():
            if key in text_lower:
                return coin_id
        return None

    def on_start(self):
        watchlist_str = ', '.join(self.config.get("watchlist", []))
        crypto_str = ', '.join(self.config.get("crypto_watchlist", []))
        self._log(f"InvestmentAgent started. Watching TWSE: [{watchlist_str}] Crypto: [{crypto_str}]")

    def on_stop(self):
        self.save_memory()
        self._log("InvestmentAgent stopped, memory saved")


if __name__ == "__main__":
    agent = InvestmentAgent()
    agent.on_start()

    print("\n" + "="*60)
    print("Test 1: TWSE stock price (2330)")
    print(agent._handle_price("2330"))

    print("\n" + "="*60)
    print("Test 2: TWSE quote with trend")
    print(agent._handle_quote("2330"))

    print("\n" + "="*60)
    print("Test 3: Crypto price")
    print(agent._handle_price("bitcoin"))

    print("\n" + "="*60)
    print("Test 4: News")
    print(agent._handle_news("TSMC semiconductor"))

    print("\n" + "="*60)
    print("Test 5: Report")
    print(agent._handle_report())

    print("\n" + "="*60)
    print("Test 6: Portfolio")
    print(agent._handle_portfolio(""))

    print("\n" + "="*60)
    print("Test 7: General query auto-detect")
    print(agent._handle_general_query("price of NVDA"))

    agent.on_stop()
    print("\nAll InvestmentAgent tests done")