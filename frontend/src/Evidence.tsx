import { useState } from 'react'
import {
  Aperture,
  Bike,
  Expand,
  Eye,
  ImageOff,
  Layers,
  ScanLine,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  imgUrl,
  labelInfo,
  modelName,
  predName,
  type Detail,
  type Detection,
} from './data'
import { Badge, Dialog, Empty } from './ui'
type Mode = 'all' | 'original' | 'vehicle' | 'rider'
const modes: { id: Mode; text: string; icon: LucideIcon }[] = [
  { id: 'original', text: '原图', icon: Eye },
  { id: 'vehicle', text: '整车框', icon: Bike },
  { id: 'rider', text: '骑乘人员框', icon: Users },
  { id: 'all', text: '全部框', icon: Layers },
]
function Frame({
  photo,
  mode,
  only,
  large = false,
  zoom = 1,
}: {
  photo: Detail
  mode: Mode
  only?: string[]
  large?: boolean
  zoom?: number
}) {
  const [natural, setNatural] = useState<[number, number]>()
  const [failed, setFailed] = useState(false)
  const w = photo.width,
    h = photo.height
  const validSize = w > 0 && h > 0
  const aligned = natural && validSize && natural[0] === w && natural[1] === h
  const realBoxes = (photo.detections || []).filter(
    (d) =>
      (!only || only.includes(d.id)) &&
      (mode === 'all' || mode === labelInfo(d.label).group)
  )
  function box(d: Detection, sourceTarget = false) {
    const [x1, y1, x2, y2] = d.box || []
    if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1)
      return null
    const info = sourceTarget
      ? { name: '来源指定车辆', tone: 'target' }
      : labelInfo(d.label)
    const x = Math.max(0, Math.min(w, x1)),
      y = Math.max(0, Math.min(h, y1))
    const width = Math.min(x2, w) - x,
      height = Math.min(y2, h) - y
    if (width <= 0 || height <= 0) return null
    return (
      <div
        key={d.id}
        className={'bbox ' + info.tone}
        style={{
          left: (x / w) * 100 + '%',
          top: (y / h) * 100 + '%',
          width: (width / w) * 100 + '%',
          height: (height / h) * 100 + '%',
        }}
        title={
          sourceTarget
            ? info.name
            : info.name + ' ' + Math.round(d.confidence * 100) + '%'
        }
      >
        <span
          className={
            (y / h < 0.1 ? 'inside ' : '') + (x / w > 0.68 ? 'align-end' : '')
          }
        >
          {info.name}
        </span>
      </div>
    )
  }
  const ratio = natural ? natural[0] / natural[1] : validSize ? w / h : 1.6
  return (
    <>
      <div
        className={
          'image-stage ' +
          (large ? 'expanded' : '') +
          (zoom > 1 ? ' zoomed' : '')
        }
        tabIndex={zoom > 1 ? 0 : undefined}
        aria-label={zoom > 1 ? '放大画面，可滚动查看' : undefined}
      >
        {failed ? (
          <Empty
            title="原图读取失败"
            icon={ImageOff}
            action={
              <button className="secondary" onClick={() => setFailed(false)}>
                重新读取
              </button>
            }
          />
        ) : (
          <div
            className="image-plane"
            style={{
              width:
                zoom > 1
                  ? 'calc(min(100%, ' + ratio * 70 + 'vh) * ' + zoom + ')'
                  : 'min(100%, calc(' +
                    ratio +
                    ' * ' +
                    (large ? '70vh' : '51vh') +
                    '))',
            }}
          >
            <img
              src={imgUrl(photo.id)}
              alt={'现场原图：' + photo.filename}
              onError={() => setFailed(true)}
              onLoad={(e) =>
                setNatural([
                  e.currentTarget.naturalWidth,
                  e.currentTarget.naturalHeight,
                ])
              }
            />
            {aligned && mode !== 'original' && realBoxes.map((d) => box(d))}
            {aligned &&
              mode !== 'original' &&
              photo.target_box &&
              box(
                {
                  id: 'source-target',
                  label: '',
                  box: photo.target_box,
                  confidence: 0,
                },
                true
              )}
          </div>
        )}
      </div>
      <div className="image-foot">
        <span>
          <Aperture size={14} />
          {validSize
            ? w + ' × ' + h + ' px'
            : natural
              ? natural.join(' × ') + ' px'
              : '原始分辨率'}
        </span>
        <span>
          {mode === 'original'
            ? '原始画面'
            : !aligned && natural
              ? '缺少匹配的原图坐标'
              : realBoxes.length + ' 个检测框'}
          {mode !== 'original' && photo.target_box
            ? ' · 黄色虚线为来源指定车辆'
            : ''}
        </span>
      </div>
    </>
  )
}
export function Evidence({
  photo,
  focusIds,
}: {
  photo: Detail
  focusIds?: string[]
}) {
  const [mode, setMode] = useState<Mode>('all')
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [limit, setLimit] = useState(Boolean(focusIds?.length))
  const controls = (
    <div className="mode-switch" aria-label="证据图层">
      {modes.map((m) => (
        <button
          key={m.id}
          aria-pressed={mode === m.id}
          onClick={() => setMode(m.id)}
        >
          <m.icon size={15} />
          {m.text}
        </button>
      ))}
    </div>
  )
  const only = limit && focusIds?.length ? focusIds : undefined
  const det = (photo.detections || []).filter(
    (d) => !only || only.includes(d.id)
  )
  return (
    <section className="evidence">
      <div className="evidence-top">
        {controls}
        <button
          className="icon-btn"
          aria-label="放大查看原图与检测框"
          onClick={() => {
            setZoom(1)
            setExpanded(true)
          }}
        >
          <Expand size={17} />
        </button>
      </div>
      {focusIds?.length ? (
        <label className="check-inline focus-check">
          <input
            type="checkbox"
            checked={limit}
            onChange={(e) => setLimit(e.target.checked)}
          />
          仅看本事件关联检测框
        </label>
      ) : null}
      <Frame key={photo.id} photo={photo} mode={mode} only={only} />
      <div className="readouts">
        <div>
          <small>模型图级结论</small>
          <Badge value={photo.status === 'done' ? photo.prediction : null} />
        </div>
        <div>
          <small>独立人工标签</small>
          <b>{photo.truth ? predName[photo.truth] : '未提供'}</b>
        </div>
        <div>
          <small>识别模型</small>
          <b>{photo.model_version || modelName}</b>
        </div>
      </div>
      {photo.error && (
        <p className="inline-error" role="alert">
          {photo.error}
        </p>
      )}
      {det.length > 0 && (
        <details className="detections">
          <summary>
            <ScanLine size={16} /> 检测明细（{det.length}）
          </summary>
          <div className="detection-list">
            {det.map((d) => (
              <div key={d.id}>
                <b>{labelInfo(d.label).name}</b>
                <span>
                  {Number.isFinite(d.confidence)
                    ? Math.round(d.confidence * 100) + '%'
                    : '—'}
                </span>
                <small>
                  {d.label} · [{d.box.join(', ')}]
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
      {expanded && (
        <Dialog title={photo.filename} large onClose={() => setExpanded(false)}>
          <div className="zoom-tools">
            {controls}
            <div className="mode-switch" aria-label="画面缩放">
              {[1, 2, 4].map((n) => (
                <button
                  key={n}
                  aria-pressed={zoom === n}
                  onClick={() => setZoom(n)}
                >
                  {n === 1 ? '适应窗口' : n + ' 倍放大'}
                </button>
              ))}
            </div>
          </div>
          <Frame
            key={photo.id}
            photo={photo}
            mode={mode}
            only={only}
            large
            zoom={zoom}
          />
        </Dialog>
      )}
    </section>
  )
}
