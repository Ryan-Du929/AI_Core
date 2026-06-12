#!/usr/bin/env python3
"""check_deps.py — 檢查 shioaji 是否可匯入"""
try:
    import shioaji
    print('{"status":"ok","version":"%s"}' % shioaji.__version__)
except ImportError as e:
    print('{"status":"missing","error":"%s"}' % str(e))
except Exception as e:
    print('{"status":"error","error":"%s"}' % str(e))