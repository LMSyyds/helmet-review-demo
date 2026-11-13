"""Single-reader model queue. SQLite is the source of truth for pending work."""
import json
import logging
import math
import shutil
from pathlib import Path
from threading import Event, Lock, Thread

from filelock import FileLock, Timeout

from .store import Store

log = logging.getLogger(__name__)


def load_detector():
    from model.adapter import Detector
    return Detector()


def validate(result, image):
    if not isinstance(result, dict) or result.get("prediction") not in ("helmet", "no_helmet", "unknown"):
        raise ValueError("模型图级结论无效")
    if (result.get("width"), result.get("height")) != (image["width"], image["height"]):
        raise ValueError("模型输出尺寸与上传图片坐标空间不一致")
    detections, vehicles = result.get("detections"), result.get("vehicles")
    if not isinstance(detections, list) or not isinstance(vehicles, list):
        raise ValueError("模型未返回检测框或车辆列表")
    detection_ids = set()
    for detection in detections:
        ident, box = detection["id"], detection["box"]
        if not isinstance(ident, str) or not ident or ident in detection_ids:
            raise ValueError("模型检测框 ID 无效或重复")
        if (not isinstance(box, (tuple, list)) or len(box) != 4
                or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in box)
                or not (0 <= box[0] < box[2] <= image["width"] and 0 <= box[1] < box[3] <= image["height"])):
            raise ValueError("模型检测框无效或超出原图")
        if not isinstance(detection.get("label"), str) or not 0 <= detection["confidence"] <= 1:
            raise ValueError("模型检测类别或置信度无效")
        detection_ids.add(ident)
    vehicle_ids = set()
    for vehicle in vehicles:
        ident = vehicle["id"]
        if (not isinstance(ident, str) or not ident or ident in vehicle_ids
                or vehicle["status"] not in ("violation", "clear", "review")
                or not isinstance(vehicle.get("reason"), str)):
            raise ValueError("模型车辆 ID、状态或理由无效")
        refs = vehicle["detection_ids"]
        if not isinstance(refs, list) or not set(refs).issubset(detection_ids):
            raise ValueError("车辆引用了无效检测框")
        vehicle_ids.add(ident)
    json.dumps(result, allow_nan=False)


class Service:
    def __init__(self, root, factory=load_detector):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.store = Store(self.root)
        self.lock = FileLock(str(self.root / ".service.lock"), thread_local=False)
        self.closed = Event()
        self.wake = Event()
        self.shutdown_lock = Lock()
        self.factory = factory
        self.detector = None
        try:
            self.lock.acquire(timeout=0)
        except Timeout as exc:
            raise RuntimeError(f"已有服务使用数据目录 {self.root}") from exc
        try:
            self.store.initialize()
            self._clean_unpublished()
            self.thread = Thread(target=self._run, name="helmet-inference", daemon=True)
            self.thread.start()
        except BaseException:
            self.lock.release()
            raise

    def _clean_unpublished(self):
        uploads = self.root / "uploads"
        uploads.mkdir(exist_ok=True)
        shutil.rmtree(self.root / ".staging", ignore_errors=True)
        with self.store.transaction() as con:
            published = {row[0] for row in con.execute("SELECT id FROM batches")}
        for directory in uploads.iterdir():
            if directory.is_dir() and len(directory.name) == 32 and directory.name not in published:
                if all(c in "0123456789abcdef" for c in directory.name):
                    shutil.rmtree(directory)

    def _run(self):
        while not self.closed.is_set():
            # Clear before polling so a concurrent enqueue cannot lose a notification.
            self.wake.clear()
            if self.closed.is_set():
                break
            try:
                image = self.store.claim()
                if not image:
                    self.wake.wait()
                    continue
                try:
                    if self.detector is None:
                        self.detector = self.factory()
                    result = self.detector.predict(str(self.root / image["display_path"]))
                    validate(result, image)
                    self.store.finish(image["id"], result)
                except Exception as exc:
                    log.exception("Inference failed for %s", image["id"])
                    self.store.fail(image["id"], f"{type(exc).__name__}: {exc}"[:2000])
            except Exception:
                log.exception("Queue access failed")
                self.closed.wait(1)

    def close(self):
        with self.shutdown_lock:
            self.closed.set()
            self.wake.set()
            self.thread.join()
            self.lock.release()
