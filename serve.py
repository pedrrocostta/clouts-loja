"""Servidor local da CLOUTS (só para desenvolvimento): igual ao http.server, mas SEM cache,
para que qualquer alteração (banners, CSS, JS) apareça ao recarregar a página."""
import http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('', PORT), Handler) as s:
    print(f'CLOUTS local em http://localhost:{PORT}')
    s.serve_forever()
