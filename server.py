import http.server

if __name__ == '__main__':
    http.server.HTTPServer(('', 8080), http.server.SimpleHTTPRequestHandler).serve_forever()
