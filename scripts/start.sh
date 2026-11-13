#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
runtime_python=${HELMET_PYTHON:-.venv/bin/python}
model_dir=${HELMET_MODEL_DIR:-model/runtime/CoDETR_v1_epoch_2}
if ! "$runtime_python" -c "import importlib.util as u, sys; sys.exit(any(u.find_spec(m) is None for m in ('flask', 'waitress', 'mmcv', 'torch')))"; then
    echo '请按 README 准备包含网站与 Co-DETR 依赖的 Python 3.11 环境。' >&2
    exit 1
fi
if [ ! -f "$model_dir/weights/v1_epoch_2.pth" ]; then
    echo '未找到 v1_epoch_2.pth。将交付包解压到 model/runtime，或设置 HELMET_MODEL_DIR。' >&2
    exit 1
fi
if [ ! -f "${HELMET_FRONTEND_DIST:-frontend/dist}/index.html" ]; then
    echo '请先运行 npm --prefix frontend ci 和 npm --prefix frontend run build。' >&2
    exit 1
fi
exec "$runtime_python" -m backend --host "${HELMET_HOST:-127.0.0.1}" --port "${HELMET_PORT:-8765}"
