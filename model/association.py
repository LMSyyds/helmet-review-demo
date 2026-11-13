"""Associate whole-rider boxes with motorbikes. IDs are local to one picture."""
from collections import Counter, defaultdict
from itertools import combinations


def _intersection(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def _area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


def _overlap(a, b):
    return _intersection(a, b) / min(_area(a), _area(b))


def _iou(a, b):
    inter = _intersection(a, b)
    return inter / (_area(a) + _area(b) - inter)


def _event(ident, items, status, reason, scope):
    return dict(id=ident, detection_ids=[d["id"] for d in items], status=status,
                reason=reason, scope=scope)


def _panel_events(items):
    motors = [d for d in items if d["label"] == "motorbike"]
    riders = [d for d in items if d["label"] != "motorbike"]
    assigned = defaultdict(list)
    unresolved = []
    uncertain_motors = set()
    for rider in riders:
        candidates = [m for m in motors if _overlap(rider["box"], m["box"]) > 0.30]
        if len(candidates) == 1:
            assigned[candidates[0]["id"]].append(rider)
        else:
            unresolved.append(rider)
            possible = candidates or [m for m in motors if _intersection(rider["box"], m["box"]) > 0]
            uncertain_motors.update(m["id"] for m in possible)

    events = []
    pending = []
    # Overlapping duplicate vehicle hypotheses cannot create multiple events.
    for a, b in combinations(motors, 2):
        if _iou(a["box"], b["box"]) >= 0.60:
            uncertain_motors.update((a["id"], b["id"]))
    for motor in motors:
        crew = assigned[motor["id"]]
        members = [motor, *crew]
        if motor["id"] in uncertain_motors:
            pending.extend(members)
            continue
        role_counts = Counter(rider["role"] for rider in crew)
        same_person = any(_iou(a["box"], b["box"]) >= 0.80 for a, b in combinations(crew, 2))
        if not crew:
            status, reason = "review", "车辆附近未能关联到骑乘人员。"
        elif same_person or max(role_counts.values()) > 1:
            status, reason = "review", "同一角色重复或人员框高度重合，请确认人数和戴盔类别。"
        elif any(not r["helmet"] for r in crew):
            offenders = ["驾驶人" if r["role"] == "D" else "乘客 " + r["role"] for r in crew if not r["helmet"]]
            status, reason = "violation", "同车" + "、".join(offenders) + "检出未戴盔。"
        elif role_counts["D"] == 1:
            status, reason = "clear", "已关联的驾驶人及检出的同车乘客均为戴盔。"
        else:
            status, reason = "review", "仅检出戴盔乘客，驾驶人状态待核实。"
        events.append(_event("vehicle-" + motor["id"], members, status, reason, "vehicle"))
    if pending or unresolved:
        events.append(_event("unresolved-" + items[0]["panel"], pending + unresolved,
                             "review", "这些检测框无法唯一归属到车辆，请核对原图。", "unresolved"))
    return events


def _same_motor(gray, rectangles):
    """Require consistent local features on the detected vehicle in every view."""
    import cv2
    import numpy as np

    orb = cv2.ORB_create(nfeatures=500, edgeThreshold=8)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    features = []
    for box in rectangles:
        x1, y1, x2, y2 = map(round, box)
        if x2 - x1 < 32 or y2 - y1 < 32:
            return False
        patch = cv2.resize(gray[y1:y2, x1:x2], (192, 192))
        keypoints, descriptors = orb.detectAndCompute(patch, None)
        if descriptors is None or len(keypoints) < 12:
            return False
        features.append((keypoints, descriptors))

    first_points, first_desc = features[0]
    for points, desc in features[1:]:
        pairs = matcher.knnMatch(first_desc, desc, k=2)
        good = [a for a, b in pairs if a.distance < 0.72 * b.distance]
        if len(good) < 12:
            return False
        source = np.float32([first_points[m.queryIdx].pt for m in good])
        dest = np.float32([points[m.trainIdx].pt for m in good])
        transform, mask = cv2.estimateAffinePartial2D(source, dest, method=cv2.RANSAC,
                                                       ransacReprojThreshold=4)
        if transform is None or mask is None:
            return False
        inliers = mask.ravel().astype(bool)
        if inliers.sum() < 12 or inliers.mean() < 0.65:
            return False
        # Distributed matches prevent a single sticker or nearby corner deciding identity.
        if min(np.ptp(source[inliers], axis=0)) < 50 or min(np.ptp(dest[inliers], axis=0)) < 50:
            return False
    return True


def describe_vehicles(panels, detections, path):
    by_view = defaultdict(list)
    for det in detections:
        by_view[det["panel"]].append(det)
    events = [_panel_events(by_view[p["id"]]) for p in panels]
    if len(panels) == 1:
        return events[0] or [_event("unresolved-image", [], "review", "未检出有效车辆或骑乘人员。", "unresolved")]

    # Cross-panel evidence is joined only for a single unambiguous vehicle in every view.
    if all(len(rows) == 1 and rows[0]["status"] != "review" for rows in events):
        first = events[0][0]
        crews = [Counter(d["label"] for d in by_view[p["id"]]) for p in panels]
        if all(crew == crews[0] for crew in crews) and all(rows[0]["status"] == first["status"] for rows in events):
            import cv2
            import numpy as np
            gray = cv2.imdecode(np.fromfile(path, dtype=np.uint8),
                                cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
            if gray is None:
                raise ValueError("跨面板核对时无法读取原图")
            motors = [d["box"] for d in detections if d["label"] == "motorbike"]
            if _same_motor(gray, motors):
                return [_event("vehicle-multiview", detections, first["status"],
                               first["reason"] + "各面板单车结论一致，车辆区域存在对应特征。", "vehicle")]
    event = _event("unresolved-image", detections, "review",
                   "拼图中的车辆身份或骑乘证据未能跨面板唯一对应，请按原图复核一次。", "unresolved")
    event["panel_candidates"] = [row for rows in events for row in rows]
    return [event]
