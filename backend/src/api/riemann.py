"""
riemann.py — /riemann route handler.

Given an expression, bounds [a, b], sub-interval count n, and a sample-point
strategy (left / midpoint / right), returns the rectangle data for Riemann
sum visualization.

See API_SPEC.md for the exact request/response shape.
See SECURITY_POLICY.md §2 for the sub-interval cap (200 max).
"""
import json
import logging
import math
import sympy
from sympy import symbols, integrate, latex

from safe_parse import safe_parse, ExpressionError
from computation_guard import ComputationTimeout, calculation_timeout

logger = logging.getLogger(__name__)


def _error(code: str, message: str, status: int = 422) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"error": code, "message": message}),
    }


def handle(body: dict) -> dict:
    """
    Handle POST /riemann.

    Request body fields (see API_SPEC.md):
      expr          string  required  Math expression
      bounds        list    required  [a, b] with a < b
      sub_intervals int     required  1–200
      sample_point  string  optional  "left" | "midpoint" | "right" (default "midpoint")
    """
    expr_str = body.get("expr", "")
    bounds = body.get("bounds", None)
    n_raw = body.get("sub_intervals", None)
    sample_point = body.get("sample_point", "midpoint")

    # --- Validate ---
    if not expr_str:
        return _error("malformed_request", "Field 'expr' is required.", 400)
    if not isinstance(bounds, list) or len(bounds) != 2:
        return _error("malformed_request", "Field 'bounds' must be [a, b].", 400)
    if n_raw is None:
        return _error("malformed_request", "Field 'sub_intervals' is required.", 400)
    if sample_point not in ("left", "midpoint", "right"):
        return _error("malformed_request", "'sample_point' must be 'left', 'midpoint', or 'right'.", 400)

    try:
        a = float(bounds[0])
        b = float(bounds[1])
    except (TypeError, ValueError, OverflowError):
        return _error("malformed_request", "Bounds must be numbers.", 400)

    if not math.isfinite(a) or not math.isfinite(b):
        return _error("malformed_request", "Bounds must be finite numbers.", 400)

    if a >= b:
        return _error("malformed_request", "bounds[0] must be less than bounds[1].", 400)

    # Validate sub_intervals — must be convertible to an integer (req 2.21, 2.22)
    try:
        n_float = float(n_raw)          # allows "8.0" → 8
        if n_float != int(n_float):
            return _error("malformed_request",
                          "'sub_intervals' must be an integer.", 400)
        n = max(1, min(int(n_float), 200))
    except (TypeError, ValueError, OverflowError):
        return _error("malformed_request",
                      "'sub_intervals' must be an integer.", 400)

    # --- Safe-parse expression ---
    try:
        expr = safe_parse(expr_str)
    except ExpressionError as e:
        return _error("invalid_expression", str(e))

    x = symbols("x")

    try:
        # Build rectangle data
        with calculation_timeout(12):
            dx = (b - a) / n
            rectangles = []
            riemann_sum = 0.0

            for i in range(n):
                x0 = a + i * dx
                x1 = x0 + dx

                if sample_point == "left":
                    sample_x = x0
                elif sample_point == "right":
                    sample_x = x1
                else:  # midpoint
                    sample_x = (x0 + x1) / 2

                try:
                    height = float(expr.subs(x, sample_x).evalf())
                    if not math.isfinite(height):
                        height = 0.0
                except Exception:
                    height = 0.0

                rectangles.append({
                    "x0": round(x0, 8),
                    "x1": round(x1, 8),
                    "height": round(height, 8),
                })
                riemann_sum += height * dx

            # Compute exact definite integral
            try:
                exact_sym = integrate(expr, (x, a, b))
                exact_value = float(exact_sym.evalf())
                if not math.isfinite(exact_value):
                    exact_value = None
            except Exception:
                exact_value = None

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "rectangles": rectangles,
                "riemann_sum": round(riemann_sum, 8),
                "exact_value": round(exact_value, 8) if exact_value is not None else None,
            }),
        }

    except ComputationTimeout:
        return _error("computation_timeout",
                      "This expression is too complex to solve within the time limit.", 504)
    except Exception:
        logger.exception("Unhandled /riemann calculation failure.")
        return _error("internal_error", "The service could not process this request.", 500)
