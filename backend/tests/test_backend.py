"""
test_backend.py — pytest suite for the Pneuton backend.
Run from backend/ directory:  python -m pytest tests/ -v
"""
import json
import sys
import os

# Add src/api to path so imports work without Lambda runtime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src', 'api'))

import pytest


# ── Helpers ───────────────────────────────────────────────────────────────

def make_event(path, body):
    """Minimal HTTP API v2 event envelope."""
    return {
        "requestContext": {"http": {"method": "POST", "path": path}},
        "body": json.dumps(body),
        "isBase64Encoded": False,
    }


def parse_response(resp):
    """Unwrap the Lambda response body."""
    assert isinstance(resp, dict), f"Response is not a dict: {resp}"
    assert "statusCode" in resp, f"No statusCode: {resp}"
    body = json.loads(resp["body"])
    return resp["statusCode"], body


# ── safe_parse ────────────────────────────────────────────────────────────

class TestSafeParse:
    def test_simple_polynomial(self):
        from safe_parse import safe_parse
        expr = safe_parse("x^2 + 2*x + 1")
        import sympy
        assert expr is not None

    def test_trig_function(self):
        from safe_parse import safe_parse
        expr = safe_parse("sin(x)*cos(x)")
        assert expr is not None

    def test_reject_dunder(self):
        from safe_parse import safe_parse, ExpressionError
        with pytest.raises(ExpressionError):
            safe_parse("__import__('os').system('ls')")

    def test_reject_disallowed_variable(self):
        from safe_parse import safe_parse, ExpressionError
        # 'a' is not in ALLOWED_SYMBOLS
        # This only fails if 'a' can't be parsed as a symbol — it may parse but
        # fail at the post-parse validation step
        with pytest.raises(ExpressionError):
            safe_parse("a^2")

    def test_reject_too_long(self):
        from safe_parse import safe_parse, ExpressionError
        with pytest.raises(ExpressionError):
            safe_parse("x" * 201)

    def test_implicit_multiplication(self):
        from safe_parse import safe_parse
        import sympy
        expr = safe_parse("2x")
        assert expr == sympy.sympify("2*x")


# ── /solve ────────────────────────────────────────────────────────────────

class TestSolveDerivative:
    def setup_method(self):
        import app as app_module
        self.handler = app_module.handler

    def _solve(self, body):
        resp = self.handler(make_event("/solve", body), None)
        return parse_response(resp)

    def test_power_rule(self):
        status, body = self._solve({"expr": "x^3", "operation": "derivative", "wrt": "x"})
        assert status == 200, body
        assert "result_latex" in body
        # d/dx x^3 = 3x^2
        assert "3" in body["result_latex"]
        assert "x" in body["result_latex"]

    def test_constant_is_zero(self):
        status, body = self._solve({"expr": "5", "operation": "derivative", "wrt": "x"})
        assert status == 200, body
        assert body["result_latex"] in ("0", "0.0", "\\mathtt{0}")

    def test_trig_derivative(self):
        status, body = self._solve({"expr": "sin(x)", "operation": "derivative", "wrt": "x"})
        assert status == 200, body
        assert "cos" in body["result_latex"]

    def test_product_rule(self):
        status, body = self._solve({"expr": "x^2*sin(x)", "operation": "derivative", "wrt": "x"})
        assert status == 200, body
        assert status == 200
        assert "result_latex" in body

    def test_second_order_derivative(self):
        status, body = self._solve({"expr": "x^4", "operation": "derivative", "wrt": "x", "order": 2})
        assert status == 200, body
        # d²/dx² x^4 = 12x^2
        assert "12" in body["result_latex"]

    def test_steps_returned(self):
        status, body = self._solve({"expr": "x^2", "operation": "derivative", "wrt": "x"})
        assert status == 200, body
        assert isinstance(body.get("steps"), list)
        assert len(body["steps"]) >= 1
        step = body["steps"][0]
        assert "before_latex" in step
        assert "after_latex" in step
        assert "rule" in step
        assert "explanation" in step
        assert "narrated_by" in step

    def test_numeric_sample_returned(self):
        status, body = self._solve({"expr": "x^2", "operation": "derivative", "wrt": "x"})
        assert status == 200, body
        assert isinstance(body.get("result_numeric_sample"), list)
        assert len(body["result_numeric_sample"]) > 0

    def test_invalid_expr_rejected(self):
        status, body = self._solve({"expr": "__import__('os')", "operation": "derivative", "wrt": "x"})
        assert status in (400, 422), body

    def test_missing_expr_rejected(self):
        status, body = self._solve({"expr": "", "operation": "derivative", "wrt": "x"})
        assert status == 400, body

    def test_partial_derivative_y(self):
        status, body = self._solve({"expr": "x^2*y^3", "operation": "derivative", "wrt": "x"})
        assert status == 200, body
        assert "y" in body["result_latex"] or "2" in body["result_latex"]


class TestSolveIntegral:
    def setup_method(self):
        import app as app_module
        self.handler = app_module.handler

    def _solve(self, body):
        resp = self.handler(make_event("/solve", body), None)
        return parse_response(resp)

    def test_indefinite_integral(self):
        status, body = self._solve({"expr": "x^2", "operation": "integral", "wrt": "x"})
        assert status == 200, body
        assert "result_latex" in body
        # ∫x² dx = x³/3
        assert "3" in body["result_latex"]

    def test_definite_integral(self):
        status, body = self._solve({
            "expr": "x^2", "operation": "integral", "wrt": "x",
            "bounds": [0, 3]
        })
        assert status == 200, body
        # ∫₀³ x² dx = 9
        assert "9" in body["result_latex"]

    def test_trig_integral(self):
        status, body = self._solve({"expr": "cos(x)", "operation": "integral", "wrt": "x"})
        assert status == 200, body
        assert "sin" in body["result_latex"]

    def test_integral_steps_have_bounds_evaluation(self):
        status, body = self._solve({
            "expr": "x^2", "operation": "integral", "wrt": "x",
            "bounds": [0, 1]
        })
        assert status == 200, body
        rules = [s["rule"] for s in body["steps"]]
        assert "evaluate_bounds" in rules


# ── /riemann ─────────────────────────────────────────────────────────────

class TestRiemann:
    def setup_method(self):
        import app as app_module
        self.handler = app_module.handler

    def _riemann(self, body):
        resp = self.handler(make_event("/riemann", body), None)
        return parse_response(resp)

    def test_basic_riemann(self):
        status, body = self._riemann({
            "expr": "x^2", "bounds": [0, 3], "sub_intervals": 10
        })
        assert status == 200, body
        assert "rectangles" in body
        assert len(body["rectangles"]) == 10
        assert "riemann_sum" in body
        assert "exact_value" in body

    def test_exact_value_correct(self):
        status, body = self._riemann({
            "expr": "x^2", "bounds": [0, 3], "sub_intervals": 1000
        })
        assert status == 200, body
        # ∫₀³ x² dx = 9, Riemann with 1000 intervals should be close
        assert abs(body["riemann_sum"] - 9.0) < 0.1

    def test_sample_points(self):
        for sp in ["left", "midpoint", "right"]:
            status, body = self._riemann({
                "expr": "x^2", "bounds": [0, 2], "sub_intervals": 8, "sample_point": sp
            })
            assert status == 200, f"Failed for sample_point={sp}: {body}"

    def test_bad_bounds_rejected(self):
        status, body = self._riemann({
            "expr": "x^2", "bounds": [3, 0], "sub_intervals": 10
        })
        assert status in (400, 422), body

    def test_rectangles_shape(self):
        status, body = self._riemann({
            "expr": "x^2", "bounds": [0, 2], "sub_intervals": 5
        })
        assert status == 200, body
        rect = body["rectangles"][0]
        assert "x0" in rect
        assert "x1" in rect
        assert "height" in rect


# ── CORS headers ──────────────────────────────────────────────────────────

class TestCORS:
    def setup_method(self):
        import app as app_module
        self.handler = app_module.handler

    def test_options_preflight(self):
        event = {
            "requestContext": {"http": {"method": "OPTIONS", "path": "/solve"}},
            "body": "",
        }
        resp = self.handler(event, None)
        assert resp["statusCode"] == 204
        assert "Access-Control-Allow-Origin" in resp["headers"]

    def test_cors_on_solve_response(self):
        event = make_event("/solve", {"expr": "x^2", "operation": "derivative", "wrt": "x"})
        resp = self.handler(event, None)
        assert "Access-Control-Allow-Origin" in resp.get("headers", {})


# ── Route not found ───────────────────────────────────────────────────────

class TestRouting:
    def setup_method(self):
        import app as app_module
        self.handler = app_module.handler

    def test_unknown_route(self):
        event = make_event("/does-not-exist", {})
        status, body = parse_response(self.handler(event, None))
        assert status == 404

    def test_bad_json_body(self):
        event = {
            "requestContext": {"http": {"method": "POST", "path": "/solve"}},
            "body": "{not valid json",
        }
        status, body = parse_response(self.handler(event, None))
        assert status == 400
