"""
solve.py — /solve route handler.

Pipeline:
1. Validate + safe-parse via safe_parse().
2. SymPy computes derivative or integral with granular sub-step extraction.
3. Gemini 2.5 Flash narrates each step in plain English (fallback: templates).
4. Return result_latex, result_numeric_sample, steps[].

Steps are intentionally granular — each rule application is its own step,
including sub-steps for sums, products, and chain rule expansions.
See ARCHITECTURE.md §3.
"""
import json
import logging
import math
import os
import time
import sympy
from sympy.core.sympify import SympifyError
from sympy import (
    symbols, diff, integrate, latex,
    Symbol, Add, Mul, Pow, Function,
    sin, cos, tan, exp, log, sqrt,
    asin, acos, atan, sinh, cosh, tanh,
    Rational, Integer,
)

from safe_parse import safe_parse, ExpressionError
from computation_guard import ComputationTimeout, calculation_timeout

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"
# Google exposes models per project and may retire or phase availability by
# endpoint. Flash-Lite is sufficient for narration and avoids taking down a
# correct solve when the preferred model is unavailable to a project.
GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite"
_MODEL_PREFERENCE = (
    GEMINI_MODEL,
    GEMINI_FALLBACK_MODEL,
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
)
GEMINI_REQUEST_TIMEOUT_MS = 10_000
GEMINI_MAX_OUTPUT_TOKENS = 512

# ── Narration templates ─────────────────────────────────────────────────────
_NARRATION = {
    "constant":             "Since this expression has no {wrt}, its derivative is 0.",
    "power_rule":           "Power Rule: bring the exponent down as a coefficient, then decrease the exponent by 1.",
    "product_rule":         "Product Rule: d/d{wrt}[u·v] = u·(dv/d{wrt}) + v·(du/d{wrt}).",
    "quotient_rule":        "Quotient Rule: d/d{wrt}[u/v] = (v·u' - u·v') / v².",
    "chain_rule":           "Chain Rule: differentiate the outer function, then multiply by the derivative of the inner function.",
    "sum_rule":             "Sum Rule: the derivative of each term is computed independently.",
    "constant_factor":      "Constant Multiple Rule: pull the constant coefficient outside the derivative.",
    "trig_rule":            "Standard trigonometric derivative identity applied directly.",
    "exp_rule":             "The derivative of eˣ with respect to x is eˣ.",
    "log_rule":             "The derivative of ln(x) with respect to x is 1/x.",
    "u_substitution":       "Use u-substitution — let u equal the inner expression, then integrate with respect to u.",
    "integration_by_parts": "Integration by Parts: ∫u dv = uv - ∫v du.",
    "power_rule_integral":  "Reverse Power Rule: increase the exponent by 1, then divide by the new exponent.",
    "trig_integral":        "Standard trigonometric integral identity.",
    "exp_integral":         "The integral of eˣ with respect to x is eˣ.",
    "log_integral":         "The integral of 1/x is ln|x|.",
    "sum_rule_integral":    "Linearity of integration: split the integral across each term.",
    "evaluate_bounds":      "Evaluate the antiderivative at the upper limit and subtract its value at the lower limit.",
    "simplify":             "Simplify the expression by combining like terms or applying algebraic identities.",
    "default":              "Apply the appropriate calculus transformation to this expression.",
}

def _narrate(rule: str, wrt: str = "x") -> str:
    return _NARRATION.get(rule, _NARRATION["default"]).replace("{wrt}", wrt)


# ── Gemini narration ────────────────────────────────────────────────────────

def _available_narration_models(client) -> list[str]:
    """Return usable text Flash models exposed to this API key's project."""
    try:
        available = set()
        for model in client.models.list():
            name = getattr(model, "name", "")
            actions = getattr(model, "supported_actions", None) or []
            model_id = name.removeprefix("models/")
            if (
                model_id.startswith("gemini-")
                and "flash" in model_id
                and not any(kind in model_id for kind in ("image", "audio", "tts", "live"))
                and (not actions or "generateContent" in actions)
            ):
                available.add(model_id)
        return [model for model in _MODEL_PREFERENCE if model in available]
    except Exception as exc:
        logger.warning("Could not list Gemini models (%s); using configured fallbacks.", type(exc).__name__)
        return []


def _gemini_narrate(
    steps: list[dict], wrt: str, narration: dict | None = None
) -> list[dict]:
    """Narrate verified SymPy steps with Gemini, or use deterministic text."""
    narration = narration if narration is not None else {}
    narration.update({"provider": "gemini", "model": GEMINI_MODEL})
    if not GEMINI_API_KEY:
        narration["status"] = "not_configured"
        return _fallback_narrate(steps, wrt)
    try:
        # google-generativeai and gemini-2.0-flash are both retired.  Use the
        # supported Google Gen AI SDK and a stable model instead.  The key is
        # supplied only from Lambda's environment; it is never logged or sent
        # to the browser.
        from google import genai
        from google.genai import types
        client = genai.Client(
            api_key=GEMINI_API_KEY,
            # A plain mapping keeps this compatible across supported
            # google-genai 1.x releases while bounding a public request.
            http_options={"timeout": GEMINI_REQUEST_TIMEOUT_MS},
        )

        lines = [
            f"Step {i+1}: Rule={s['rule']}. Before={s['before_latex']}. After={s['after_latex']}."
            for i, s in enumerate(steps)
        ]
        prompt = (
            "You are a calculus tutor. The following steps were computed CORRECTLY by SymPy. "
            "Do NOT change any math. For each step write one clear sentence explaining "
            "what transformation was applied and why, for an undergraduate student. "
            "Return only a JSON array of strings, one sentence per input step, in the same order.\n\n"
            + "\n".join(lines)
        )
        response = None
        selected_model = GEMINI_MODEL
        model_not_found_error = None
        attempted_models = []
        candidate_models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL]
        narration_deadline = time.monotonic() + (GEMINI_REQUEST_TIMEOUT_MS / 1000)

        while candidate_models:
            if time.monotonic() >= narration_deadline:
                raise TimeoutError("Gemini narration exceeded its time budget.")
            candidate_model = candidate_models.pop(0)
            if candidate_model in attempted_models:
                continue
            attempted_models.append(candidate_model)
            try:
                response = client.models.generate_content(
                    model=candidate_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        max_output_tokens=GEMINI_MAX_OUTPUT_TOKENS,
                        temperature=0,
                    ),
                )
                selected_model = candidate_model
                break
            except Exception as exc:
                if getattr(exc, "code", None) != 404:
                    raise
                model_not_found_error = exc
                logger.info("Gemini model %s is unavailable; trying fallback.", candidate_model)
                if candidate_model == GEMINI_FALLBACK_MODEL:
                    candidate_models.extend(_available_narration_models(client))
        if response is None:
            narration["models_tried"] = attempted_models
            raise model_not_found_error or RuntimeError("No compatible Gemini narration model found.")
        narrations = json.loads(response.text or "")
        if (
            not isinstance(narrations, list)
            or not all(isinstance(narration, str) and narration.strip() for narration in narrations)
        ):
            raise ValueError("Gemini did not return a JSON array of non-empty narration strings.")
        for i, step in enumerate(steps):
            step["explanation"]  = narrations[i] if i < len(narrations) else _narrate(step["rule"], wrt)
            step["narrated_by"]  = "gemini" if i < len(narrations) else "fallback_template"
        narration.update({"status": "active", "model": selected_model})
        logger.info("Gemini narrated %d verified SymPy steps with %s.", len(steps), selected_model)
        return steps
    except Exception as exc:
        # This deliberately excludes exception text: provider messages can
        # include request metadata, while the exception class is enough for
        # safe production diagnosis from the client response.
        narration.update({"status": "error", "error_type": type(exc).__name__})
        error_code = getattr(exc, "code", None)
        error_status = getattr(exc, "status", None)
        if isinstance(error_code, int):
            narration["error_code"] = error_code
        if isinstance(error_status, str) and error_status.isupper():
            narration["error_status"] = error_status
        logger.warning("Gemini narration failed (%s: %s); falling back to templates.",
                       type(exc).__name__, str(exc)[:200])
        return _fallback_narrate(steps, wrt)


def _fallback_narrate(steps: list[dict], wrt: str = "x") -> list[dict]:
    for step in steps:
        step["explanation"] = _narrate(step["rule"], wrt)
        step["narrated_by"] = "fallback_template"
    return steps


# ── Rule detection ──────────────────────────────────────────────────────────

def _diff_rule(expr: sympy.Expr, wrt: Symbol) -> str:
    if not expr.has(wrt):
        return "constant"
    if isinstance(expr, Add):
        return "sum_rule"
    if isinstance(expr, Mul):
        non_wrt = [a for a in expr.args if not a.has(wrt)]
        wrt_args = [a for a in expr.args if a.has(wrt)]
        if non_wrt and len(wrt_args) == 1:
            return "constant_factor"
        return "product_rule"
    if isinstance(expr, Pow):
        base, exp_ = expr.args
        if base == wrt and not exp_.has(wrt):
            return "power_rule"
        if not base.has(wrt):
            return "chain_rule"
        if base.has(wrt) and not exp_.has(wrt):
            return "power_rule" if isinstance(base, Symbol) else "chain_rule"
        return "chain_rule"
    if isinstance(expr, (sin, cos, tan, asin, acos, atan, sinh, cosh, tanh)):
        return "chain_rule" if expr.args[0] != wrt else "trig_rule"
    if isinstance(expr, (exp,)):
        return "chain_rule" if expr.args[0] != wrt else "exp_rule"
    if isinstance(expr, (log, sqrt)):
        return "chain_rule" if expr.args[0] != wrt else "log_rule"
    if expr.is_number:
        return "constant"
    return "default"


def _int_rule(expr: sympy.Expr, wrt: Symbol) -> str:
    if not expr.has(wrt):
        return "constant_factor"
    if isinstance(expr, Add):
        return "sum_rule_integral"
    if isinstance(expr, Pow):
        base, exp_ = expr.args
        if base == wrt and not exp_.has(wrt):
            return "log_integral" if exp_ == -1 else "power_rule_integral"
    if isinstance(expr, (sin, cos, tan)):
        return "trig_integral"
    if isinstance(expr, exp):
        return "exp_integral"
    if isinstance(expr, log):
        return "u_substitution"
    if isinstance(expr, Mul):
        return "u_substitution"
    if isinstance(expr, Symbol) and expr == wrt:
        return "power_rule_integral"
    return "default"


# ── Derivative step extraction ──────────────────────────────────────────────

def _derivative_steps(expr: sympy.Expr, wrt_sequence: list[Symbol]) -> tuple[sympy.Expr, list[dict]]:
    """
    Produce granular steps for derivative with respect to a sequence of variables.
    For sum expressions, expand into per-term sub-steps.
    For products, show u·v′ + v·u′ explicitly.
    For chain rule, show outer and inner derivatives.
    """
    steps: list[dict] = []
    current = expr

    for i, wrt in enumerate(wrt_sequence):
        before_wrap = f"\\frac{{d}}{{d{latex(wrt)}}}\\left[{latex(current)}\\right]"

        rule = _diff_rule(current, wrt)
        result = diff(current, wrt)

        # ── Sum rule: one top-level step + per-term sub-steps ──────────
        if rule == "sum_rule":
            steps.append({
                "rule": "sum_rule",
                "before_latex": before_wrap,
                "after_latex":  " + ".join(
                    f"\\frac{{d}}{{d{latex(wrt)}}}\\left[{latex(t)}\\right]"
                    for t in current.args
                ),
                "substeps": _per_term_diff_substeps(current.args, wrt),
            })
            # Collect result step
            steps.append({
                "rule": "simplify",
                "before_latex": " + ".join(latex(diff(t, wrt)) for t in current.args),
                "after_latex":  latex(result),
            })

        # ── Product rule: show u·v′ + v·u′ expansion ──────────────────
        elif rule == "product_rule":
            u, v = _split_product(current, wrt)
            du = diff(u, wrt); dv = diff(v, wrt)
            steps.append({
                "rule": "product_rule",
                "before_latex": before_wrap,
                "after_latex":  (
                    f"\\left({latex(u)}\\right)\\cdot\\frac{{d}}{{d{latex(wrt)}}}"
                    f"\\left[{latex(v)}\\right] + \\left({latex(v)}\\right)\\cdot"
                    f"\\frac{{d}}{{d{latex(wrt)}}}\\left[{latex(u)}\\right]"
                ),
                "substeps": [
                    {"label": f"d/d{latex(wrt)}[{latex(u)}]", "value": latex(du)},
                    {"label": f"d/d{latex(wrt)}[{latex(v)}]", "value": latex(dv)},
                ],
            })
            steps.append({
                "rule": "simplify",
                "before_latex": (
                    f"{latex(u)}\\cdot({latex(dv)}) + {latex(v)}\\cdot({latex(du)})"
                ),
                "after_latex": latex(result),
            })

        # ── Chain rule: show outer × inner ────────────────────────────
        elif rule == "chain_rule" and isinstance(current, (Pow, sin, cos, tan, exp, log, sqrt,
                                                            asin, acos, atan, sinh, cosh, tanh)):
            inner = current.args[0]
            d_inner = diff(inner, wrt)
            # SymPy only differentiates with respect to symbols, not compound
            # expressions (for example ``x**2 + 1``). Replace the inner
            # expression with a temporary symbol to obtain the outer
            # derivative, then substitute it back for display.
            outer_symbol = sympy.Dummy("u")
            outer_expr = current.xreplace({inner: outer_symbol})
            outer_diff = diff(outer_expr, outer_symbol).subs(outer_symbol, inner)
            display_symbol = sympy.Symbol("u")
            display_outer = current.xreplace({inner: display_symbol})
            steps.append({
                "rule": "chain_rule",
                "before_latex": before_wrap,
                "after_latex": (
                    f"\\underbrace{{\\frac{{d}}{{d{latex(display_symbol)}}}\\left[{latex(display_outer)}\\right]}}_{{\\text{{outer}}}} "
                    f"\\cdot \\underbrace{{\\frac{{d}}{{d{latex(wrt)}}}\\left[{latex(inner)}\\right]}}_{{\\text{{inner}}}}"
                ),
                "substeps": [
                    {"label": "outer derivative", "value": latex(outer_diff)},
                    {"label": "inner derivative", "value": latex(d_inner)},
                ],
            })
            steps.append({
                "rule": "simplify",
                "before_latex": f"({latex(outer_diff)}) \\cdot ({latex(d_inner)})",
                "after_latex": latex(result),
            })

        # ── Constant factor: show c · d/dx[...] ───────────────────────
        elif rule == "constant_factor":
            consts = [a for a in current.args if not a.has(wrt)]
            wrt_part = [a for a in current.args if a.has(wrt)]
            c_expr = sympy.Mul(*consts) if consts else sympy.Integer(1)
            f_expr = sympy.Mul(*wrt_part) if wrt_part else current
            steps.append({
                "rule": "constant_factor",
                "before_latex": before_wrap,
                "after_latex": (
                    f"{latex(c_expr)} \\cdot \\frac{{d}}{{d{latex(wrt)}}}\\left[{latex(f_expr)}\\right]"
                ),
            })
            steps.append({
                "rule": _diff_rule(f_expr, wrt),
                "before_latex": f"\\frac{{d}}{{d{latex(wrt)}}}\\left[{latex(f_expr)}\\right]",
                "after_latex": latex(diff(f_expr, wrt)),
            })
            steps.append({
                "rule": "simplify",
                "before_latex": f"{latex(c_expr)} \\cdot ({latex(diff(f_expr, wrt))})",
                "after_latex": latex(result),
            })

        else:
            # Power rule, constant, or default — single step
            steps.append({
                "rule": rule,
                "before_latex": before_wrap,
                "after_latex": latex(result),
            })

        current = result

    return current, steps


def _per_term_diff_substeps(terms, wrt: Symbol) -> list[dict]:
    out = []
    for t in terms:
        rule = _diff_rule(t, wrt)
        out.append({
            "label": latex(t),
            "value": latex(diff(t, wrt)),
            "rule": rule,
        })
    return out


def _split_product(expr: sympy.Expr, wrt: Symbol):
    """Split a Mul into (u, v) where u is the first wrt-containing factor."""
    args = list(expr.args)
    wrt_args = [a for a in args if a.has(wrt)]
    non_wrt  = [a for a in args if not a.has(wrt)]
    if len(wrt_args) >= 2:
        return wrt_args[0], sympy.Mul(*(wrt_args[1:] + non_wrt))
    if wrt_args and non_wrt:
        return sympy.Mul(*non_wrt), wrt_args[0]
    return args[0], sympy.Mul(*args[1:]) if len(args) > 1 else sympy.Integer(1)


# ── Total derivative step extraction ───────────────────────────────────────

def _total_derivative_steps(expr: sympy.Expr, wrt: sympy.Symbol, dep_vars: list[sympy.Symbol]) -> tuple[sympy.Expr, list[dict]]:
    """
    Compute df/d(wrt) using the multi-variable chain rule.

    dep_vars: variables in expr that depend on wrt (e.g. x, y if wrt = t).
    If dep_vars is empty, treats all free symbols except wrt as dependents.

    Returns the general form:
      df/dt = ∂f/∂x₁ · dx₁/dt + ∂f/∂x₂ · dx₂/dt + ...
    with symbolic dx_i/dt terms (not substituted).
    """
    steps: list[dict] = []
    free = expr.free_symbols - {wrt}

    if not dep_vars:
        dep_vars = sorted(free, key=str)

    if not dep_vars:
        # No dependencies — result is 0
        steps.append({
            "rule": "constant",
            "before_latex": latex(expr),
            "after_latex": "0",
            "explanation": _narrate("constant", str(wrt)),
            "narrated_by": "fallback_template",
        })
        return sympy.Integer(0), steps

    wrt_str = latex(wrt)

    # Build chain rule sum.
    # Use plain clean symbols (e.g. `dxdt`) for the algebraic result so
    # SymPy's own latex() call never encounters backslashes in symbol names.
    terms_algebraic = []
    partial_labels  = []

    for v in dep_vars:
        v_str         = latex(v)
        partial       = sympy.diff(expr, v)
        # Clean Python identifier for SymPy algebra -- never serialised as LaTeX itself
        dummy_name    = f"d{str(v)}d{str(wrt)}"
        dv_dwrt_sym   = sympy.Symbol(dummy_name)           # e.g. Symbol("dxdt")
        dv_dwrt_latex = f"\\frac{{d{v_str}}}{{d{wrt_str}}}"  # the display form
        terms_algebraic.append(partial * dv_dwrt_sym)
        partial_labels.append((v, v_str, partial, dv_dwrt_sym, dv_dwrt_latex))

    # Build result LaTeX manually: Σ partial * (dv/dwrt)
    result_latex_parts = []
    for _, v_str, partial, _, dv_dwrt_latex in partial_labels:
        result_latex_parts.append(f"{latex(partial)} \\cdot {dv_dwrt_latex}")
    result_latex = " + ".join(result_latex_parts)

    # Algebraic result (uses clean dummy symbols, safe to pass through SymPy)
    result = sympy.Add(*terms_algebraic)

    # Step 1: chain rule template
    template_parts = " + ".join(
        f"\\frac{{\\partial f}}{{\\partial {v_str}}} \\cdot \\frac{{d{v_str}}}{{d{wrt_str}}}"
        for _, v_str, _, _, _ in partial_labels
    )
    steps.append({
        "rule": "chain_rule",
        "before_latex": f"\\frac{{df}}{{d{wrt_str}}} = {template_parts}",
        "after_latex":  result_latex,
        "explanation": (
            f"Total Derivative -- Chain Rule: "
            f"df/d{wrt_str} is the sum of each partial derivative "
            f"multiplied by the rate of change of that variable with respect to {wrt_str}."
        ),
        "narrated_by": "fallback_template",
    })

    # Step 2: each partial derivative with its contribution
    for v, v_str, partial, _, dv_dwrt_latex in partial_labels:
        partial_latex = latex(partial)
        steps.append({
            "rule": "partial_derivative",
            "before_latex": f"\\frac{{\\partial}}{{\\partial {v_str}}}\\left[{latex(expr)}\\right]",
            "after_latex":  partial_latex,
            "explanation":  f"Partial derivative of f with respect to {v_str}, treating all other variables as constants.",
            "narrated_by":  "fallback_template",
            "substeps": [
                {"label": f"∂f/∂{v_str}", "value": partial_latex},
                {"label": "contribution", "value": f"{partial_latex} \\cdot {dv_dwrt_latex}"},
            ],
        })

    return result, steps


# ── Integral step extraction ────────────────────────────────────────────────

def _integral_steps(expr: sympy.Expr, integration_sequence: list[dict]) -> tuple[sympy.Expr, list[dict]]:
    steps: list[dict] = []
    current = expr

    for item in integration_sequence:
        wrt = item["wrt"]
        bounds = item["bounds"]
        rule = _int_rule(current, wrt)
        indef = f"\\int {latex(current)} \\, d{latex(wrt)}"

        # Sum rule: split and show each term
        if isinstance(current, Add):
            term_integrals = [integrate(t, wrt) for t in current.args]
            steps.append({
                "rule": "sum_rule_integral",
                "before_latex": indef,
                "after_latex": " + ".join(
                    f"\\int {latex(t)} \\, d{latex(wrt)}" for t in current.args
                ),
                "substeps": [
                    {"label": f"∫ {latex(t)} d{latex(wrt)}", "value": latex(ti) + " + C"}
                    for t, ti in zip(current.args, term_integrals)
                ],
            })
            antideriv = integrate(current, wrt)
            steps.append({
                "rule": "simplify",
                "before_latex": " + ".join(latex(ti) for ti in term_integrals) + " + C",
                "after_latex": latex(antideriv) + " + C",
            })
        else:
            antideriv = integrate(current, wrt)
            if bounds:
                # Construct from validated Python numbers — never from strings (SECURITY_POLICY.md)
                _lo = sympy.Integer(bounds[0]) if isinstance(bounds[0], int) else sympy.Float(bounds[0])
                _hi = sympy.Integer(bounds[1]) if isinstance(bounds[1], int) else sympy.Float(bounds[1])
                after = f"{latex(antideriv)} \\Big|_{{{latex(_lo)}}}^{{{latex(_hi)}}}"
            else:
                after = f"{latex(antideriv)} + C"

            # For power rule, show the formula explicitly
            if rule == "power_rule_integral" and isinstance(current, (Pow, Symbol)):
                n = current.args[1] if isinstance(current, Pow) else sympy.Integer(1)
                steps.append({
                    "rule": "power_rule_integral",
                    "before_latex": indef,
                    "after_latex": after,
                    "substeps": [{"label": "formula", "value": f"\\frac{{x^{{n+1}}}}{{n+1}}\\Big|_{{n={latex(n)}}}"}],
                })
            elif rule == "constant_factor" and isinstance(current, Mul):
                consts = [a for a in current.args if not a.has(wrt)]
                f_part = [a for a in current.args if a.has(wrt)]
                c = sympy.Mul(*consts)
                f = sympy.Mul(*f_part)
                f_antideriv = integrate(f, wrt)
                steps.append({
                    "rule": "constant_factor",
                    "before_latex": indef,
                    "after_latex": f"{latex(c)} \\cdot \\int {latex(f)} \\, d{latex(wrt)}",
                })
                steps.append({
                    "rule": _int_rule(f, wrt),
                    "before_latex": f"\\int {latex(f)} \\, d{latex(wrt)}",
                    "after_latex": latex(f_antideriv) + " + C",
                })
                steps.append({
                    "rule": "simplify",
                    "before_latex": f"{latex(c)} \\cdot ({latex(f_antideriv)})",
                    "after_latex": after,
                })
            else:
                steps.append({"rule": rule, "before_latex": indef, "after_latex": after})

        if bounds:
            lo = sympy.Integer(bounds[0]) if isinstance(bounds[0], int) else sympy.Float(bounds[0])
            hi = sympy.Integer(bounds[1]) if isinstance(bounds[1], int) else sympy.Float(bounds[1])
            result = integrate(current, (wrt, lo, hi))
            antideriv_sym = integrate(current, wrt)
            bound_latex = f"{latex(antideriv_sym)} \\Big|_{{{latex(lo)}}}^{{{latex(hi)}}}"
            steps.append({
                "rule": "evaluate_bounds",
                "before_latex": bound_latex,
                "after_latex": latex(result),
                "substeps": [
                    {"label": f"at {latex(wrt)}={latex(hi)}", "value": latex(antideriv_sym.subs(wrt, hi))},
                    {"label": f"at {latex(wrt)}={latex(lo)}", "value": latex(antideriv_sym.subs(wrt, lo))},
                    {"label": "difference", "value": latex(result)},
                ],
            })
            current = result
        else:
            current = integrate(current, wrt)

    return current, steps


# ── Numeric sampling ────────────────────────────────────────────────────────

def _numeric_sample(result: sympy.Expr, wrt: Symbol, n: int = 7,
                    wrt_name: str = "x") -> list[dict]:
    try:
        import numpy as np
        xs = np.linspace(-3, 3, n)
        samples = []
        for xv in xs:
            try:
                y = float(result.subs(wrt, xv).evalf())
                if abs(y) < 1e10:
                    samples.append({wrt_name: round(float(xv), 4), "y": round(y, 6)})
            except Exception:
                pass
        return samples
    except ImportError:
        # numpy not available
        xs = [-3, -2, -1, 0, 1, 2, 3]
        samples = []
        for xv in xs:
            try:
                y = float(result.subs(wrt, xv).evalf())
                if abs(y) < 1e10:
                    samples.append({wrt_name: xv, "y": round(y, 6)})
            except Exception:
                pass
        return samples


# ── Error helper ────────────────────────────────────────────────────────────

def _error(code: str, message: str, status: int = 422) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"error": code, "message": message}),
    }


# ── Public handler ──────────────────────────────────────────────────────────

def handle(body: dict) -> dict:
    """
    POST /solve
      expr                 string  required
      operation            string  required  "derivative" | "integral"
      wrt_sequence         list    optional  e.g. ["x", "y"]
      integration_sequence list    optional  e.g. [{"wrt": "x", "bounds": [0, 1]}]
    """
    expr_str  = body.get("expr", "")
    operation = body.get("operation", "")

    if not expr_str:
        return _error("malformed_request", "Field 'expr' is required.", 400)
    if operation not in ("derivative", "integral", "total_derivative"):
        return _error("malformed_request", "'operation' must be 'derivative', 'integral', or 'total_derivative'.", 400)

    try:
        expr = safe_parse(expr_str)
    except ExpressionError as e:
        return _error("invalid_expression", str(e))

    try:
        if operation == "derivative":
            wrt_sequence_raw = body.get("wrt_sequence")
            if wrt_sequence_raw is not None:
                if not isinstance(wrt_sequence_raw, list) or not all(isinstance(v, str) for v in wrt_sequence_raw):
                    return _error("malformed_request", "'wrt_sequence' must be a list of strings.", 400)
                if not wrt_sequence_raw:
                    wrt_sequence_raw = ["x"]
            else:
                wrt_str = body.get("wrt", "x")
                order_raw = body.get("order", 1)
                try:
                    order = int(order_raw)
                    wrt_sequence_raw = [wrt_str] * order
                except (ValueError, TypeError):
                    return _error("malformed_request", "'order' must be an integer.", 400)

            wrt_sequence = []
            for v in wrt_sequence_raw:
                if v not in {"x", "y", "z", "t"}:
                    return _error("invalid_expression", f"Variable '{v}' not allowed.")
                wrt_sequence.append(symbols(v))

            with calculation_timeout(12):
                result, steps = _derivative_steps(expr, wrt_sequence)
            
            primary_wrt = wrt_sequence[-1]
            primary_wrt_str = str(primary_wrt)

        elif operation == "total_derivative":
            # wrt: the independent variable to differentiate with respect to (e.g. "t")
            # dep_vars: optional list of variables in expr that depend on wrt (e.g. ["x", "y"])
            #           if omitted, all free symbols except wrt are treated as dependents
            wrt_str = body.get("wrt", "t")
            if wrt_str not in {"x", "y", "z", "t"}:
                return _error("invalid_expression", f"Variable '{wrt_str}' not allowed.")
            wrt_sym = symbols(wrt_str)

            dep_vars_raw = body.get("dep_vars", None)  # optional list of strings
            dep_vars = []
            if dep_vars_raw is not None:
                if not isinstance(dep_vars_raw, list) or not all(isinstance(v, str) for v in dep_vars_raw):
                    return _error("malformed_request", "'dep_vars' must be a list of strings.", 400)
                for v in dep_vars_raw:
                    if v not in {"x", "y", "z", "t"}:
                        return _error("invalid_expression", f"Variable '{v}' not allowed.")
                    dep_vars.append(symbols(v))

            with calculation_timeout(12):
                result, steps = _total_derivative_steps(expr, wrt_sym, dep_vars)

            primary_wrt = wrt_sym
            primary_wrt_str = wrt_str

        else:
            integration_sequence_raw = body.get("integration_sequence")
            if integration_sequence_raw is not None:
                if not isinstance(integration_sequence_raw, list):
                    return _error("malformed_request", "'integration_sequence' must be a list.", 400)
                if not integration_sequence_raw:
                    integration_sequence_raw = [{"wrt": "x", "bounds": None}]
            else:
                wrt_str = body.get("wrt", "x")
                bounds = body.get("bounds", None)
                integration_sequence_raw = [{"wrt": wrt_str, "bounds": bounds}]
            
            integration_sequence = []
            for item in integration_sequence_raw:
                if not isinstance(item, dict):
                    return _error("malformed_request", "Each item in 'integration_sequence' must be an object.", 400)
                v = item.get("wrt", "x")
                if v not in {"x", "y", "z", "t"}:
                    return _error("invalid_expression", f"Variable '{v}' not allowed.")
                
                bounds = item.get("bounds")
                validated_bounds = None
                if bounds is not None:
                    if not isinstance(bounds, list) or len(bounds) != 2:
                        return _error("malformed_request", "'bounds' must be a two-element array [lower, upper].", 400)
                    validated_bounds = []
                    for i, b in enumerate(bounds):
                        if not isinstance(b, (int, float)) or isinstance(b, bool):
                            return _error("malformed_request", f"bounds[{i}] must be a number.", 400)
                        if not math.isfinite(b):
                            return _error("malformed_request", f"bounds[{i}] must be finite.", 400)
                        validated_bounds.append(b)
                
                integration_sequence.append({"wrt": symbols(v), "bounds": validated_bounds})
            
            with calculation_timeout(12):
                result, steps = _integral_steps(expr, integration_sequence)
            
            primary_wrt = integration_sequence[-1]["wrt"]
            primary_wrt_str = str(primary_wrt)

        narration = {}
        steps  = _gemini_narrate(steps, primary_wrt_str, narration)
        samples = _numeric_sample(result, primary_wrt, wrt_name=primary_wrt_str)

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "result_latex": latex(result),
                "result_numeric_sample": samples,
                "narration": narration,
                "steps": steps,
            }),
        }

    except ComputationTimeout:
        return _error("computation_timeout",
                      "This expression is too complex to solve within the time limit.", 504)
    except SympifyError:
        return _error("invalid_expression", "SymPy could not evaluate this expression.")
    except Exception:
        logger.exception("Unhandled /solve calculation failure.")
        return _error("internal_error", "The service could not process this request.", 500)
