"""Development server: the repository at http://127.0.0.1:8000/app/, with the headers that turn on
cross-origin isolation (multi-threaded WebAssembly) and the local model in /model/.

    py tools/serve.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".wasm": "application/wasm", ".onnx": "application/octet-stream"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if " 404 " in fmt % args or " 500 " in fmt % args:
            super().log_message(fmt, *args)


print(f"Apus: http://127.0.0.1:{PORT}/app/", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
