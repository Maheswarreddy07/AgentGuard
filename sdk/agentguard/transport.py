import json, urllib.error, urllib.request
from agentguard.errors import AgentGuardError, AgentGuardUnavailable

class HttpTransport:
    """Dependency-free HTTP transport with explicit timeouts. Any object with request(method, path, body) can replace it (tests, in-process use)."""
    def __init__(self, base_url: str, api_key: str | None, timeout: float = 10.0):
        self.base, self.key, self.timeout = base_url.rstrip("/"), api_key, timeout
    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(self.base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {self.key}"} if self.key else {})})
        try:
            return json.loads(urllib.request.urlopen(req, timeout=self.timeout).read() or b"{}")
        except urllib.error.HTTPError as e:
            try: msg = json.loads(e.read()).get("error", {}).get("message", "")
            except Exception: msg = ""
            if e.code >= 500: raise AgentGuardUnavailable(f"server error {e.code}")
            raise AgentGuardError(e.code, msg or e.reason)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise AgentGuardUnavailable(str(e))
