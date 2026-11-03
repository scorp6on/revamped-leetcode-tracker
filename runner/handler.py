"""The Code runner Lambda (#17, #62 B): runs a submission against its tests and reports each one.

It has no AWS permissions and no network, and the code runs in a child process with a memory cap and
a time limit per test, so a runaway loop or a huge allocation only ends that run.

Event:  {code (None = check mode), reference?, kind: "function"|"design", entry, params, outputParam,
         design, tests: [{input | generator, seed?, expected?}], anyOrder, timeLimitMs}
Result: {compileError: str|None, results: [{status: passed|wrong|error|timeout|invalid|crashed|skipped,
         ms?, refMs?, limitMs?, output?, expected?, preview?, error?, stdout?}]}
"""

import json
import os
import resource
import secrets
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MEMORY_BYTES = 512 * 1024 * 1024
MAX_WALL_S = 22  # the whole run, as a backstop to the per-test limits (the Lambda allows 25)
MAX_OUTPUT_BYTES = 2_000_000


def _limits() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1_000_000, 1_000_000))  # /tmp writes stay small


def run(job: dict) -> dict:
    tests = job["tests"]
    marker = "@@" + secrets.token_hex(8) + "@@"
    payload = json.dumps({**job, "marker": marker})
    # With a reference each test can take its 2 s plus your up-to-3 s limit.
    per_test = job["timeLimitMs"] / 1000 + (5 if job.get("reference") else 0)
    wall = min(MAX_WALL_S, 2 + len(tests) * per_test)
    try:
        proc = subprocess.run(
            [sys.executable, "-E", "-s", os.path.join(HERE, "worker.py")],
            input=payload.encode(),
            capture_output=True,
            timeout=wall,
            preexec_fn=_limits,
            cwd="/tmp" if os.path.isdir("/tmp") else None,
            env={"PYTHONHASHSEED": "0", "PYTHONIOENCODING": "utf-8"},
        )
        stdout = proc.stdout[:MAX_OUTPUT_BYTES].decode("utf-8", "replace")
        crashed = proc.returncode != 0
        stderr = proc.stderr.decode("utf-8", "replace")[-500:]
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"")[:MAX_OUTPUT_BYTES].decode("utf-8", "replace")
        crashed, stderr = True, ""

    compile_error = None
    results: list = [None] * len(tests)
    for line in stdout.split("\n"):
        if not line.startswith(marker):
            continue  # your own prints to the real stdout
        try:
            event = json.loads(line[len(marker):])
        except ValueError:
            continue  # cut off by the output cap: that test shows as crashed below
        if event["type"] == "compile":
            compile_error = event["error"]
        elif event["type"] == "test" and 0 <= event["index"] < len(tests):
            event.pop("type")
            results[event.pop("index")] = event

    # The process died mid-run: the test it was on crashed it, the rest never ran.
    first_missing = True
    for i, r in enumerate(results):
        if r is None:
            if compile_error:
                results[i] = {"status": "skipped"}
            elif first_missing and crashed:
                results[i] = {"status": "crashed", "error": _crash_reason(stderr)}
                first_missing = False
            else:
                results[i] = {"status": "skipped"}
    return {"compileError": compile_error, "results": results}


def _crash_reason(stderr: str) -> str:
    if "MemoryError" in stderr:
        return "Memory limit exceeded"
    return "Your code stopped the run (too slow overall, out of memory, or a crash)"


def lambda_handler(event, context):
    return run(event)
