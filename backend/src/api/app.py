"""
app.py — single Lambda handler with route dispatch.

One function, not three — one cold start per session.
See ARCHITECTURE.md §2 for the rationale.
"""
import json
import os

import solve
import riemann
import integral_order

# ── CORS headers added to every response ──────────────────────────────────
_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": _ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
}


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def handler(event, context):
    """AWS Lambda entry point — HTTP API v2 payload format."""

    # Handle CORS pre-flight
    method = (
        event.get("requestContext", {}).get("http", {}).get("method", "")
        or event.get("httpMethod", "")
    ).upper()
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS_HEADERS, "body": ""}

    # Extract route
    try:
        route = event["requestContext"]["http"]["path"]
    except (KeyError, TypeError):
        return _resp(400, {"error": "malformed_request", "message": "Missing request context."})

    # Parse body
    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64
        raw_body = base64.b64decode(raw_body).decode("utf-8")

    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        return _resp(400, {"error": "malformed_request", "message": "Request body is not valid JSON."})

    # Route dispatch — each handler returns a dict with statusCode + body string
    if route == "/solve":
        inner = solve.handle(body)
    elif route == "/riemann":
        inner = riemann.handle(body)
    elif route == "/integral-order":
        inner = integral_order.handle(body)
    else:
        return _resp(404, {"error": "not_found", "message": f"Unknown route: {route}"})

    # Merge CORS headers into the handler's response
    inner["headers"] = {**CORS_HEADERS, **inner.get("headers", {})}
    return inner
