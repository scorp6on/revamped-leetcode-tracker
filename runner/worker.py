"""Runs one job against its tests. Started by handler.py as a separate, limited process.

Reads the job as JSON on stdin. Writes one line per event to the real stdout, each starting with the
job's marker, so anything your code prints can't be mistaken for a result:
  <marker>{"type": "compile", "error": "..."}           your code (or the reference) didn't load
  <marker>{"type": "test", "index": 0, "status": ...}   one per test, as it finishes

A test is either written out ("input": one JSON value per line) or built by a generator ("generator":
Python defining make(), run with a fixed seed, #63). With a reference solution in the job, the reference
runs on each test first: its answer is the expected one when the test has none, and five times its time
(at least 100 ms) is your limit. With no code of yours ("check" mode, for the test writer), only the
reference runs, and its answers and times are reported.
"""

import copy
import io
import json
import os
import random
import signal
import sys
import time
import traceback
from contextlib import redirect_stdout

from lc import PRELUDE, _kind, answer_value, parse_lines, same, show, to_value

MAX_STDOUT = 2000  # characters of your print output kept per test
FILE = "solution.py"
REFERENCE_FILE = "reference.py"
GENERATOR_FILE = "generator.py"
REFERENCE_LIMIT_S = 2.0  # the reference itself must be quick
GENERATOR_LIMIT_S = 2.0
MAX_INPUT_CHARS = 10_000_000  # a generated input bigger than this is refused (a max-size design script is ~5M)
SLOW_FACTOR = 5  # #62 C: too slow past 5x the reference...
MIN_LIMIT_S = 0.1  # ...with a 100 ms floor
MAX_LIMIT_S = 3.0
PREVIEW_CHARS = 120
SHOWN_CHARS = 1000  # answers are compared here in full; only this much is sent back to be shown


class TimeLimit(Exception):
    pass


def _on_alarm(signum, frame):
    raise TimeLimit()


def _error(exc: BaseException, filename: str) -> str:
    """The error as LeetCode shows it: the line in that file, then the exception."""
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == filename:
            line = frame.lineno
    if isinstance(exc, SyntaxError) and exc.filename == filename:
        line = exc.lineno
    text = "".join(traceback.format_exception_only(type(exc), exc)).strip()
    if isinstance(exc, RecursionError):
        text += " (recursion too deep)"
    return f"Line {line}: {text}" if line else text


def _load(code: str, filename: str) -> dict:
    ns: dict = {"__name__": "solution"}
    exec(compile(PRELUDE, "<prelude>", "exec"), ns)
    with redirect_stdout(io.StringIO()):
        exec(compile(code, filename, "exec"), ns)
    return ns


def _timed(limit_s: float, fn):
    """fn() under a time limit; returns (answer, milliseconds). Raises TimeLimit when over."""
    start = time.perf_counter()
    signal.setitimer(signal.ITIMER_REAL, limit_s)
    try:
        answer = fn()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return answer, round((time.perf_counter() - start) * 1000, 2)


def _shown(value) -> str:
    text = show(value)
    return text if len(text) <= SHOWN_CHARS else f"{text[:SHOWN_CHARS]}… ({len(text):,} characters)"


def _preview(args: list) -> str:
    text = ", ".join(show(a) for a in args)
    return text if len(text) <= PREVIEW_CHARS else f"{text[:PREVIEW_CHARS]}… ({len(text):,} characters)"


def build_args(test: dict, index: int) -> list:
    """A test's arguments as plain JSON values (trees and lists as LeetCode writes them)."""
    if "generator" not in test:
        return parse_lines(test["input"])
    ns: dict = {"__name__": "generator", "random": random}
    exec(compile(test["generator"], GENERATOR_FILE, "exec"), ns)
    random.seed(test.get("seed", index))  # the same input every run
    args, _ = _timed(GENERATOR_LIMIT_S, ns["make"])
    if not isinstance(args, (list, tuple)):
        raise ValueError("make() must return a list with one value per argument")
    args = json.loads(json.dumps(list(args)))  # plain JSON values only, a fresh copy
    if len(json.dumps(args)) > MAX_INPUT_CHARS:
        raise ValueError("the generated input is too big")
    return args


def main() -> None:
    job = json.loads(sys.stdin.read())
    out = os.fdopen(os.dup(1), "w")  # the real stdout, before any code can touch sys.stdout
    marker = job["marker"]

    def emit(event: dict) -> None:
        out.write(marker + json.dumps(event) + "\n")
        out.flush()

    sys.setrecursionlimit(10_000)
    signal.signal(signal.SIGALRM, _on_alarm)
    any_order = job.get("anyOrder", False)

    reference = None
    if job.get("reference"):
        try:
            reference = _load(job["reference"], REFERENCE_FILE)
        except BaseException as exc:
            emit({"type": "compile", "error": "Reference: " + _error(exc, REFERENCE_FILE)})
            return
    yours = None
    if job.get("code") is not None:
        try:
            yours = _load(job["code"], FILE)
        except BaseException as exc:  # a syntax error, or code that fails as it loads
            emit({"type": "compile", "error": _error(exc, FILE)})
            return

    for index, test in enumerate(job["tests"]):
        result: dict = {"type": "test", "index": index}
        try:
            args = build_args(test, index)
        except BaseException as exc:
            emit({**result, "status": "invalid", "error": "Generator: " + _error(exc, GENERATOR_FILE)})
            continue
        if "generator" in test:
            result["preview"] = _preview(args)

        expected = json.loads(test["expected"]) if test.get("expected") is not None else None
        limit_s = job["timeLimitMs"] / 1000
        if reference is not None:
            try:
                ref_args = copy.deepcopy(args)  # each run gets its own copy, made before the clock starts
                ref_answer, ref_ms = _timed(REFERENCE_LIMIT_S, lambda: run_one(job, reference, ref_args))
            except BaseException as exc:
                # The test itself is broken (the reference can't handle it): it doesn't count.
                result["status"] = "invalid"
                result["error"] = "Reference: " + ("too slow" if isinstance(exc, TimeLimit) else _error(exc, REFERENCE_FILE))
                emit(result)
                continue
            result["refMs"] = ref_ms
            limit_s = min(MAX_LIMIT_S, max(MIN_LIMIT_S, SLOW_FACTOR * ref_ms / 1000))
            if expected is None:
                expected = ref_answer
            elif yours is None:
                # Check mode: the reference must match the test's own answer (the examples).
                result["status"] = "passed" if same(ref_answer, expected, any_order) else "wrong"
                result["output"] = _shown(ref_answer)
                emit(result)
                continue
        if yours is None:
            result["status"] = "passed"
            result["output"] = _shown(expected)
            emit(result)
            continue

        result["limitMs"] = round(limit_s * 1000)
        captured = io.StringIO()
        try:
            with redirect_stdout(captured):
                your_args = copy.deepcopy(args)
                actual, ms = _timed(limit_s, lambda: run_one(job, yours, your_args))
            result["ms"] = ms
            result["output"] = _shown(actual)
            result["status"] = "passed" if same(actual, expected, any_order) else "wrong"
        except TimeLimit:
            result["status"] = "timeout"
        except BaseException as exc:
            result["status"] = "error"
            result["error"] = _error(exc, FILE)
        if result["status"] != "passed" and expected is not None and "expected" not in test:
            result["expected"] = _shown(expected)
        stdout = captured.getvalue()
        if stdout:
            result["stdout"] = stdout[:MAX_STDOUT]
        emit(result)


def run_one(job: dict, ns: dict, args: list):
    """The code in ns on one test's arguments; returns the answer as plain JSON values."""
    if job["kind"] == "design":
        return run_design(job, ns, args)
    solution = ns["Solution"]()
    method = getattr(solution, job["entry"])
    values = [to_value(raw, t, ns) for raw, t in zip(args, job["params"])]
    answer = method(*values)
    # "Do it in place" problems return nothing; the changed input is the answer.
    if job.get("outputParam") is not None:
        i = job["outputParam"]
        return answer_value(values[i], job["params"][i])
    return answer_value(answer, job.get("returnType", ""))


def run_design(job: dict, ns: dict, args: list):
    """A design test is a script of calls: create the class, then call methods in order (#62 G)."""
    names, call_args = args
    design = job["design"]
    cls = ns[job["entry"]]
    ctor = [to_value(raw, t, ns) for raw, t in zip(call_args[0], design["ctor"])]
    obj = cls(*ctor)
    # Methods whose arguments are all plain values (most of them) skip conversion: a script can
    # have 200,000 calls, and per-call overhead would count against the code being timed.
    plain = {m: all(_kind(t) == "plain" for t in ts) for m, ts in design["methods"].items()}
    methods: dict = {}
    outputs = [None]
    for name, raw in zip(names[1:], call_args[1:]):
        method = methods.get(name) or methods.setdefault(name, getattr(obj, name))
        if not plain.get(name, True):
            raw = [to_value(v, t, ns) for v, t in zip(raw, design["methods"][name])]
        answer = method(*raw)
        outputs.append(answer if answer is None or isinstance(answer, (bool, int, float, str)) else answer_value(answer, ""))
    return outputs


if __name__ == "__main__":
    main()
