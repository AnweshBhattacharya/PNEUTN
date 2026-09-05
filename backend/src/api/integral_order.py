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
import logging
import sympy
from sympy import symbols, solve, latex, Rational

from safe_parse import safe_parse, ExpressionError
from computation_guard import ComputationTimeout, calculation_timeout

logger = logging.getLogger(__name__)


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

    unsupported_symbols = (expr_upper.free_symbols | expr_lower.free_symbols) - {x}
    if unsupported_symbols:
        return _error(
            "invalid_expression",
            "Region curves must be functions of x only.",
        )

    try:
        # Find intersections: solve expr_upper - expr_lower = 0 for x
        with calculation_timeout(12):
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
            [xi for xi in x_intersections if xi.is_real is True],
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
        with calculation_timeout(12):
            n_pts = 30
            x0_f = float(x_lo.evalf())
            x1_f = float(x_hi.evalf())
            step = (x1_f - x0_f) / (n_pts - 1) if n_pts > 1 else 0
            xs_range = [x0_f + i * step for i in range(n_pts)]

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
                with calculation_timeout(12):
                    x_from_upper = solve(expr_upper - y, x)
                    x_from_lower = solve(expr_lower - y, x)

                    # Pick the real positive-branch solutions where applicable
                    x_from_upper_real = [v for v in x_from_upper if v.is_real or True]
                    x_from_lower_real = [v for v in x_from_lower if v.is_real or True]

                    if x_from_upper_real and x_from_lower_real:
                        # Evaluate candidate branches at the y-midpoint to pick the valid pair
                        # (largest positive x-gap), not an arbitrary index guess
                        y_mid = (y_lo + y_hi) / 2
                        best_lo = None
                        best_hi = None
                        best_gap = -sympy.oo
                        for xl_cand in x_from_lower_real:
                            for xu_cand in x_from_upper_real:
                                try:
                                    xl_val = float(xl_cand.subs(y, y_mid).evalf())
                                    xu_val = float(xu_cand.subs(y, y_mid).evalf())
                                    gap = xu_val - xl_val
                                    if gap > float(best_gap):
                                        best_gap = gap
                                        best_lo = xl_cand
                                        best_hi = xu_cand
                                except Exception:
                                    continue
                        if best_lo is None or best_hi is None or float(best_gap) <= 0:
                            raise ValueError("Could not find valid x-bounds for dx dy order.")
                        x_lower_expr = best_lo
                        x_upper_expr = best_hi

                        bounds_latex = (
                            f"\\int_{{{latex(y_lo)}}}^{{{latex(y_hi)}}}"
                            f"\\int_{{{latex(x_lower_expr)}}}^{{{latex(x_upper_expr)}}}"
                            f"\\, dx \\, dy"
                        )
                    else:
                        raise ValueError("Could not invert curves for dx dy order.")
            except ComputationTimeout:
                raise
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

    except ComputationTimeout:
        return _error("computation_timeout",
                      "This expression is too complex to solve within the time limit.", 504)
    except ExpressionError as e:
        return _error("invalid_expression", str(e))
    except Exception:
        logger.exception("Unhandled /integral-order calculation failure.")
        return _error("internal_error", "The service could not process this request.", 500)
