"""SSH ProxyCommand helper: tunnel TCP through an HTTP proxy (CONNECT).

Usage: python httpproxy.py <proxy_host> <proxy_port> <target_host> <target_port>
Relays stdin/stdout after the CONNECT tunnel is established.
"""
import os
import socket, sys, select, threading

proxy_host, proxy_port, target_host, target_port = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])

s = socket.create_connection((proxy_host, proxy_port), timeout=15)
s.sendall(f"CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n\r\n".encode())
buf = b""
while b"\r\n\r\n" not in buf:
    chunk = s.recv(4096)
    if not chunk:
        sys.exit(2)
    buf += chunk
if b" 200 " not in buf.split(b"\r\n")[0]:
    sys.stderr.write(buf.decode(errors="replace"))
    sys.exit(3)
s.settimeout(None)

def pump_in():
    while True:
        data = sys.stdin.buffer.read1(65536)
        if not data:
            try:
                s.shutdown(socket.SHUT_WR)
            except OSError:
                pass
            return
        s.sendall(data)

threading.Thread(target=pump_in, daemon=True).start()
while True:
    try:
        data = s.recv(65536)
    except OSError:
        break
    if not data:
        break
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()
os._exit(0)
