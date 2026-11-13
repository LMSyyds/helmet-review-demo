"""Backend persistence and failure regressions. No checkpoint or park photos needed."""
import io
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image
from werkzeug.datastructures import MultiDict

from .app import create_app


def photo(width=20, rotation=None):
    stream = io.BytesIO()
    exif = Image.Exif()
    if rotation:
        exif[274] = rotation
    Image.new("RGB", (width, 12)).save(stream, "JPEG", exif=exif)
    return stream.getvalue()


class FixtureDetector:
    def __init__(self):
        self.calls = []
        self.gate = threading.Event()
        self.gate.set()

    def predict(self, path):
        self.gate.wait(5)
        with Image.open(path) as image:
            w, h = image.size
        self.calls.append(w)
        if w == 21 and self.calls.count(21) == 1:
            raise RuntimeError("temporary model failure")
        if w == 22:
            return dict(width=w, height=h, prediction="unknown", detections=[], vehicles=[])
        boxes = [dict(id="d1", box=[0, 1, 3, 4], label="DNoHelmet", confidence=.9)]
        vehicles = [dict(id="v1", detection_ids=["d1"], status="violation", reason="驾驶人未戴盔"),
                    dict(id="v2", detection_ids=[], status="review", reason="另一车辆待核实")]
        return dict(width=w, height=h, prediction="no_helmet", detections=boxes, vehicles=vehicles,
                    additional_metadata={"checkpoint": "fixture"})


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "data"
        self.dist = Path(self.temp.name) / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text("frontend")
        self.detector = FixtureDetector()
        self.start()

    def start(self):
        self.app = create_app(self.root, lambda: self.detector, self.dist)
        self.service = self.app.extensions["helmet_service"]
        self.client = self.app.test_client()

    def tearDown(self):
        self.detector.gate.set()
        self.service.close()
        self.temp.cleanup()

    def upload(self, files, labels=None):
        parts = MultiDict([("name", "演示")])
        for name, payload in files:
            parts.add("files", (io.BytesIO(payload), name))
        if labels is not None:
            parts.add("labels", (io.BytesIO(labels.encode("utf-8-sig")), "标签.csv"))
        return self.client.post("/api/batches", data=parts)

    def settled(self, batch):
        for _ in range(300):
            data = self.client.get("/api/batches/" + batch).json
            if data["status"] != "running":
                return data
            time.sleep(.01)
        self.fail("worker did not settle")

    def test_queue_score_ledger_and_audit(self):
        b = self.upload([("乙.jpg", photo()), ("甲.jpg", photo(21)), ("丙.jpg", photo(22))],
                        "filename,prediction\n乙.jpg,no_helmet\n丙.jpg,helmet\n").json
        ids = [x["id"] for x in b["images"]]
        run = "/api/batches/" + b["id"] + "/run"
        self.assertEqual(self.client.post(run, json={"image_ids": [ids[0], "foreign"]}).status_code, 400)
        self.detector.gate.clear()
        with ThreadPoolExecutor(4) as pool:
            def enqueue(_):
                return self.app.test_client().post(run, json={"image_ids": [ids[1], ids[0], ids[0]]}).json
            responses = list(pool.map(enqueue, range(6)))
        self.assertEqual(sum(r["accepted"] for r in responses), 2)
        self.assertEqual(self.client.get("/api/batches/" + b["id"]).json["status"], "running")
        with self.assertLogs("backend.worker", level="ERROR"):
            self.detector.gate.set()
            data = self.settled(b["id"])
        self.assertEqual(data["status"], "error")
        self.assertEqual([r["status"] for r in data["images"]], ["done", "error", "pending"])
        self.assertIn("temporary model failure", data["images"][1]["error"])
        self.assertEqual(data["score"], {"correct": 1, "total": 1})
        self.assertEqual(self.client.post(run, json={}).json["accepted"], 2)
        data = self.settled(b["id"])
        self.assertEqual((data["status"], data["processed"]), ("done", 3))
        self.assertEqual(self.detector.calls, [20, 21, 21, 22])
        self.assertEqual(data["score"], {"correct": 1, "total": 2})
        self.assertEqual(self.client.post(run, json={}).json["accepted"], 0)
        before = self.client.get("/api/images/" + ids[0]).json["model_result"]
        self.assertEqual(before["additional_metadata"]["checkpoint"], "fixture")
        review_rows = self.client.get("/api/reviews").json
        self.assertEqual([r["filename"] for r in review_rows], ["乙.jpg", "甲.jpg", "丙.jpg"])
        self.assertIsNone(review_rows[-1]["vehicle_id"])
        self.assertEqual(self.client.get("/api/images/" + ids[-1]).json["vehicles"], [])
        e = review_rows[0]["id"]
        with ThreadPoolExecutor(3) as pool:
            def confirm(_):
                return self.app.test_client().post("/api/reviews/" + e,
                    json={"decision": "violation", "note": "人工确认", "revision": 0}).status_code
            self.assertEqual(list(pool.map(confirm, range(6))), [200] * 6)
        self.assertEqual(len(self.client.get("/api/violations").json), 3)
        self.assertEqual([r["id"] for r in self.client.get("/api/violations?source=human").json], [e])
        self.assertEqual(self.client.post("/api/reviews/" + e, json={"decision": "clear", "revision": 0}).status_code, 409)
        self.assertEqual(self.client.post("/api/reviews/" + e, json={"decision": "clear", "revision": 1}).status_code, 200)
        self.assertEqual(len(self.client.get("/api/violations").json), 2)
        self.assertEqual(len(self.client.get("/api/events/" + e).json["history"]), 2)
        self.service.close()
        self.start()
        self.assertEqual(self.client.get("/api/images/" + ids[0]).json["model_result"], before)
        self.assertEqual(self.client.get("/api/batches/" + b["id"]).json["score"], data["score"])
        self.assertEqual(self.client.get("/api/events/" + e).json["revision"], 2)

    def test_designated_vehicle_and_ambiguous_targets(self):
        def multiple_bikes(path):
            boxes = [dict(id="a", box=[0, 0, 8, 10], label="motorbike", confidence=.9),
                     dict(id="b", box=[10, 0, 20, 10], label="motorbike", confidence=.95)]
            vehicles = [dict(id="other", detection_ids=["a"], status="violation", reason="旁车未戴盔"),
                        dict(id="target", detection_ids=["b"], status="clear", reason="目标已戴盔")]
            return dict(width=20, height=12, prediction="no_helmet", detections=boxes, vehicles=vehicles)
        self.detector.predict = multiple_bikes
        header = "filename,prediction,target_x1,target_y1,target_x2,target_y2\n"
        csv_data = (header + "指定.jpg,no_helmet,10,0,20,10\n" + "无匹配.jpg,,0,10,8,12\n"
                    + "歧义.jpg,,0,0,20,10\n" + "普通.jpg,helmet,,,,\n")
        files = [(name, photo()) for name in ("指定.jpg", "无匹配.jpg", "歧义.jpg", "普通.jpg")]
        for bad in ("1,2,5,", "2,1,1,5", "0,0,21,12", "NaN,0,1,2"):
            self.assertEqual(self.upload(files, header + "指定.jpg,," + bad).status_code, 400)
        only_target = self.upload(files[:1], "filename,target_x1,target_y1,target_x2,target_y2\n指定.jpg,10,0,20,10")
        self.assertEqual(only_target.status_code, 201)
        b = self.upload(files, csv_data).json
        self.client.post("/api/batches/" + b["id"] + "/run", json={})
        self.assertEqual(self.settled(b["id"])["score"], {"correct": 1, "total": 2})
        info = self.client.get("/api/images/" + b["images"][0]["id"]).json
        self.assertEqual((len(info["model_result"]["vehicles"]), len(info["vehicles"])), (2, 1))
        self.assertEqual((info["events"][0]["status"], info["events"][0]["vehicle_id"]), ("clear", "target"))
        self.assertEqual(info["events"][0]["detection_ids"], ["b"])
        self.assertEqual(info["events"][0]["target_box"], [10, 0, 20, 10])
        self.assertEqual([e["filename"] for e in self.client.get("/api/violations").json], ["普通.jpg"])
        pending = self.client.get("/api/reviews").json
        self.assertEqual([e["filename"] for e in pending], ["无匹配.jpg", "歧义.jpg"])
        self.assertTrue(all(e["scope"] == "target" and not e["detection_ids"] and e["vehicle_id"] is None for e in pending))

    def test_interrupted_queue_and_single_owner(self):
        first, second = [self.upload([(str(i) + ".jpg", photo())]).json for i in range(2)]
        self.assertEqual([r["id"] for r in self.client.get("/api/batches").json], [second["id"], first["id"]])
        with self.assertRaises(RuntimeError):
            create_app(self.root)
        self.service.close()
        with self.service.store.transaction(write=True) as con:
            con.execute("UPDATE images SET status='running',attempts=1 WHERE batch_id=?", (first["id"],))
            con.execute("UPDATE images SET queued=1 WHERE batch_id=?", (second["id"],))
        self.start()
        for batch, attempts in [(first, 2), (second, 1)]:
            d = self.settled(batch["id"])
            self.assertEqual(d["status"], "done")
            self.assertEqual(d["images"][0]["attempts"], attempts)
        self.assertEqual(len(self.client.get("/api/violations").json), 2)

    def test_atomic_upload_and_orientation(self):
        payload = photo(rotation=6)
        failures = [
            ([("好.jpg", payload), ("坏.jpg", b"bad")], None),
            ([("图.jpg", payload), ("图.jpg", payload)], None),
            ([("../a.jpg", payload)], None),
            ([("图.jpg", payload)], "filename,prediction\nother.jpg,helmet"),
            ([("图.jpg", payload)], "filename,prediction\n图.jpg,invalid"),
            ([("图.jpg", payload)], "filename,prediction\n图.jpg,helmet\n图.jpg,helmet"),
        ]
        for files, labels in failures:
            self.assertEqual(self.upload(files, labels).status_code, 400)
        self.assertEqual(self.client.get("/api/batches").json, [])
        self.assertEqual(list((self.root / "uploads").iterdir()), [])
        photo_info = self.upload([("旋转.jpg", payload)]).json["images"][0]
        self.assertEqual((photo_info["width"], photo_info["height"]), (12, 20))
        path = "/api/images/" + photo_info["id"]
        with self.client.get(path + "/uploaded") as response:
            self.assertEqual(response.data, payload)
        with self.client.get(path + "/original") as response:
            self.assertEqual(Image.open(io.BytesIO(response.data)).size, (12, 20))
        with self.client.get("/workspace") as response:
            self.assertEqual(response.data, b"frontend")
        self.assertEqual(self.client.get("/missing.js").status_code, 404)
        self.assertEqual(self.client.get("/api/missing").status_code, 404)


if __name__ == "__main__":
    unittest.main()
