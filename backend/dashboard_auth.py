import hashlib
import hmac
import os
import secrets
import smtplib
import ssl
from pathlib import Path
from email.message import EmailMessage


SECRET_FILE = Path("/run/secrets/dashboard-auth.env")


def _setting(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is not None:
        return value
    try:
        for line in SECRET_FILE.read_text(encoding="utf-8").splitlines():
            key, sep, item = line.partition("=")
            if sep and key.strip() == name:
                return item.strip()
    except OSError:
        pass
    return default


def _secret() -> bytes:
    value = _setting("DASHBOARD_AUTH_SECRET")
    if len(value) < 32:
        raise RuntimeError("DASHBOARD_AUTH_SECRET must contain at least 32 characters")
    return value.encode()


def make_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def otp_hash(email: str, otp: str) -> str:
    return hmac.new(_secret(), f"otp:{email}:{otp}".encode(), hashlib.sha256).hexdigest()


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return f"pbkdf2_sha256$600000${salt.hex()}${digest.hex()}"


def password_matches(password: str, encoded: str | None) -> bool:
    try:
        algorithm, rounds, salt, expected = (encoded or "").split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def send_otp(email: str, otp: str) -> None:
    host = _setting("SMTP_HOST")
    username = _setting("SMTP_USERNAME")
    password = _setting("SMTP_PASSWORD")
    sender = _setting("SMTP_FROM", username)
    port = int(_setting("SMTP_PORT", "587"))
    if not all((host, username, password, sender)):
        raise RuntimeError("OTP email service is not configured")
    message = EmailMessage()
    message["Subject"] = "Your F&O Pilot verification code"
    message["From"] = sender
    message["To"] = email
    message.set_content(f"Your F&O Pilot verification code is {otp}. It expires in 10 minutes.\n\nIf you did not request this code, ignore this email.")
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(username, password)
        smtp.send_message(message)
