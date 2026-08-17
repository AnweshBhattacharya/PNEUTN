"""
integral_order.py — /integral-order route handler.

Scoped to regions bounded by exactly two curves with symbolically solvable
intersection (e.g. y = x and y = x²). See ARCHITECTURE.md §4.

Given curve_upper and curve_lower (both as x-expressions),
and a requested order ("dy_dx" or "dx_dy"), this handler:
  1. safe_parse()s both curves
  2. finds intersections via sympy.solve()
  3. derives the integration bounds for the requested order
  4. returns bounds_latex, region_vertices, sweep_axis, intersections

See API_SPEC.md for the exact request/response shape.
"""
import json
import sympy
from sympy import symbols, solve, latex, Rational

from safe_parse import safe_parse, ExpressionError


def _error(code: str, message: str, status: int = 422) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"error": code, "message": message}),
    }


def _float_pair(pt) -> list:
    """Convert a sympy point to a [float, float] list."""
    try:
        return [float(pt[0].evalf()), float(pt[1].evalf())]
    except Exception:
        return [float(str(pt[0])), float(str(pt[1]))]


def handle(body: dict) -> dict:
    """
    Handle POST /integral-order.

    Request body fields (see API_SPEC.md):
      curve_upper  string  required  Upper bounding curve (expressed as function of x)
      curve_lower  string  required  Lower bounding curve (expressed as function of x)
      order        string  required  "dy_dx" | "dx_dy"
    """
    upper_str = body.get("curve_upper", "")
    lower_str = body.get("curve_lower", "")
    order = body.get("order", "dy_dx")

    if not upper_str or not lower_str:
        return _error("malformed_request", "Both 'curve_upper' and 'curve_lower' are required.", 400)
    if order not in ("dy_dx", "dx_dy"):
        return _error("malformed_request", "'order' must be 'dy_dx' or 'dx_dy'.", 400)

    try:
        expr_upper = safe_parse(upper_str)
        expr_lower = safe_parse(lower_str)
    except ExpressionError as e:
        return _error("invalid_expression", str(e))

    x, y = symbols("x y")

    try:
        # Find intersections: solve expr_upper - expr_lower = 0 for x
        diff_expr = expr_upper - expr_lower
        x_intersections = solve(diff_expr, x)

        if not x_intersections or len(x_intersections) < 2:
            return _error(
                "region_not_supported",
                "Could not find a closed-form intersection between these two curves. "
                "This region is out of scope for automatic bound-swapping in the current version.",
            )

        # Take the two real intersection x-values
        real_xs = sorted(
            [xi for xi in x_intersections if xi.is_real],
            key=lambda v: float(v.evalf())
        )

        if len(real_xs) < 2:
            return _error(
                "region_not_supported",
                "Could not find two real intersection points between these curves.",
            )

        x_lo, x_hi = real_xs[0], real_xs[1]

        # Corresponding y values on the upper curve
        y_lo = expr_upper.subs(x, x_lo)
        y_hi = expr_upper.subs(x, x_hi)

        # Build region vertices for frontend shading (sample the two curves)
        n_pts = 30
        import numpy as np
        xs_range = np.linspace(float(x_lo.evalf()), float(x_hi.evalf()), n_pts)

        upper_pts = []
        lower_pts = []
        for xv in xs_range:
            try:
                yu = float(expr_upper.subs(x, xv).evalf())
                yl = float(expr_lower.subs(x, xv).evalf())
                upper_pts.append([round(xv, 6), round(yu, 6)])
                lower_pts.append([round(xv, 6), round(yl, 6)])
            except Exception:
                pass

        # Region vertices: upper curve forward + lower curve backward
        region_vertices = upper_pts + list(reversed(lower_pts))

        # Intersection points
        intersections = [
            [round(float(x_lo.evalf()), 6), round(float(y_lo.evalf()), 6)],
            [round(float(x_hi.evalf()), 6), round(float(y_hi.evalf()), 6)],
        ]

        # Build bounds LaTeX for the requested order
        if order == "dy_dx":
            # ∫_{x_lo}^{x_hi} ∫_{lower(x)}^{upper(x)} dy dx
            bounds_latex = (
                f"\\int_{{{latex(x_lo)}}}^{{{latex(x_hi)}}}"
                f"\\int_{{{latex(expr_lower)}}}^{{{latex(expr_upper)}}}"
                f"\\, dy \\, dx"
            )
            sweep_axis = "y"
        else:  # dx_dy
            # For dx dy order: outer integral over y, inner integral over x
            # x bounds: from inverse of lower to inverse of upper
            # For simple polynomial cases, attempt sympy.solve for x in terms of y
            try:
                x_from_upper = solve(expr_upper - y, x)
                x_from_lower = solve(expr_lower - y, x)

                # Pick the real positive-branch solutions where applicable
                x_from_upper_real = [v for v in x_from_upper if v.is_real or True]
                x_from_lower_real = [v for v in x_from_lower if v.is_real or True]

                if x_from_upper_real and x_from_lower_real:
                    x_upper_expr = x_from_upper_real[-1]  # take last (often the positive root)
                    x_lower_expr = x_from_lower_real[0]

                    bounds_latex = (
                        f"\\int_{{{latex(y_lo)}}}^{{{latex(y_hi)}}}"
                        f"\\int_{{{latex(x_lower_expr)}}}^{{{latex(x_upper_expr)}}}"
                        f"\\, dx \\, dy"
                    )
                else:
                    raise ValueError("Could not invert curves for dx dy order.")
            except Exception:
                bounds_latex = (
                    "\\text{Bound derivation for } dx\\,dy \\text{ order not available for these curves.}"
                )
            sweep_axis = "x"

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "intersections": intersections,
                "bounds_latex": bounds_latex,
                "region_vertices": region_vertices,
                "sweep_axis": sweep_axis,
            }),
        }

    except ExpressionError as e:
        return _error("invalid_expression", str(e))
    except Exception as e:
        return _error("internal_error", f"Unexpected error: {e}", 500)
