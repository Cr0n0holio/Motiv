"""Tar fram förhandsbilderna för mallarna (ui/img/mallar/*.webp).

Kör från projektmappen:  python verktyg/mallbilder.py
Öppna sedan http://localhost:8010/verktyg/mallbilder.html i en webbläsare.
Sidan renderar varje mall med appens egen kod och skickar bilderna hit,
där de sparas. Kör igen när en mall har ändrats eller lagts till.
"""
import functools
import http.server
import re
from pathlib import Path

ROT = Path(__file__).resolve().parent.parent
UT = ROT / "ui" / "img" / "mallar"
PORT = 8010


class Hanterare(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        namn = self.path.rsplit("/", 1)[-1]
        if not self.path.startswith("/spara/") or not re.fullmatch(r"[a-z0-9-]+\.webp", namn):
            self.send_error(400, "Ogiltigt filnamn")
            return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        UT.mkdir(parents=True, exist_ok=True)
        (UT / namn).write_bytes(data)
        print(f"Sparade {namn} ({len(data) // 1024} kB)")
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    print(f"Öppna http://localhost:{PORT}/verktyg/mallbilder.html  (Ctrl+C avslutar)")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Hanterare, directory=str(ROT))).serve_forever()
