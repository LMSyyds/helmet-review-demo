import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ClipboardList,
  FileStack,
  Folder,
  Images,
  Layers3,
  ScanLine,
  Upload,
  Workflow,
} from 'lucide-react'
import { Badge, Empty, SectionHead, TextAction } from './ui'
import { go, type Index } from './data'
export function Overview({
  index,
  upload,
}: {
  index?: Index
  upload: () => void
}) {
  const batches = index?.batches
  const stats = [
    {
      label: '已上传批次',
      unit: '批',
      value: batches?.length,
      icon: Layers3,
      tone: 'green',
      open: () => go('work'),
    },
    {
      label: '已处理图片',
      unit: '张',
      value: batches?.reduce((n, b) => n + b.processed, 0),
      icon: ScanLine,
      tone: 'blue',
      open: () => go('work'),
    },
    {
      label: '待人工复核',
      unit: '条',
      value: index?.reviews.length,
      icon: ClipboardList,
      tone: 'amber',
      open: () => go('records', { tab: 'reviews' }),
    },
    {
      label: '违章记录',
      unit: '条',
      value: index?.violations.length,
      icon: FileStack,
      tone: 'purple',
      open: () => go('records'),
    },
  ]
  return (
    <>
      <section className="hero" aria-labelledby="home-heading">
        <div className="hero-copy">
          <span className="hero-context">
            <i /> 园区非机动车管理
          </span>
          <h1 id="home-heading">头盔识别与复核</h1>
          <p>从现场抓拍到违章记录，逐车核对骑乘人员的头盔佩戴情况。</p>
          <div className="hero-actions">
            <button className="primary light" onClick={upload}>
              <Upload size={17} />
              上传批次
            </button>
            <button className="hero-link" onClick={() => go('work')}>
              进入识别工作台 <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>
      <section className="overview-stats" aria-label="业务概况">
        {stats.map((s) => (
          <button className="stat" key={s.label} onClick={s.open}>
            <span className={'tile-icon ' + s.tone}>
              <s.icon size={21} />
            </span>
            <span className="stat-body">
              <span>{s.label}</span>
              <span className="stat-num">
                {s.value ?? '—'} <small>{s.unit}</small>
              </span>
            </span>
            <ArrowUpRight className="stat-arrow" size={16} />
          </button>
        ))}
      </section>
      <div className="home-bottom">
        <section className="panel">
          <SectionHead
            title="识别批次"
            icon={Folder}
            action={
              <TextAction onClick={() => go('work')}>查看全部</TextAction>
            }
          />
          {batches?.length ? (
            <div className="batch-list">
              {batches.slice(0, 4).map((b) => (
                <button
                  className="batch-row"
                  key={b.id}
                  onClick={() => go('work', { batch: b.id })}
                >
                  <span className="file-icon">
                    <Images size={20} />
                  </span>
                  <span className="row-name">
                    <b>{b.name}</b>
                    <small>
                      {b.processed} / {b.total} 张已处理
                    </small>
                  </span>
                  <Badge value={b.status} />
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title={batches ? '创建第一个识别批次' : '等待读取批次'}
              body="可一次选择多张现场照片，并附上独立人工标签。"
              action={
                <button className="secondary" onClick={upload}>
                  <Upload size={16} />
                  选择照片
                </button>
              }
            />
          )}
        </section>
        <section className="panel process">
          <SectionHead title="业务流程" icon={Workflow} />
          <div className="steps">
            {[
              {
                icon: Upload,
                t: '上传现场照片',
                d: '按批次收集原图，支持多面板抓拍。',
              },
              {
                icon: ScanLine,
                t: '识别车辆与骑乘人员',
                d: '逐图检查整车、驾驶人和同车乘客。',
              },
              {
                icon: CheckCheck,
                t: '复核与留档',
                d: '核实存疑事件，按原图追溯违章记录。',
              },
            ].map((s) => (
              <div className="step" key={s.t}>
                <span>
                  <s.icon size={17} />
                </span>
                <div>
                  <b>{s.t}</b>
                  <small>{s.d}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <p className="background-note">
        项目背景 ·
        车辆登记上牌后进入园区通行管理。通行抓拍触发头盔识别，存疑事件交由人工复核。
      </p>
    </>
  )
}
