from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse


ROUTE_MAP = {
    "/": "/index.html",
    "/login": "/login.html",
    "/signup": "/signup.html",
    "/dashboard": "/dashboard.html",
    "/forgot-password": "/forgot-password.html",
}


class RewritingHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        clean = path.split("?", 1)[0].split("#", 1)[0]
        mapped = ROUTE_MAP.get(clean, clean)
        self.path = mapped + ("" if "?" not in path else "?" + path.split("?", 1)[1])
        return super().translate_path(mapped)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--root", type=str, default=str(Path(__file__).resolve().parents[2] / "website_static_backup"))
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"Root does not exist: {root}")

    class RootedHandler(RewritingHandler):
        def __init__(self, *handler_args, **handler_kwargs):
            super().__init__(*handler_args, directory=str(root), **handler_kwargs)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), RootedHandler)
    print(f"Serving {root} on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
