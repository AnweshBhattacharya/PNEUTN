"""Small, Lambda-compatible guard for potentially expensive SymPy work."""
from contextlib import contextmanager
import signal
import threading


class ComputationTimeout(TimeoutError):
    """Raised when a symbolic calculation exceeds its per-request budget."""


@contextmanager
def calculation_timeout(seconds: float):
    """Interrupt synchronous SymPy work on Linux Lambda after ``seconds``.

    SIGALRM is not available on Windows, so local development keeps working
    there while production Lambda receives the hard timeout protection.
    """
    if (
        seconds <= 0
        or not hasattr(signal, "SIGALRM")
        or threading.current_thread() is not threading.main_thread()
    ):
        yield
        return

    def _raise_timeout(_signum, _frame):
        raise ComputationTimeout("Symbolic calculation exceeded its time budget.")

    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, 0)
    signal.signal(signal.SIGALRM, _raise_timeout)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *previous_timer)
        signal.signal(signal.SIGALRM, previous_handler)
