#!/usr/bin/env python3
"""Dashboard server - serves HTML + proxies API calls to lucas_api"""
import http.server
import urllib.request
import json
import os
import sys

PORT = int(os.environ.get('DASHBOARD_PORT', 8080))
LUCAS_API = 'http://172.17.0.3:3080/api/execute'
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))

class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DASHBOARD_DIR, **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/execute':
            self._proxy_to_lucas()
        else:
            self.send_error(404)

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _proxy_to_lucas(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length else b'{}'

        try:
            req = urllib.request.Request(
                LUCAS_API,
                data=body,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                response_data = resp.read()

            self.send_response(200)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(response_data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'error', 'data': str(e)}).encode())
        except Exception as e:
            self.send_response(500)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'error', 'data': str(e)}).encode())

    def end_headers(self):
        # Add CORS to all responses
        try:
            self.send_header('Access-Control-Allow-Origin', '*')
        except Exception:
            pass
        super().end_headers()

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', PORT), DashboardHandler)
    print(f'📊 Lucas Dashboard Server running on http://0.0.0.0:{PORT}')
    print(f'📍 Proxying API calls to {LUCAS_API}')
    server.serve_forever()