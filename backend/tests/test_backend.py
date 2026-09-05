"""
test_backend.py — pytest suite for the Pneutn backend.
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

    def test_reject_non_finite_expression(self):
        from safe_parse import safe_parse, ExpressionError
        with pytest.raises(ExpressionError, match="finite"):
            safe_parse("1/0")

    def test_accept_hyperbolic_inverse_function(self):
        from safe_parse import safe_parse
        assert safe_parse("asinh(x)") is not None


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
        assert body["narration"]["status"] in ("not_configured", "active", "error")
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

    def test_nested_chain_rule_does_not_crash(self):
        """Compound inner expressions must be differentiated via a placeholder."""
        status, body = self._solve({
            "expr": "sqrt(x^2+1)/(1+x^2)",
            "operation": "derivative",
            "wrt": "x",
        })
        assert status == 200, body
        assert "x" in body["result_latex"]
        chain_step = next(step for step in body["steps"] if step["rule"] == "chain_rule")
        assert "d}{du}" in chain_step["after_latex"]
        assert "square" not in chain_step["after_latex"]

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

    def test_reject_non_integer_derivative_order(self):
        status, body = self._solve({
            "expr": "x^2", "operation": "derivative", "wrt": "x", "order": "not-an-order"
        })
        assert status == 400, body

    def test_unexpected_calculation_error_is_not_exposed(self, monkeypatch):
        import solve

        def fail(*_args, **_kwargs):
            raise RuntimeError("internal detail should not reach the browser")

        monkeypatch.setattr(solve, "_derivative_steps", fail)
        status, body = self._solve({"expr": "x^2", "operation": "derivative", "wrt": "x"})
        assert status == 500, body
        assert body["message"] == "The service could not process this request."
        assert "internal detail" not in json.dumps(body)


class TestGeminiNarration:
    def test_uses_current_sdk_and_stable_model(self, monkeypatch):
        """Gemini is narration-only and receives already verified step data."""
        import types
        import solve

        calls = []

        class FakeModels:
            def generate_content(self, **kwargs):
                calls.append(kwargs)
                return types.SimpleNamespace(text='["Apply the power rule."]')

        class FakeClient:
            def __init__(self, api_key, **_kwargs):
                assert api_key == "test-key"
                self.models = FakeModels()

        fake_google = types.ModuleType("google")
        fake_google.genai = types.SimpleNamespace(Client=FakeClient)
        fake_google_genai = types.ModuleType("google.genai")
        fake_google_genai.types = types.SimpleNamespace(
            GenerateContentConfig=lambda **kwargs: kwargs,
            HttpOptions=lambda **kwargs: kwargs,
        )
        monkeypatch.setitem(sys.modules, "google", fake_google)
        monkeypatch.setitem(sys.modules, "google.genai", fake_google_genai)
        monkeypatch.setattr(solve, "GEMINI_API_KEY", "test-key")

        steps = [{"rule": "power_rule", "before_latex": "x^2", "after_latex": "2x"}]
        narration = {}
        narrated = solve._gemini_narrate(steps, "x", narration)

        assert calls[0]["model"] == "gemini-2.5-flash"
        assert calls[0]["config"]["response_mime_type"] == "application/json"
        assert narrated[0]["explanation"] == "Apply the power rule."
        assert narrated[0]["narrated_by"] == "gemini"
        assert narration == {"provider": "gemini", "model": "gemini-2.5-flash", "status": "active"}

    def test_reports_safe_provider_error_details(self, monkeypatch):
        import types
        import solve

        class FakeClientError(Exception):
            code = 403
            status = "PERMISSION_DENIED"

        class FakeModels:
            def generate_content(self, **kwargs):
                raise FakeClientError("Do not return provider messages to clients")

        class FakeClient:
            def __init__(self, api_key, **_kwargs):
                self.models = FakeModels()

        fake_google = types.ModuleType("google")
        fake_google.genai = types.SimpleNamespace(Client=FakeClient)
        fake_google_genai = types.ModuleType("google.genai")
        fake_google_genai.types = types.SimpleNamespace(
            GenerateContentConfig=lambda **kwargs: kwargs,
            HttpOptions=lambda **kwargs: kwargs,
        )
        monkeypatch.setitem(sys.modules, "google", fake_google)
        monkeypatch.setitem(sys.modules, "google.genai", fake_google_genai)
        monkeypatch.setattr(solve, "GEMINI_API_KEY", "test-key")

        narration = {}
        narrated = solve._gemini_narrate(
            [{"rule": "power_rule", "before_latex": "x^2", "after_latex": "2x"}],
            "x",
            narration,
        )

        assert narrated[0]["narrated_by"] == "fallback_template"
        assert narration["status"] == "error"
        assert narration["error_type"] == "FakeClientError"
        assert narration["error_code"] == 403
        assert narration["error_status"] == "PERMISSION_DENIED"

    def test_uses_flash_lite_when_flash_is_unavailable(self, monkeypatch):
        import types
        import solve

        calls = []

        class FakeNotFoundError(Exception):
            code = 404
            status = "NOT_FOUND"

        class FakeModels:
            def generate_content(self, **kwargs):
                calls.append(kwargs["model"])
                if kwargs["model"] == solve.GEMINI_MODEL:
                    raise FakeNotFoundError("The preferred model is unavailable")
                return types.SimpleNamespace(text='["Apply the power rule."]')

        class FakeClient:
            def __init__(self, api_key, **_kwargs):
                self.models = FakeModels()

        fake_google = types.ModuleType("google")
        fake_google.genai = types.SimpleNamespace(Client=FakeClient)
        fake_google_genai = types.ModuleType("google.genai")
        fake_google_genai.types = types.SimpleNamespace(
            GenerateContentConfig=lambda **kwargs: kwargs,
            HttpOptions=lambda **kwargs: kwargs,
        )
        monkeypatch.setitem(sys.modules, "google", fake_google)
        monkeypatch.setitem(sys.modules, "google.genai", fake_google_genai)
        monkeypatch.setattr(solve, "GEMINI_API_KEY", "test-key")

        narration = {}
        solve._gemini_narrate(
            [{"rule": "power_rule", "before_latex": "x^2", "after_latex": "2x"}],
            "x",
            narration,
        )

        assert calls == [solve.GEMINI_MODEL, solve.GEMINI_FALLBACK_MODEL]
        assert narration["status"] == "active"
        assert narration["model"] == solve.GEMINI_FALLBACK_MODEL

    def test_discovers_an_available_flash_model_after_not_found(self, monkeypatch):
        import types
        import solve

        calls = []

        class FakeNotFoundError(Exception):
            code = 404
            status = "NOT_FOUND"

        class FakeModels:
            def generate_content(self, **kwargs):
                calls.append(kwargs["model"])
                if kwargs["model"] != "gemini-3.6-flash":
                    raise FakeNotFoundError("Model unavailable")
                return types.SimpleNamespace(text='["Apply the power rule."]')

            def list(self):
                return [
                    types.SimpleNamespace(
                        name="models/gemini-3.6-flash",
                        supported_actions=["generateContent"],
                    )
                ]

        class FakeClient:
            def __init__(self, api_key, **_kwargs):
                self.models = FakeModels()

        fake_google = types.ModuleType("google")
        fake_google.genai = types.SimpleNamespace(Client=FakeClient)
        fake_google_genai = types.ModuleType("google.genai")
        fake_google_genai.types = types.SimpleNamespace(
            GenerateContentConfig=lambda **kwargs: kwargs,
            HttpOptions=lambda **kwargs: kwargs,
        )
        monkeypatch.setitem(sys.modules, "google", fake_google)
        monkeypatch.setitem(sys.modules, "google.genai", fake_google_genai)
        monkeypatch.setattr(solve, "GEMINI_API_KEY", "test-key")

        narration = {}
        solve._gemini_narrate(
            [{"rule": "power_rule", "before_latex": "x^2", "after_latex": "2x"}],
            "x",
            narration,
        )

        assert calls == [
            solve.GEMINI_MODEL,
            solve.GEMINI_FALLBACK_MODEL,
            "gemini-3.6-flash",
        ]
        assert narration["status"] == "active"
        assert narration["model"] == "gemini-3.6-flash"


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

    def test_integration_sequence_non_dict_rejected(self):
        status, body = self._solve({
            "expr": "x^2", "operation": "integral",
            "integration_sequence": ["invalid_item"]
        })
        assert status == 400, body
        assert body["error"] == "malformed_request"


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
            "expr": "x^2", "bounds": [0, 3], "sub_intervals": 200
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

    def test_scalar_bounds_rejected_without_server_error(self):
        status, body = self._riemann({
            "expr": "x^2", "bounds": 5, "sub_intervals": 10
        })
        assert status == 400, body

    def test_non_finite_bounds_rejected(self):
        import riemann
        response = riemann.handle({"expr": "x^2", "bounds": [0, float("inf")], "sub_intervals": 10})
        status, body = parse_response(response)
        assert status == 400, body

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
        assert resp["headers"]["Access-Control-Allow-Origin"] != "*"


# ── HTTP request hardening ───────────────────────────────────────────────

class TestRequestHardening:
    def setup_method(self):
        import app as app_module
        self.handler = app_module.handler

    def test_rejects_json_arrays(self):
        event = make_event("/solve", [])
        status, body = parse_response(self.handler(event, None))
        assert status == 400, body
        assert body["error"] == "malformed_request"

    def test_rejects_invalid_base64(self):
        event = make_event("/solve", {})
        event["body"] = "not valid base64!"
        event["isBase64Encoded"] = True
        status, body = parse_response(self.handler(event, None))
        assert status == 400, body

    def test_rejects_non_finite_json_number(self):
        event = make_event("/solve", {})
        event["body"] = '{"expr":"x","operation":"integral","bounds":[NaN,1]}'
        status, body = parse_response(self.handler(event, None))
        assert status == 400, body

    def test_rejects_unsupported_method(self):
        event = make_event("/solve", {})
        event["requestContext"]["http"]["method"] = "GET"
        status, body = parse_response(self.handler(event, None))
        assert status == 405, body


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
