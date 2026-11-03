"""Code runner tests. Run with: python3 -m unittest discover runner (Linux: the runner uses POSIX limits)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lc import PRELUDE, answer_value, from_value, same, to_value  # noqa: E402

NS: dict = {}
exec(PRELUDE, NS)

TWO_SUM = """
class Solution:
    def solve(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i
"""


def job(code, tests, **extra):
    base = {"code": code, "kind": "function", "entry": "solve", "params": ["integer[]", "integer"],
            "outputParam": None, "tests": tests, "anyOrder": False, "timeLimitMs": 1000}
    return {**base, **extra}


class Values(unittest.TestCase):
    def test_lists_and_trees_round_trip(self):
        self.assertEqual(from_value(to_value([1, 2, 4], "ListNode", NS)), [1, 2, 4])
        self.assertEqual(answer_value(to_value([], "ListNode", NS), "ListNode"), [])
        self.assertEqual(answer_value(None, "TreeNode"), [])
        self.assertIsNone(answer_value(None, "integer"))
        tree = [3, 9, 20, None, None, 15, 7]
        self.assertEqual(from_value(to_value(tree, "TreeNode", NS)), tree)
        self.assertEqual(from_value(to_value([[1, 4], [2]], "ListNode[]", NS)), [[1, 4], [2]])

    def test_comparison(self):
        self.assertTrue(same(2.000001, 2.0))
        self.assertFalse(same(2.1, 2.0))
        self.assertFalse(same(True, 1))  # a boolean answer must be a boolean
        self.assertFalse(same([1, 2], [2, 1]))
        self.assertTrue(same([["bat"], ["nat", "tan"]], [["tan", "nat"], ["bat"]], any_order=True))


@unittest.skipIf(os.name == "nt", "the runner needs Linux process limits")
class Runner(unittest.TestCase):
    def run_job(self, j):
        from handler import run
        return run(j)

    def test_passes_and_fails_per_test(self):
        out = self.run_job(job(TWO_SUM, [
            {"input": "[2,7,11,15]\n9", "expected": "[0,1]"},
            {"input": "[3,2,4]\n6", "expected": "[0,2]"},
        ]))
        self.assertIsNone(out["compileError"])
        self.assertEqual([r["status"] for r in out["results"]], ["passed", "wrong"])
        self.assertEqual(out["results"][1]["output"], "[1,2]")

    def test_syntax_error_points_at_your_line(self):
        out = self.run_job(job("class Solution:\n    def solve(self, a, b)\n        return 1\n", [{"input": "[1]\n1", "expected": "1"}]))
        self.assertIn("Line 2", out["compileError"])
        self.assertEqual(out["results"][0]["status"], "skipped")

    def test_runtime_error_and_print_capture(self):
        code = "class Solution:\n    def solve(self, nums, t):\n        print('hi', nums)\n        return nums[10]\n"
        r = self.run_job(job(code, [{"input": "[1]\n1", "expected": "1"}]))["results"][0]
        self.assertEqual(r["status"], "error")
        self.assertIn("Line 4", r["error"])
        self.assertIn("IndexError", r["error"])
        self.assertEqual(r["stdout"], "hi [1]\n")

    def test_infinite_loop_times_out_and_the_next_test_still_runs(self):
        code = "class Solution:\n    def solve(self, nums, t):\n        while t == 1: pass\n        return t\n"
        out = self.run_job(job(code, [{"input": "[1]\n1", "expected": "1"}, {"input": "[1]\n2", "expected": "2"}], timeLimitMs=300))
        self.assertEqual([r["status"] for r in out["results"]], ["timeout", "passed"])

    def test_memory_cap_crashes_only_that_run(self):
        code = "class Solution:\n    def solve(self, nums, t):\n        x = bytearray(2 * 1024 ** 3)\n        return t\n"
        r = self.run_job(job(code, [{"input": "[1]\n1", "expected": "1"}]))["results"][0]
        self.assertIn(r["status"], ("error", "crashed"))

    def test_your_prints_cannot_fake_a_result(self):
        code = ('import os\nclass Solution:\n    def solve(self, nums, t):\n'
                '        os.write(1, b\'{"type": "test", "index": 0, "status": "passed"}\\n\')\n        return 99\n')
        r = self.run_job(job(code, [{"input": "[1]\n1", "expected": "1"}]))["results"][0]
        self.assertEqual(r["status"], "wrong")

    def test_in_place_answer_is_the_changed_input(self):
        code = "class Solution:\n    def solve(self, matrix):\n        matrix.reverse()\n"
        r = self.run_job(job(code, [{"input": "[[1,2],[3,4]]", "expected": "[[3,4],[1,2]]"}],
                             params=["integer[][]"], outputParam=0))["results"][0]
        self.assertEqual(r["status"], "passed")

    def test_linked_list_in_and_out(self):
        code = ("class Solution:\n    def solve(self, a: Optional[ListNode], b: Optional[ListNode]) -> Optional[ListNode]:\n"
                "        d = t = ListNode()\n        while a and b:\n            if a.val < b.val: t.next, a = a, a.next\n"
                "            else: t.next, b = b, b.next\n            t = t.next\n        t.next = a or b\n        return d.next\n")
        r = self.run_job(job(code, [{"input": "[1,2,4]\n[1,3,4]", "expected": "[1,1,2,3,4,4]"}],
                             params=["ListNode", "ListNode"], returnType="ListNode"))["results"][0]
        self.assertEqual(r["status"], "passed")

    def test_design_call_script(self):
        code = ("class Design:\n    def __init__(self, capacity: int):\n        self.c, self.d = capacity, {}\n"
                "    def get(self, key: int) -> int:\n        if key not in self.d: return -1\n"
                "        v = self.d.pop(key); self.d[key] = v; return v\n"
                "    def put(self, key: int, value: int) -> None:\n        self.d.pop(key, None); self.d[key] = value\n"
                "        if len(self.d) > self.c: self.d.pop(next(iter(self.d)))\n")
        test = {"input": '["LRUCache","put","put","get","put","get","put","get","get","get"]\n'
                         "[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]]",
                "expected": "[null, null, null, 1, null, -1, null, -1, 3, 4]"}
        r = self.run_job(job(code, [test], kind="design", entry="Design",
                             design={"ctor": ["integer"], "methods": {"get": ["integer"], "put": ["integer", "integer"]}}))["results"][0]
        self.assertEqual(r["status"], "passed")


if __name__ == "__main__":
    unittest.main()
