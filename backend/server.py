"""Local server: serves the visual and runs the existing real-model trace generator."""
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import NamedTemporaryFile

# Windows 콘솔은 기본 코드페이지(cp949 등)를 쓰는 경우가 많아서, 모델 답변에 그
# 코드페이지로 표현 못 하는 문자(한자 등)가 섞이면 print()가 죽어서 요청을 처리하던
# 스레드가 응답도 못 보낸 채 그대로 죽는다 — 그래서 "서버가 닫힌 것" 처럼 보인다.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from generate import run

ROOT = Path(__file__).resolve().parent.parent

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "frontend"), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path != "/api/generate":
            self.send_error(404); return
        length = int(self.headers.get("Content-Length", 0))
        question = json.loads(self.rfile.read(length)).get("question", "").strip()
        if not question:
            self.send_error(400, "question is required"); return
        with NamedTemporaryFile(suffix=".json", delete=False) as temp:
            output = Path(temp.name)
        try:
            run(question, output)
            payload = output.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers(); self.wfile.write(payload)
        finally:
            output.unlink(missing_ok=True)

if __name__ == "__main__":
    print("server started")
    ThreadingHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
