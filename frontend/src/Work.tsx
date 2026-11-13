import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  FileImage,
  Folder,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  Search,
  Upload,
} from 'lucide-react'
import {
  api,
  eventScope,
  go,
  message,
  pathId,
  post,
  useRemote,
  type Batch,
  type Detail,
  type EventRow,
  type Index,
} from './data'
import { Badge, Empty, Fault, SectionHead } from './ui'
import { Evidence } from './Evidence'
export function Work({
  index,
  params,
  upload,
  refresh,
}: {
  index?: Index
  params: URLSearchParams
  upload: () => void
  refresh: () => void
}) {
  const current = params.get('batch') || index?.batches[0]?.id || ''
  const requested = params.get('image') || ''
  const batch = useRemote(
    current,
    () => api<Batch>('/batches/' + pathId(current)),
    current ? 2500 : 0
  )
  const data = batch.data
  const photos = useMemo(() => data?.images || [], [data])
  const active = photos.find((i) => i.id === requested) || photos[0]
  const photo = useRemote(
    active ? active.id + '-' + active.status : '',
    () => api<Detail>('/images/' + pathId(active!.id)),
    5000
  )
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    setSelected([])
    setBusy(false)
    setError('')
    setNotice('')
    setQuery('')
  }, [current])
  const eligible = photos.filter(
    (p) => p.status === 'pending' || p.status === 'error'
  )
  const chosen = eligible
    .filter((p) => selected.includes(p.id))
    .map((p) => p.id)
  const visible = photos.filter((p) =>
    p.filename.toLowerCase().includes(query.trim().toLowerCase())
  )
  const visibleEligible = visible.filter((p) => eligible.includes(p))
  const allSelected =
    visibleEligible.length > 0 &&
    visibleEligible.every((p) => selected.includes(p.id))
  const running =
    data?.status === 'running' || photos.some((p) => p.status === 'running')
  const selectable = !busy && !running
  async function run(subset: boolean) {
    if (!current || busy || running || (subset && !chosen.length)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ accepted?: number }>(
        '/batches/' + pathId(current) + '/run',
        post({ image_ids: subset ? chosen : [] })
      )
      setNotice(
        result.accepted === undefined
          ? '已提交识别。'
          : '本次已加入队列 ' + result.accepted + ' 张。'
      )
      setSelected([])
      batch.refresh()
      refresh()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  function setPick(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }
  const score = data?.score
  const item = photo.data
  const activeEvents: EventRow[] =
    item?.events ||
    [...(index?.reviews || []), ...(index?.violations || [])].filter(
      (e) => e.image_id === active?.id
    )
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>识别工作台</h1>
          <p>按批次运行识别，查看每张原图的模型结论与车辆事件。</p>
        </div>
        <button className="primary" onClick={upload}>
          <Upload size={17} />
          上传批次
        </button>
      </div>
      {batch.error && <Fault text={batch.error} retry={batch.refresh} />}
      {!current ? (
        <section className="panel roomy">
          <Empty
            title={index ? '还没有识别批次' : '正在读取批次'}
            body="选择现场原图即可开始，人工标签可稍后随新批次提供。"
            action={
              <button className="primary" onClick={upload}>
                <Upload size={16} />
                选择现场照片
              </button>
            }
          />
        </section>
      ) : (
        <>
          <section className="panel batch-controls">
            <div className="batch-bar">
              <div className="batch-select">
                <label htmlFor="batch-select">当前批次</label>
                <div>
                  <Folder size={18} />
                  <select
                    id="batch-select"
                    value={current}
                    onChange={(e) => go('work', { batch: e.target.value })}
                  >
                    {!index?.batches.some((b) => b.id === current) && (
                      <option value={current}>
                        {data?.name || '正在读取…'}
                      </option>
                    )}
                    {index?.batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
              </div>
              <button
                className="primary"
                disabled={!eligible.length || !selectable}
                onClick={() => run(false)}
              >
                {busy || running ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}{' '}
                {running ? '正在识别' : '运行整批识别'}
              </button>
            </div>
            <div className="progress-row">
              <span>
                处理进度{' '}
                <b>
                  {data?.processed ?? '—'} / {data?.total ?? '—'} 张
                </b>
              </span>
              <progress
                aria-label="批次处理进度"
                value={data?.processed || 0}
                max={data?.total || 1}
              />
              <span className="score">
                本批图级正确率{' '}
                <b>
                  {score && score.total
                    ? Math.round((score.correct / score.total) * 1000) / 10 +
                      '%（' +
                      score.correct +
                      '/' +
                      score.total +
                      '）'
                    : '暂无可评分样本'}
                </b>
              </span>
            </div>
            {score && score.total > 0 && (
              <p className="hint">
                分母仅含已完成且有独立标签的图片。无法判断计错，人工复核保留原模型得分。
              </p>
            )}
            {error && <Fault text={error} />}{' '}
            {notice && (
              <span className="feedback" role="status">
                {notice}
              </span>
            )}
          </section>
          <div className="work-grid">
            <section className="panel queue">
              <SectionHead
                title="图片队列"
                icon={FileImage}
                action={<span className="count">{photos.length} 张</span>}
              />
              <div className="queue-search">
                <Search size={16} />
                <input
                  aria-label="搜索图片文件名"
                  placeholder="搜索文件名"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="queue-select">
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={!visibleEligible.length || !selectable}
                    onChange={() =>
                      setSelected((prev) =>
                        allSelected
                          ? prev.filter(
                              (id) => !visibleEligible.some((p) => p.id === id)
                            )
                          : [
                              ...new Set([
                                ...prev,
                                ...visibleEligible.map((p) => p.id),
                              ]),
                            ]
                      )
                    }
                  />
                  全选可运行图片
                </label>
                <span>{chosen.length} 张</span>
              </div>
              <div className="picture-list">
                {visible.length ? (
                  visible.map((p) => (
                    <div
                      key={p.id}
                      className={
                        'picture-row ' + (p.id === active?.id ? 'active' : '')
                      }
                    >
                      <input
                        type="checkbox"
                        aria-label={'选择 ' + p.filename}
                        checked={chosen.includes(p.id)}
                        disabled={!eligible.includes(p) || !selectable}
                        onChange={() => setPick(p.id)}
                      />
                      <button
                        onClick={() =>
                          go('work', { batch: current, image: p.id })
                        }
                        aria-current={p.id === active?.id ? 'true' : undefined}
                      >
                        <span>{p.filename}</span>
                        <Badge value={p.queued ? 'queued' : p.status} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="hint">
                    {query ? '没有匹配的文件' : '正在读取图片…'}
                  </p>
                )}
              </div>
              <div className="queue-foot">
                <button
                  className="secondary"
                  disabled={!chosen.length || !selectable}
                  onClick={() => run(true)}
                >
                  <CheckSquare size={16} />
                  识别所选（{chosen.length}）
                </button>
              </div>
            </section>
            <section className="panel viewer">
              <SectionHead
                title={active?.filename || '原图与识别结果'}
                icon={ImageIcon}
                action={
                  active && (
                    <Badge value={active.queued ? 'queued' : active.status} />
                  )
                }
              />
              {photo.error && (
                <Fault text={photo.error} retry={photo.refresh} />
              )}
              {item ? (
                <>
                  <Evidence key={item.id} photo={item} />
                  <div className="vehicles">
                    <h3>
                      <ClipboardList size={16} />
                      车辆事件
                    </h3>
                    {activeEvents.length ? (
                      activeEvents.map((e) => (
                        <div className="vehicle-line" key={e.id}>
                          <span>{eventScope(e)}</span>
                          <Badge value={e.status} />
                          <p>{e.reason}</p>
                          <button
                            className="link"
                            onClick={() =>
                              go('records', {
                                tab:
                                  e.status === 'review'
                                    ? 'reviews'
                                    : 'violations',
                                event: e.id,
                              })
                            }
                          >
                            {e.status === 'review' ? '人工复核' : '事件追溯'}{' '}
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="hint">
                        {item.status === 'done'
                          ? '此图没有已登记的车辆事件。'
                          : '识别完成后可查看事件去向。'}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                !photo.error && (
                  <Empty title="正在读取原图信息" icon={ImageIcon} />
                )
              )}
            </section>
          </div>
        </>
      )}
    </>
  )
}
