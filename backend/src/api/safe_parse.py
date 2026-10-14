"""
safe_parse.py — safe SymPy expression parser.

SECURITY: never pass raw user strings to sympify() or eval().
This module is the ONLY entry point for converting user expression strings into
SymPy objects. All three API routes must call safe_parse() before any SymPy op.

See SECURITY_POLICY.md §1 for the full threat model.

FIX (SymPy ≥ 1.12): parse_expr with global_dict={"__builtins__":{}} strips all
SymPy internals too (Symbol, Integer, etc.), breaking evaluation. Solution: use a
curated global_dict that includes only SymPy mathematical objects — not os, sys,
eval, exec, import, or any Python builtins that could be exploited.
"""
import re
import sympy
from sympy import (
    Symbol, Integer, Float, Rational, pi, E, I,
    sin, cos, tan, asin, acos, atan,
    sinh, cosh, tanh, asinh, acosh, atanh,
    exp, log, sqrt, Abs, sign,
    Add, Mul, Pow,
)
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)

# Variables the user is allowed to reference
ALLOWED_SYMBOLS = {"x", "y", "z", "t"}

# Functions the user is allowed to call (by name as they appear post-parse)
ALLOWED_FUNCTIONS = {
    "sin", "cos", "tan",
    "exp", "log", "sqrt",
    "asin", "acos", "atan",
    "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
    "Abs", "sign",
}

# Transformations: standard + implicit multiplication + ^ as power
_TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,   # converts ^ to ** so x^2 works
)

# Allowed characters: digits, ASCII letters, whitespace, basic arithmetic ops,
# carets, parens, dot, comma. Underscores deliberately excluded to block dunder.
_SAFE_CHAR_RE = re.compile(r"^[0-9a-zA-Z\s\+\-\*/\^\(\)\.,]+$")

# Curated safe global dict: only SymPy mathematical objects, zero Python builtins
_SAFE_GLOBAL_DICT = {
    "__builtins__": {},   # still strip Python builtins
    # Core SymPy types needed by parse_expr's code generation
    "Symbol": Symbol,
    "Integer": Integer,
    "Float": Float,
    "Rational": Rational,
    "Add": Add,
    "Mul": Mul,
    "Pow": Pow,
    # Constants
    "pi": pi,
    "E": E,
    "I": I,
    # Allowed functions
    "sin": sin,   "cos": cos,   "tan": tan,
    "asin": asin, "acos": acos, "atan": atan,
    "sinh": sinh, "cosh": cosh, "tanh": tanh,
    "asinh": asinh, "acosh": acosh, "atanh": atanh,
    "exp": exp,   "log": log,   "sqrt": sqrt,
    "Abs": Abs,   "sign": sign,
}


class ExpressionError(ValueError):
    """Raised when a user-supplied expression fails any safety check."""
    pass


MAX_EXPRESSION_LENGTH = 200
MAX_EXPRESSION_NODES = 100


def _validate_expression_complexity(parsed: sympy.Expr) -> None:
    """Reject expressions that are valid but unreasonably complex to process."""
    node_count = sum(1 for _ in sympy.preorder_traversal(parsed))
    if node_count > MAX_EXPRESSION_NODES:
        raise ExpressionError("Expression is too complex. Use at most 100 mathematical terms.")

    # SymPy represents 1 / 0, log(0), and similar non-finite input as these
    # values. Rejecting them avoids invalid JSON values and undefined graphing.
    if parsed.has(sympy.oo, sympy.zoo, sympy.nan):
        raise ExpressionError("Expression must evaluate to a finite mathematical value.")


def safe_parse(expr_string: str) -> sympy.Expr:
    """
    Parse a user-supplied expression string into a SymPy expression safely.

    Four protection layers:
    1. Length cap
    2. Character whitelist (no underscores, no import/exec/eval keywords)
    3. parse_expr with curated global_dict (SymPy types only, no builtins)
    4. Post-parse symbol + function allowlist validation

    Raises ExpressionError on any violation; returns SymPy Expr on success.
    """
    if not isinstance(expr_string, str):
        raise ExpressionError("Expression must be a string.")

    # ── Layer 1: length cap ──────────────────────────────────────────────
    if len(expr_string) > MAX_EXPRESSION_LENGTH:
        raise ExpressionError(f"Expression too long (max {MAX_EXPRESSION_LENGTH} characters).")

    # ── Layer 2: character whitelist ─────────────────────────────────────
    if not _SAFE_CHAR_RE.match(expr_string):
        raise ExpressionError(
            "Expression contains disallowed characters. "
            "Only digits, letters, +, -, *, /, ^, (, ), ., , and spaces are permitted."
        )

    # ── Layer 3: parse_expr with safe global dict ─────────────────────────
    try:
        parsed = parse_expr(
            expr_string,
            transformations=_TRANSFORMATIONS,
            local_dict={},
            global_dict=_SAFE_GLOBAL_DICT,
            evaluate=True,
        )
    except Exception as exc:
        # Parser internals can vary by SymPy release. Keep the public error
        # stable instead of exposing implementation details to the client.
        raise ExpressionError("Could not parse expression. Check its syntax.") from exc

    _validate_expression_complexity(parsed)

    # ── Layer 4: post-parse symbol + function validation ──────────────────
    for sym in parsed.free_symbols:
        if str(sym) not in ALLOWED_SYMBOLS:
            raise ExpressionError(
                f"Disallowed variable '{sym}'. "
                f"Allowed variables: {', '.join(sorted(ALLOWED_SYMBOLS))}."
            )

    for func in parsed.atoms(sympy.Function):
        fname = type(func).__name__
        if fname not in ALLOWED_FUNCTIONS:
            raise ExpressionError(
                f"Disallowed function '{fname}'. "
                f"Allowed functions: {', '.join(sorted(ALLOWED_FUNCTIONS))}."
            )

    return parsed


# ── ODE Safe Parser ──────────────────────────────────────────────────────────

ALLOWED_ODE_SYMBOLS = {"x", "y", "z", "t", "C1", "C2"}
ALLOWED_ODE_FUNCTIONS = ALLOWED_FUNCTIONS | {"Derivative", "diff", "y", "Eq"}
_SAFE_ODE_CHAR_RE = re.compile(r"^[0-9a-zA-Z\s\+\-\*/\^\(\)\.,=']+$")

_SAFE_ODE_GLOBAL_DICT = dict(_SAFE_GLOBAL_DICT)
_SAFE_ODE_GLOBAL_DICT.update({
    "Derivative": sympy.Derivative,
    "diff": sympy.Derivative,
    "Function": sympy.Function,
    "Eq": sympy.Eq,
    "y": sympy.Function("y"),
})


def safe_parse_ode(ode_string: str, wrt_name: str = "x") -> tuple[sympy.Expr, sympy.Function, sympy.Symbol]:
    """
    Safely parse an ordinary differential equation string.
    Supports:
      - SymPy form: "Derivative(y(x), x) - x*y(x)"
      - Equation form: "dy/dx = x*y" or "y' = -2*y" or "Derivative(y(x), x) = x*y(x)"
      - Plain RHS form: "x*y" (interpreted as dy/d{wrt} = f({wrt}, y))
    Returns (ode_expr, y_func, wrt_symbol).
    """
    if not isinstance(ode_string, str) or not ode_string.strip():
        raise ExpressionError("ODE expression must be a non-empty string.")

    wrt_str = wrt_name if wrt_name in {"x", "t"} else "x"
    wrt_sym = Symbol(wrt_str)
    y_func = sympy.Function("y")(wrt_sym)

    s = ode_string.strip().replace("’", "'")
    if len(s) > MAX_EXPRESSION_LENGTH:
        raise ExpressionError(f"Expression too long (max {MAX_EXPRESSION_LENGTH} characters).")

    if not _SAFE_ODE_CHAR_RE.match(s):
        raise ExpressionError("ODE expression contains disallowed characters.")

    # Strip leading derivative notation like "dy/dx =" or "y' =" or "dy/dt ="
    s = re.sub(r"^(?:d[yY]/d[xtXT]|y\s*'*)\s*=\s*", "", s).strip()

    # If it contains an equals sign '=' outside of functions, rewrite as (lhs) - (rhs)
    if "=" in s and not s.startswith("Eq("):
        parts = s.split("=", 1)
        lhs_part = parts[0].strip()
        rhs_part = parts[1].strip()
        s = f"({lhs_part}) - ({rhs_part})"

    # If no derivative operator is present, assume s is the RHS f(wrt, y) of dy/d{wrt} = f
    if "Derivative" not in s and "diff" not in s:
        # replace standalone y with y(wrt)
        rhs_with_y = re.sub(r"\by\b", f"y({wrt_str})", s)
        s = f"Derivative(y({wrt_str}), {wrt_str}) - ({rhs_with_y})"
    else:
        # Ensure y is invoked as a function y(wrt)
        # Match standalone 'y' not followed by '(' and not part of 'dy'
        s = re.sub(r"(?<![a-zA-Z])y(?!\s*\()", f"y({wrt_str})", s)

    try:
        parsed = parse_expr(
            s,
            transformations=_TRANSFORMATIONS,
            local_dict={wrt_str: wrt_sym, "y": sympy.Function("y")},
            global_dict=_SAFE_ODE_GLOBAL_DICT,
            evaluate=True,
        )
    except Exception as exc:
        raise ExpressionError("Could not parse ODE expression. Check its syntax.") from exc

    _validate_expression_complexity(parsed)

    for sym in parsed.free_symbols:
        if str(sym) not in ALLOWED_ODE_SYMBOLS:
            raise ExpressionError(f"Disallowed variable '{sym}' in ODE.")

    for func in parsed.atoms(sympy.Function):
        fname = type(func).__name__
        if fname not in ALLOWED_ODE_FUNCTIONS:
            raise ExpressionError(f"Disallowed function '{fname}' in ODE.")

    return parsed, y_func, wrt_sym

