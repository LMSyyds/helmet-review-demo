"""Run with python -m unittest model.test_association from the website root."""
import unittest

from .association import describe_vehicles


def det(ident, box, label="motorbike", panel="full"):
    role = label.split("Helmet")[0].removesuffix("No") if label != "motorbike" else None
    return dict(id=ident, panel=panel, box=box, label=label, role=role,
                helmet=None if role is None else "NoHelmet" not in label)


def single(*detections):
    return describe_vehicles([{"id": "full"}], detections, None)


class Associations(unittest.TestCase):
    def test_one_record_for_driver_and_passenger(self):
        rows = single(det("bike", [0, 45, 100, 100]),
                      det("driver", [45, 10, 90, 90], "DHelmet"),
                      det("front", [10, 20, 50, 95], "P0NoHelmet"))
        self.assertEqual(["violation"], [r["status"] for r in rows])
        self.assertEqual({"bike", "driver", "front"}, set(rows[0]["detection_ids"]))

    def test_two_distinct_motorbikes(self):
        rows = single(det("one", [0, 45, 80, 100]), det("two", [100, 45, 180, 100]),
                      det("a", [5, 10, 75, 93], "DHelmet"), det("b", [100, 15, 165, 95], "DNoHelmet"))
        self.assertEqual(["clear", "violation"], [r["status"] for r in rows])
        self.assertEqual(["two", "b"], rows[1]["detection_ids"])

    def test_ambiguous_rider_and_conflicting_labels(self):
        rows = single(det("one", [0, 42, 90, 100]), det("two", [30, 41, 120, 100]),
                      det("a", [20, 5, 85, 96], "DNoHelmet"))
        self.assertEqual(["review"], [r["status"] for r in rows])
        rows = single(det("one", [0, 42, 90, 100]), det("a", [20, 5, 85, 96], "DNoHelmet"),
                      det("b", [20, 5, 85, 96], "DHelmet"))
        self.assertEqual(["review"], [r["status"] for r in rows])

    def test_missing_or_weak_evidence(self):
        cases = [(), (det("only-rider", [0, 5, 50, 60], "DNoHelmet"),),
                 (det("only-bike", [0, 5, 70, 90]),),
                 (det("one", [0, 42, 90, 100]), det("a", [20, 5, 85, 96], "DHelmet"),
                  det("b", [20, 5, 85, 44], "P1NoHelmet"))]
        for items in cases:
            with self.subTest(items=items):
                self.assertEqual(["review"], [r["status"] for r in single(*items)])

    def test_conflicting_panels_produce_one_review(self):
        items = [det("a", [0, 40, 90, 100], panel="top"),
                 det("b", [10, 5, 85, 90], "DHelmet", "top"),
                 det("c", [0, 140, 90, 200], panel="bottom"),
                 det("d", [10, 105, 85, 190], "DNoHelmet", "bottom")]
        rows = describe_vehicles([{"id": "top"}, {"id": "bottom"}], items, None)
        self.assertEqual(["review"], [row["status"] for row in rows])
        self.assertEqual(2, len(rows[0]["panel_candidates"]))
