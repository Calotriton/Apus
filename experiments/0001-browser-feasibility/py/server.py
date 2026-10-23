"""Local server for the browser test: serves spike/web with the two headers that turn on
cross-origin isolation (needed for multi-threaded WebAssembly), and saves POSTed results.

    py -I server.py <spike dir> [port]
"""
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SPIKE = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript",
                      ".wasm": "application/wasm", ".onnx": "application/octet-stream"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SPIKE / "web"), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        # POST /results/<name>: the page reports its measurements here
        name = Path(self.path).name or "result"
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        out = SPIKE / "results" / f"{name}.json"
        out.write_bytes(body)
        print(f"{datetime.now():%H:%M:%S} saved {out.name} ({len(body)} bytes)", flush=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if "POST" in fmt % args or " 404 " in fmt % args:
            super().log_message(fmt, *args)


print(f"serving {SPIKE / 'web'} on http://127.0.0.1:{PORT}", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
