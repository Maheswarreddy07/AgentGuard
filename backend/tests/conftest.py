import os
# Legacy API tests run with auth off; test_auth.py turns it on explicitly. Fast password hashing for tests.
os.environ.setdefault("AUTH_REQUIRED", "0")
os.environ["AUTH_PBKDF2_ITERATIONS"] = "1000"
