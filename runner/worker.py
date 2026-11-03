"""Runs one submission against its tests. Started by handler.py as a separate, limited process.

Reads the job as JSON on stdin. Writes one line per event to the real stdout, each starting with the
job's marker, so anything your code prints can't be mistaken for a result:
  <marker>{"type": "compile", "error": "..."}           your code didn't load
  <marker>{"type": "test", "index": 0, "status": ...}   one per test, as it finishes
"""

import io
import json
import os
import signal
import sys
import time
import traceback
from contextlib import redirect_stdout

from lc import PRELUDE, answer_value, from_value, parse_lines, same, show, to_value

MAX_STDOUT = 2000  # characters of your print output kept per test
FILE = "solution.py"


class TimeLimit(Exception):
    pass


def _on_alarm(signum, frame):
    raise TimeLimit()


def _user_error(exc: BaseException) -> str:
    """The error as LeetCode shows it: the line in your code, then the exception."""
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == FILE:
            line = frame.lineno
    if isinstance(exc, SyntaxError) and exc.filename == FILE:
        line = exc.lineno
    text = "".join(traceback.format_exception_only(type(exc), exc)).strip()
    return f"Line {line}: {text}" if line else text


def main() -> None:
    job = json.loads(sys.stdin.read())
    out = os.fdopen(os.dup(1), "w")  # the real stdout, before your code can touch sys.stdout
    marker = job["marker"]

    def emit(event: dict) -> None:
        out.write(marker + json.dumps(event) + "\n")
        out.flush()

    sys.setrecursionlimit(10_000)
    signal.signal(signal.SIGALRM, _on_alarm)
    limit_s = job["timeLimitMs"] / 1000

    ns: dict = {"__name__": "solution"}
    try:
        exec(compile(PRELUDE, "<prelude>", "exec"), ns)
        with redirect_stdout(io.StringIO()):
            exec(compile(job["code"], FILE, "exec"), ns)
    except BaseException as exc:  # a syntax error, or code that fails as it loads
        emit({"type": "compile", "error": _user_error(exc)})
        return

    for index, test in enumerate(job["tests"]):
        captured = io.StringIO()
        result: dict = {"type": "test", "index": index}
        try:
            args = parse_lines(test["input"])
            expected = json.loads(test["expected"])
            start = time.perf_counter()
            signal.setitimer(signal.ITIMER_REAL, limit_s)
            try:
                with redirect_stdout(captured):
                    actual = run_one(job, ns, args)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
            result["ms"] = round((time.perf_counter() - start) * 1000, 2)
            result["output"] = show(actual)
            result["status"] = "passed" if same(actual, expected, job.get("anyOrder", False)) else "wrong"
        except TimeLimit:
            result["status"] = "timeout"
        except RecursionError as exc:
            result["status"] = "error"
            result["error"] = _user_error(exc) + " (recursion too deep)"
        except BaseException as exc:
            result["status"] = "error"
            result["error"] = _user_error(exc)
        stdout = captured.getvalue()
        if stdout:
            result["stdout"] = stdout[:MAX_STDOUT]
        emit(result)


def run_one(job: dict, ns: dict, args: list):
    """Your code on one test's inputs; returns the answer as plain JSON values."""
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
    outputs = [None]
    for name, raw in zip(names[1:], call_args[1:]):
        params = design["methods"].get(name, [])
        values = [to_value(v, t, ns) for v, t in zip(raw, params)]
        outputs.append(from_value(getattr(obj, name)(*values)))
    return outputs


if __name__ == "__main__":
    main()
