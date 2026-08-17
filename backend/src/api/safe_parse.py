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
    Symbol, Integer, Float, Rational, pi, E, I, oo, zoo, nan,
    sin, cos, tan, asin, acos, atan, atan2,
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
    "sinh", "cosh", "tanh",
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
    "oo": oo,
    "zoo": zoo,
    "nan": nan,
    # Allowed functions
    "sin": sin,   "cos": cos,   "tan": tan,
    "asin": asin, "acos": acos, "atan": atan,
    "sinh": sinh, "cosh": cosh, "tanh": tanh,
    "exp": exp,   "log": log,   "sqrt": sqrt,
    "Abs": Abs,   "sign": sign,
}


class ExpressionError(ValueError):
    """Raised when a user-supplied expression fails any safety check."""
    pass


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
    if len(expr_string) > 200:
        raise ExpressionError("Expression too long (max 200 characters).")

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
        raise ExpressionError(f"Could not parse expression: {exc}") from exc

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
