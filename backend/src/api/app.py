"""
app.py — single Lambda handler with route dispatch.

One function, not three — one cold start per session.
See ARCHITECTURE.md §2 for the rationale.
"""
import json
import os
import base64
import binascii
import logging

import solve
import riemann
import integral_order

logger = logging.getLogger(__name__)

# ── CORS ──────────────────────────────────────────────────────────────────
# HTTP API Gateway (v2) handles CORS at the API layer via template.yaml.
# We still set these headers on Lambda responses as a belt-and-suspenders
# measure (some API GW configurations pass them through unchanged).
DEFAULT_ALLOWED_ORIGIN = "https://main.d374q6vzj4flmw.amplifyapp.com"
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", DEFAULT_ALLOWED_ORIGIN) or DEFAULT_ALLOWED_ORIGIN
MAX_REQUEST_BODY_BYTES = 16_384

CORS_HEADERS = {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": _ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"content-type",
}


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def _reject_json_constant(_constant: str):
    """Reject NaN and Infinity, which Python's JSON parser accepts by default."""
    raise ValueError("Non-finite JSON numbers are not supported.")


def _parse_request_body(event: dict) -> dict:
    raw_body = event.get("body")
    if raw_body is None:
        raw_body = "{}"
    if not isinstance(raw_body, str):
        raise ValueError("Request body must be a UTF-8 JSON string.")

    # Base64 expands payloads by about one-third, so cap the encoded form
    # before decoding as well as the final UTF-8 bytes.
    if len(raw_body.encode("utf-8")) > MAX_REQUEST_BODY_BYTES * 2:
        raise ValueError("Request body is too large.")

    if event.get("isBase64Encoded"):
        try:
            raw_bytes = base64.b64decode(raw_body, validate=True)
            raw_body = raw_bytes.decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as exc:
            raise ValueError("Request body is not valid base64-encoded UTF-8.") from exc

    if len(raw_body.encode("utf-8")) > MAX_REQUEST_BODY_BYTES:
        raise ValueError("Request body is too large.")

    body = json.loads(raw_body, parse_constant=_reject_json_constant)
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object.")
    return body


def handler(event, context):
    """AWS Lambda entry point — HTTP API v2 payload format."""

    # ── CORS pre-flight ────────────────────────────────────────────────
    method = (
        event.get("requestContext", {}).get("http", {}).get("method", "")
        or event.get("httpMethod", "")
    ).upper()
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS_HEADERS, "body": ""}
    if method != "POST":
        return _resp(405, {"error": "method_not_allowed",
                           "message": "Only POST is supported for this route."})

    # ── Extract route ─────────────────────────────────────────────────
    try:
        route = event["requestContext"]["http"]["path"]
    except (KeyError, TypeError):
        return _resp(400, {"error": "malformed_request",
                           "message": "Missing request context."})

    # ── Parse body ────────────────────────────────────────────────────
    try:
        body = _parse_request_body(event)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return _resp(400, {"error": "malformed_request",
                           "message": "Request body must be a valid JSON object smaller than 16 KB."})

    # ── Route dispatch ────────────────────────────────────────────────
    try:
        if route == "/solve":
            inner = solve.handle(body)
        elif route == "/riemann":
            inner = riemann.handle(body)
        elif route == "/integral-order":
            inner = integral_order.handle(body)
        else:
            return _resp(404, {"error": "not_found",
                               "message": "Unknown API route."})
    except Exception:
        logger.exception("Unhandled API route failure.")
        return _resp(500, {"error": "internal_error",
                           "message": "The service could not process this request."})

    # Ensure CORS headers are present on every response
    inner.setdefault("headers", {})
    inner["headers"] = {**CORS_HEADERS, **inner["headers"]}
    return inner
