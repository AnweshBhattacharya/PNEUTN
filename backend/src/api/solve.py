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
import os
import sympy
from sympy import (
    symbols, diff, integrate, latex,
    Symbol, Add, Mul, Pow, Function,
    sin, cos, tan, exp, log, sqrt,
    asin, acos, atan, sinh, cosh, tanh,
    Rational, Integer,
)

from safe_parse import safe_parse, ExpressionError

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# ── Narration templates ─────────────────────────────────────────────────────
_NARRATION = {
    "constant":             "Since this expression has no {wrt}, its derivative is 0.",
    "power_rule":           "Power Rule: bring the exponent down as a coefficient, then decrease the exponent by 1.",
    "product_rule":         "Product Rule: d/d{wrt}[u·v] = u·(dv/d{wrt}) + v·(du/d{wrt}).",
    "quotient_rule":        "Quotient Rule: d/d{wrt}[u/v] = (v·u′ − u·v′) / v².",
    "chain_rule":           "Chain Rule: differentiate the outer function, then multiply by the derivative of the inner function.",
    "sum_rule":             "Sum Rule: the derivative of each term is computed independently.",
    "constant_factor":      "Constant Multiple Rule: pull the constant coefficient outside the derivative.",
    "trig_rule":            "Standard trigonometric derivative identity applied directly.",
    "exp_rule":             "The derivative of eˣ with respect to x is eˣ.",
    "log_rule":             "The derivative of ln(x) with respect to x is 1/x.",
    "u_substitution":       "Use u-substitution — let u equal the inner expression, then integrate with respect to u.",
    "integration_by_parts": "Integration by Parts: ∫u dv = uv − ∫v du.",
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

def _gemini_narrate(steps: list[dict], wrt: str) -> list[dict]:
    if not GEMINI_API_KEY:
        return _fallback_narrate(steps, wrt)
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash")

        lines = [
            f"Step {i+1}: Rule={s['rule']}. Before={s['before_latex']}. After={s['after_latex']}."
            for i, s in enumerate(steps)
        ]
        prompt = (
            "You are a calculus tutor. The following steps were computed CORRECTLY by SymPy. "
            "Do NOT change any math. For each step write one clear sentence explaining "
            "what transformation was applied and why, for an undergraduate student. "
            "Return a JSON array of strings, one per step.\n\n"
            + "\n".join(lines)
        )
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:-1])
        narrations = json.loads(text)
        for i, step in enumerate(steps):
            step["explanation"]  = narrations[i] if i < len(narrations) else _narrate(step["rule"], wrt)
            step["narrated_by"]  = "gemini"
        return steps
    except Exception as exc:
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

def _derivative_steps(expr: sympy.Expr, wrt: Symbol, order: int) -> tuple[sympy.Expr, list[dict]]:
    """
    Produce granular steps for order-th derivative.
    For sum expressions, expand into per-term sub-steps.
    For products, show u·v′ + v·u′ explicitly.
    For chain rule, show outer and inner derivatives.
    """
    steps: list[dict] = []
    current = expr

    for o in range(order):
        sup = f"^{{{o + 1}}}" if o > 0 else ""
        before_wrap = f"\\frac{{d{sup}}}{{d{latex(wrt)}{sup}}}\\left[{latex(current)}\\right]"

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
            outer_diff = diff(current, inner)   # df/d(inner)
            steps.append({
                "rule": "chain_rule",
                "before_latex": before_wrap,
                "after_latex": (
                    f"\\underbrace{{\\frac{{d}}{{d(\\square)}}\\left[{latex(current.subs(inner, sympy.Symbol('square')))}\\right]}}_{{\\text{{outer}}}} "
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


# ── Integral step extraction ────────────────────────────────────────────────

def _integral_steps(expr: sympy.Expr, wrt: Symbol, bounds) -> tuple[sympy.Expr, list[dict]]:
    steps: list[dict] = []
    rule = _int_rule(expr, wrt)
    indef = f"\\int {latex(expr)} \\, d{latex(wrt)}"

    # Sum rule: split and show each term
    if isinstance(expr, Add):
        term_integrals = [integrate(t, wrt) for t in expr.args]
        steps.append({
            "rule": "sum_rule_integral",
            "before_latex": indef,
            "after_latex": " + ".join(
                f"\\int {latex(t)} \\, d{latex(wrt)}" for t in expr.args
            ),
            "substeps": [
                {"label": f"∫ {latex(t)} d{latex(wrt)}", "value": latex(ti) + " + C"}
                for t, ti in zip(expr.args, term_integrals)
            ],
        })
        antideriv = integrate(expr, wrt)
        steps.append({
            "rule": "simplify",
            "before_latex": " + ".join(latex(ti) for ti in term_integrals) + " + C",
            "after_latex": latex(antideriv) + " + C",
        })
    else:
        antideriv = integrate(expr, wrt)
        if bounds:
            # Construct from validated Python numbers — never from strings (SECURITY_POLICY.md)
            _lo = sympy.Integer(bounds[0]) if isinstance(bounds[0], int) else sympy.Float(bounds[0])
            _hi = sympy.Integer(bounds[1]) if isinstance(bounds[1], int) else sympy.Float(bounds[1])
            after = f"{latex(antideriv)} \\Big|_{{{latex(_lo)}}}^{{{latex(_hi)}}}"
        else:
            after = f"{latex(antideriv)} + C"

        # For power rule, show the formula explicitly
        if rule == "power_rule_integral" and isinstance(expr, (Pow, Symbol)):
            n = expr.args[1] if isinstance(expr, Pow) else sympy.Integer(1)
            steps.append({
                "rule": "power_rule_integral",
                "before_latex": indef,
                "after_latex": after,
                "substeps": [{"label": "formula", "value": f"\\frac{{x^{{n+1}}}}{{n+1}}\\Big|_{{n={latex(n)}}}"}],
            })
        elif rule == "constant_factor" and isinstance(expr, Mul):
            consts = [a for a in expr.args if not a.has(wrt)]
            f_part = [a for a in expr.args if a.has(wrt)]
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
        result = integrate(expr, (wrt, lo, hi))
        antideriv_sym = integrate(expr, wrt)
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
        return result, steps
    else:
        return integrate(expr, wrt), steps


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
      expr       string  required
      operation  string  required  "derivative" | "integral"
      wrt        string  required  x | y | z | t
      order      int     optional  1–5 (derivative only, default 1)
      bounds     list    optional  [lower, upper] (integral only)
    """
    expr_str  = body.get("expr", "")
    operation = body.get("operation", "")
    wrt_str   = body.get("wrt", "x")

    if not expr_str:
        return _error("malformed_request", "Field 'expr' is required.", 400)
    if operation not in ("derivative", "integral"):
        return _error("malformed_request", "'operation' must be 'derivative' or 'integral'.", 400)
    if wrt_str not in {"x", "y", "z", "t"}:
        return _error("invalid_expression", f"Variable '{wrt_str}' not allowed.")

    try:
        expr = safe_parse(expr_str)
    except ExpressionError as e:
        return _error("invalid_expression", str(e))

    wrt = symbols(wrt_str)

    try:
        if operation == "derivative":
            order  = max(1, min(int(body.get("order", 1)), 5))
            result, steps = _derivative_steps(expr, wrt, order)
        else:
            bounds = body.get("bounds", None)
            if bounds is not None:
                if not isinstance(bounds, list) or len(bounds) != 2:
                    return _error("malformed_request",
                                  "'bounds' must be a two-element array [lower, upper].", 400)
                validated_bounds = []
                for i, b in enumerate(bounds):
                    if not isinstance(b, (int, float)) or isinstance(b, bool):
                        return _error("malformed_request",
                                      f"bounds[{i}] must be a number, got {type(b).__name__}.", 400)
                    if b != b:  # NaN check
                        return _error("malformed_request", f"bounds[{i}] is NaN.", 400)
                    validated_bounds.append(b)
                bounds = validated_bounds
            result, steps = _integral_steps(expr, wrt, bounds)

        steps  = _gemini_narrate(steps, wrt_str)
        samples = _numeric_sample(result, wrt, wrt_name=wrt_str)

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "result_latex": latex(result),
                "result_numeric_sample": samples,
                "steps": steps,
            }),
        }

    except sympy.core.sympify.SympifyError as e:
        return _error("invalid_expression", f"SymPy error: {e}")
    except Exception as e:
        return _error("internal_error", f"Unexpected error: {e}", 500)
