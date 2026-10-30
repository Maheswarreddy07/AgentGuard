"""Password hashing + token helpers (stdlib only; PBKDF2-HMAC-SHA256 with per-user salt)."""
import base64, hashlib, hmac, os, re, secrets

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")
def _b(x: bytes) -> str: return base64.b64encode(x).decode()

def hash_password(pw: str, iters: int | None = None) -> str:
    iters = iters or int(os.getenv("AUTH_PBKDF2_ITERATIONS", "600000"))
    salt = os.urandom(16)
    return f"pbkdf2_sha256${iters}${_b(salt)}${_b(hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, iters))}"

def verify_password(pw: str, stored: str) -> bool:
    try:
        _, iters, salt, dk = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(salt), int(iters))
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except Exception:
        return False

_DUMMY: str | None = None
def burn_time(pw: str) -> None:
    """Spend the same time as a real check so unknown emails can't be told apart by timing."""
    global _DUMMY
    _DUMMY = _DUMMY or hash_password("not-a-real-password")
    verify_password(pw, _DUMMY)

def min_password_length() -> int: return int(os.getenv("AUTH_MIN_PASSWORD", "10"))

def password_problem(pw: str, email: str = "") -> str | None:
    if len(pw) < min_password_length():
        return f"Password must be at least {min_password_length()} characters."
    if email and pw.lower() == email.lower():
        return "Password must not be the same as the email."
    return None

def sha(t: str) -> str: return hashlib.sha256(t.encode()).hexdigest()
def new_session_token() -> str: return secrets.token_urlsafe(32)
def new_api_key() -> str: return "ag_" + secrets.token_urlsafe(30)
