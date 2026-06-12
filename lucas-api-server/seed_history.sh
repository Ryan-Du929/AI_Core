#!/bin/bash
# seed_history.sh — 批次拉取台股 3 年日 K 資料到 trading.db
# 透過 Lucas API 的 /api/market/fetch 端點，逐支拉取
# Usage: bash seed_history.sh [symbol...]
#   預設: 拉取下方 SYMBOLS 列表

SERVER="http://localhost:3080"
RANGE="3y"

# 預設台股熱門標的
SYMBOLS=(
  "2330.TW"  # 台積電
  "2454.TW"  # 聯發科
  "2317.TW"  # 鴻海
  "2412.TW"  # 中華電
  "2308.TW"  # 台達電
  "2382.TW"  # 廣達
  "2881.TW"  # 富邦金
  "2882.TW"  # 國泰金
  "2891.TW"  # 中信金
  "2886.TW"  # 兆豐金
  "2303.TW"  # 聯電
  "3231.TW"  # 緯創
  "3711.TW"  # 日月光
  "2357.TW"  # 華碩
  "3008.TW"  # 大立光
  "2498.TW"  # 宏達電
  "2345.TW"  # 智邦
  "6669.TW"  # 緯穎
  "2379.TW"  # 瑞昱
  "3034.TW"  # 聯詠
  # 指數 ETF
  "0050.TW"  # 元大台灣50
  "0056.TW"  # 元大高股息
  "006208.TW" # 富邦台50
  "00878.TW" # 國泰永續高股息
  # 台指期（Yahoo 用 ^TWII）
  "^TWII"    # 加權指數
)

# 如果傳入參數就用傳入的
if [ $# -gt 0 ]; then
  SYMBOLS=("$@")
fi

TOTAL=${#SYMBOLS[@]}
COUNT=0
SUCCESS=0
FAIL=0

echo "=========================================="
echo "📊 開始拉取 $TOTAL 支標的 3 年日 K 資料"
echo "=========================================="

for SYM in "${SYMBOLS[@]}"; do
  COUNT=$((COUNT + 1))
  echo -n "[$COUNT/$TOTAL] $SYM ... "

  RESULT=$(curl -s -X POST "$SERVER/api/market/fetch" \
    -H "Content-Type: application/json" \
    -d "{\"symbol\":\"$SYM\",\"range\":\"$RANGE\"}" 2>&1)

  if echo "$RESULT" | grep -q '"stored"'; then
    STORED=$(echo "$RESULT" | grep -oP '"stored":\K\d+')
    echo "✅ $STORED 筆"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "❌ $RESULT"
    FAIL=$((FAIL + 1))
  fi

  # Yahoo Finance rate limit — 每支間隔 1 秒
  sleep 1
done

echo "=========================================="
echo "✅ 完成: $SUCCESS 成功, $FAIL 失敗 (共 $TOTAL 支)"
echo "=========================================="

# 最終統計
echo ""
echo "📊 stock_prices 資料表統計:"
curl -s "$SERVER/api/stocks/%5ETWII?limit=1" | python3 -m json.tool 2>/dev/null | head -3