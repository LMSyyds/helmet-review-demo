import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  CornerUpRight,
  FileSearch,
  Filter,
  Layers,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  api,
  eventScope,
  go,
  message,
  outcomeName,
  pathId,
  post,
  sourceName,
  useRemote,
  type Detail,
  type EventRow,
  type Index,
  type Outcome,
} from './data'
import { Badge, Dialog, Empty, Fault } from './ui'
import { Evidence } from './Evidence'
type History = {
  revision: number
  previous_status: Outcome
  decision: Outcome
  note: string
  created_at: string
}
type Audit = EventRow & {
  history: History[]
  revision?: number
  model_status?: Outcome
  model_reason?: string
  batch_name?: string
}
const time = (s?: string) =>
  s
    ? new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Shanghai',
      }).format(new Date(s))
    : '—'
function EventDetail({
  id,
  close,
  changed,
}: {
  id: string
  close: () => void
  changed: () => void
}) {
  const event = useRemote(id, () => api<Audit>('/events/' + pathId(id)))
  const row = event.data
  const image = useRemote(row?.image_id || '', () =>
    api<Detail>('/images/' + pathId(row!.image_id))
  )
  const [decision, setDecision] = useState<'' | 'clear' | 'violation'>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [edit, setEdit] = useState(false)
  const group = image.data?.vehicles?.find((v) => v.id === row?.vehicle_id)
  async function save() {
    if (!row || !decision || busy) return
    setBusy(true)
    setError('')
    try {
      await api(
        '/reviews/' + pathId(id),
        post({ decision, note, revision: row.revision })
      )
      setSaved('复核已保存 · ' + outcomeName[decision])
      setDecision('')
      setNote('')
      setEdit(false)
      event.refresh()
      changed()
    } catch (e) {
      setError(message(e))
      event.refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={row?.status === 'review' ? '人工复核' : '事件追溯'}
      large
      onClose={close}
      locked={busy}
    >
      {event.error && <Fault text={event.error} retry={event.refresh} />}
      {row ? (
        <>
          <div className="event-heading">
            <div>
              <span className="eyeline">{row.batch_name || '来源批次'}</span>
              <h3>{row.filename}</h3>
            </div>
            <Badge value={row.status} />
          </div>
          <div className="audit-grid">
            <div>
              {image.error && (
                <Fault text={image.error} retry={image.refresh} />
              )}{' '}
              {image.data ? (
                <Evidence
                  key={image.data.id}
                  photo={image.data}
                  focusIds={row.detection_ids || group?.detection_ids}
                />
              ) : (
                <p className="hint">正在读取原图证据…</p>
              )}
            </div>
            <aside className="audit-aside">
              <h3>事件信息</h3>
              <dl>
                <dt>关联目标</dt>
                <dd>{eventScope(row)}</dd>
                <dt>当前结论来源</dt>
                <dd>{sourceName(row.source)}</dd>
                <dt>模型初判</dt>
                <dd>
                  {row.model_status ? outcomeName[row.model_status] : '—'}
                </dd>
                <dt>模型依据</dt>
                <dd>{row.model_reason || row.reason}</dd>
                <dt>事件编号</dt>
                <dd className="mono">{row.id}</dd>
              </dl>
              <button
                className="link"
                onClick={() =>
                  go('work', { batch: row.batch_id, image: row.image_id })
                }
              >
                定位至识别批次 <CornerUpRight size={15} />
              </button>
            </aside>
          </div>
          {row.history?.length > 0 && (
            <details className="audit-log">
              <summary>人工复核历史（{row.history.length}）</summary>
              {row.history.map((h) => (
                <p key={h.revision}>
                  <b>
                    {outcomeName[h.previous_status]} → {outcomeName[h.decision]}
                  </b>{' '}
                  · {time(h.created_at)}
                  {h.note && <span>{h.note}</span>}
                </p>
              ))}
            </details>
          )}
          {row.status === 'review' || edit ? (
            <div className="review-form">
              <h3>人工结论</h3>
              <div
                className="decision-options"
                role="group"
                aria-label="选择人工结论"
              >
                <button
                  disabled={busy}
                  aria-pressed={decision === 'violation'}
                  onClick={() => setDecision('violation')}
                >
                  <ClipboardCheck size={17} />
                  确认违章
                </button>
                <button
                  disabled={busy}
                  aria-pressed={decision === 'clear'}
                  onClick={() => setDecision('clear')}
                >
                  <ShieldCheck size={17} />
                  排除违章
                </button>
              </div>
              <label htmlFor="note">
                复核说明 <small>选填</small>
              </label>
              <textarea
                id="note"
                value={note}
                maxLength={4000}
                disabled={busy}
                placeholder="例如：已核对同车乘客与原图位置"
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="dialog-foot">
                {edit && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEdit(false)}
                  >
                    取消修改
                  </button>
                )}
                <button
                  className="primary"
                  disabled={!decision || busy || !image.data}
                  onClick={save}
                >
                  <Check size={16} />
                  {busy ? '正在保存' : '保存复核结论'}
                </button>
              </div>
            </div>
          ) : (
            <div className="dialog-foot">
              <button
                className="secondary"
                onClick={() => {
                  setEdit(true)
                  setSaved('')
                  setNote(row.note || '')
                }}
              >
                重新复核
              </button>
            </div>
          )}
          {error && <Fault text={error} />}{' '}
          {saved && (
            <p className="feedback" role="status">
              {saved}
            </p>
          )}
        </>
      ) : (
        !event.error && <p className="hint">正在读取事件…</p>
      )}
    </Dialog>
  )
}
export function Records({
  index,
  params,
  refresh,
}: {
  index?: Index
  params: URLSearchParams
  refresh: () => void
}) {
  const reviews = params.get('tab') === 'reviews'
  const active = params.get('event')
  const [source, setSource] = useState('')
  const [batch, setBatch] = useState('')
  const [query, setQuery] = useState('')
  const base = (reviews ? index?.reviews : index?.violations) || []
  const rows = base.filter(
    (e) =>
      (!source || source === e.source) &&
      (!batch || batch === e.batch_id) &&
      [e.filename, e.id, e.reason, e.vehicle_id].some((t) =>
        t?.toLowerCase().includes(query.trim().toLowerCase())
      )
  )
  const filtered = Boolean(query || source || batch)
  const open = (id: string) =>
    go('records', { tab: reviews ? 'reviews' : 'violations', event: id })
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>违章记录</h1>
          <p>按批次和判定来源查找事件，核对原图、模型初判与人工复核历史。</p>
        </div>
      </div>
      <section className="panel records-panel">
        <div className="records-tabs">
          {[
            {
              label: '违章记录',
              icon: Layers,
              n: index?.violations.length,
              isReview: false,
            },
            {
              label: '待人工复核',
              icon: ClipboardCheck,
              n: index?.reviews.length,
              isReview: true,
            },
          ].map((t) => (
            <button
              key={t.label}
              aria-pressed={reviews === t.isReview}
              onClick={() =>
                go('records', { tab: t.isReview ? 'reviews' : 'violations' })
              }
            >
              <t.icon size={17} />
              {t.label}
              <span>{t.n ?? '—'}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <div className="queue-search">
            <Search size={16} />
            <input
              aria-label="搜索记录"
              placeholder="搜索文件名、事件编号或依据"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label>
            <Filter size={15} />
            <select
              aria-label="判定来源"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">全部来源</option>
              <option value="model">模型判定</option>
              <option value="human">人工复核</option>
            </select>
          </label>
          <label>
            <select
              aria-label="来源批次"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
            >
              <option value="">全部批次</option>
              {index?.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button
              className="link"
              onClick={() => {
                setQuery('')
                setBatch('')
                setSource('')
              }}
            >
              <X size={14} />
              重置
            </button>
          )}
        </div>
        {rows.length ? (
          <div className="record-table">
            <div className="table-head">
              <span>现场照片 / 批次</span>
              <span>判定依据</span>
              <span>来源</span>
              <span>证据</span>
            </div>
            {rows.map((e) => (
              <div className="record-row" key={e.id}>
                <div className="row-name">
                  <b>{e.filename}</b>
                  <small>
                    {index?.batches.find((b) => b.id === e.batch_id)?.name ||
                      e.batch_id}
                  </small>
                </div>
                <p>{e.reason || '—'}</p>
                <span className={'source ' + (e.source || '')}>
                  {sourceName(e.source)}
                </span>
                <button className="link" onClick={() => open(e.id)}>
                  {reviews ? '复核' : '追溯'}
                  <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={FileSearch}
            title={
              !index
                ? '正在读取记录'
                : filtered
                  ? '没有匹配的事件'
                  : reviews
                    ? '暂无待复核事件'
                    : '暂无违章记录'
            }
            body={
              filtered
                ? '调整筛选条件或搜索其他文件名。'
                : reviews
                  ? '证据不足的事件会进入此清单。'
                  : '批次识别或人工复核确认违章后，可在这里查回证据。'
            }
            action={
              !filtered && (
                <button className="secondary" onClick={() => go('work')}>
                  进入识别工作台 <ArrowRight size={15} />
                </button>
              )
            }
          />
        )}
        <div className="list-foot">
          共 {rows.length} 条{reviews ? '待复核事件' : '违章记录'}
        </div>
      </section>
      {active && (
        <EventDetail
          key={active}
          id={active}
          close={() =>
            go('records', { tab: reviews ? 'reviews' : 'violations' })
          }
          changed={refresh}
        />
      )}
    </>
  )
}
