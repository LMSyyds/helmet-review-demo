import { useCallback, useEffect, useRef, useState } from 'react'

export type Status = 'pending' | 'running' | 'done' | 'error'
export type Prediction = 'helmet' | 'no_helmet' | 'unknown'
export type Outcome = 'review' | 'violation' | 'clear'
export type Photo = {
  id: string
  filename: string
  queued?: number | boolean
  status: Status
  prediction?: Prediction | null
  truth?: Prediction | null
}
export type Batch = {
  id: string
  name: string
  status: Status
  total: number
  processed: number
  score?: { correct: number; total: number } | null
  images?: Photo[]
}
export type Detection = {
  id: string
  box: number[]
  label: string
  confidence: number
}
export type Vehicle = {
  id: string
  detection_ids: string[]
  status: Outcome
  reason: string
  note?: string
  source?: string
  vehicle_id?: string
}
export type Detail = Photo & {
  batch_id: string
  width: number
  height: number
  error?: string
  model_version?: string
  detections: Detection[]
  vehicles: Vehicle[]
  target_box?: number[] | null
  events?: EventRow[]
}
export type EventRow = {
  id: string
  image_id: string
  batch_id: string
  filename: string
  status: Outcome
  reason: string
  source?: string
  vehicle_id?: string
  note?: string
  detection_ids?: string[]
  scope?: string
  position?: number
}
export const modelName = 'Co-DETR v1 epoch 2'
export const statusName = {
  pending: '待识别',
  queued: '已排队',
  running: '识别中',
  done: '已完成',
  error: '识别失败',
}
export const outcomeName = {
  review: '待人工复核',
  violation: '确认违章',
  clear: '已排除',
}
export const predName = {
  helmet: '已戴盔',
  no_helmet: '未戴盔',
  unknown: '无法判断',
}
export const sourceName = (s?: string) =>
  s === 'model' ? '模型判定' : s === 'human' ? '人工复核' : '来源待查'
export const eventScope = (e: EventRow) =>
  e.scope === 'target'
    ? '来源指定车辆'
    : e.scope === 'unresolved'
      ? '归属待核实'
      : e.scope === 'image'
        ? '整图事件'
        : e.vehicle_id
          ? '车辆组 ' + ((e.position ?? 0) + 1)
          : '整图事件'
export const imgUrl = (id: string) =>
  '/api/images/' + encodeURIComponent(id) + '/original'
export const pathId = (id: string) => encodeURIComponent(id)
export function go(page: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString()
  location.hash = '/' + page + (q ? '?' + q : '')
}
export function readRoute() {
  const [page, q] = location.hash.slice(1).replace(/^\//, '').split('?')
  return {
    page: page === 'work' || page === 'records' ? page : 'overview',
    params: new URLSearchParams(q),
  }
}
export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch('/api' + path, { cache: 'no-store', ...opts })
  let body
  try {
    body = await r.json()
  } catch {
    throw new Error(
      '接口未返回有效数据（HTTP ' + r.status + '），请检查后台服务。'
    )
  }
  if (!r.ok)
    throw new Error(
      typeof body.error === 'string'
        ? body.error
        : typeof body.detail === 'string'
          ? body.detail
          : body.message || '请求失败（HTTP ' + r.status + '）'
    )
  return body
}
export function uploadBatch(
  form: FormData,
  onProgress: (fraction: number | null) => void
): Promise<Batch> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/batches')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) =>
      onProgress(e.lengthComputable && e.total > 0 ? e.loaded / e.total : null)
    xhr.upload.onload = () => onProgress(1)
    xhr.onerror = () => reject(new Error('传输中断，请检查连接后重新上传。'))
    xhr.onload = () => {
      const result = xhr.response
      if (xhr.status >= 200 && xhr.status < 300 && result?.id) resolve(result)
      else
        reject(
          new Error(
            result?.error ||
              result?.detail ||
              '上传失败（HTTP ' + xhr.status + '）'
          )
        )
    }
    xhr.send(form)
  })
}
export const post = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})
export const message = (e: unknown) =>
  e instanceof Error ? e.message : '请求失败，请重试。'
export function useRemote<T>(
  key: string,
  fetcher: () => Promise<T>,
  interval = 0
) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key: '' }
  )
  const [revision, setRevision] = useState(0)
  const latest = useRef(fetcher)
  latest.current = fetcher
  const refresh = useCallback(() => setRevision((n) => n + 1), [])
  useEffect(() => {
    if (!key) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const data = await latest.current()
        if (live) setState({ key, data })
      } catch (e) {
        if (live)
          setState((prev) => ({
            key,
            data: prev.key === key ? prev.data : undefined,
            error: message(e),
          }))
      } finally {
        if (live && interval) timer = setTimeout(load, interval)
      }
    }
    void load()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key, revision, interval])
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    refresh,
  }
}
export const getIndex = async () => {
  const [batches, reviews, violations] = await Promise.all([
    api<Batch[]>('/batches'),
    api<EventRow[]>('/reviews'),
    api<EventRow[]>('/violations'),
  ])
  return { batches, reviews, violations }
}
export type Index = Awaited<ReturnType<typeof getIndex>>
export function labelInfo(label: string) {
  if (label === 'motorbike')
    return { name: '整车', group: 'vehicle', tone: 'blue' }
  const m = /^(D|P[012])(NoHelmet|Helmet)$/i.exec(label)
  if (!m) return { name: label, group: 'other', tone: 'blue' }
  const person = m[1] === 'D' ? '驾驶人' : '乘客 ' + m[1].toUpperCase()
  const missing = m[2].toLowerCase() === 'nohelmet'
  return {
    name: person + ' · ' + (missing ? '未戴盔' : '已戴盔'),
    group: 'rider',
    tone: missing ? 'orange' : 'mint',
  }
}
