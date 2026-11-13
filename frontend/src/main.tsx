import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  Archive,
  ChevronRight,
  Cpu,
  LayoutDashboard,
  ScanLine,
} from 'lucide-react'
import { getIndex, go, modelName, readRoute, useRemote } from './data'
import { Fault } from './ui'
import { Overview } from './Overview'
import { Work } from './Work'
import { Records } from './Records'
import { UploadDialog } from './Upload'
import './style.css'
const pages = [
  { id: 'overview', name: '项目总览', icon: LayoutDashboard },
  { id: 'work', name: '识别工作台', icon: ScanLine },
  { id: 'records', name: '违章记录', icon: Archive },
]
function App() {
  const [route, setRoute] = useState(readRoute)
  const [upload, setUpload] = useState(false)
  const index = useRemote('index', getIndex, 5000)
  useEffect(() => {
    const change = () => {
      setRoute(readRoute())
      setUpload(false)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const current = pages.find((p) => p.id === route.page)!
  useEffect(() => {
    document.title = current.name + ' · 园区骑行治理'
    window.scrollTo(0, 0)
  }, [current])
  return (
    <div className="shell">
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        跳至主要内容
      </a>
      <aside className="sidebar">
        <a href="#/overview" className="brand">
          <img src="/mark.svg" alt="" width="42" height="42" />
          <span>
            <b>园区骑行治理</b>
            <small>非机动车管理平台</small>
          </span>
        </a>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <a
              key={p.id}
              href={'#/' + p.id}
              aria-current={p.id === route.page ? 'page' : undefined}
            >
              <p.icon size={19} />
              <span>{p.name}</span>
              {p.id === 'records' && Boolean(index.data?.reviews.length) && (
                <em>{index.data?.reviews.length}</em>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Cpu size={18} />
          <div>
            <small>识别模型</small>
            <b>{modelName}</b>
          </div>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <div>
            <span>园区管理</span>
            <ChevronRight size={14} />
            <strong>{current.name}</strong>
          </div>
          <span className={'connection ' + (index.error ? 'offline' : '')}>
            <Activity size={15} />
            {index.error
              ? '服务连接异常'
              : index.data
                ? '服务已连接'
                : '连接中'}
          </span>
        </header>
        <main id="main" tabIndex={-1}>
          {index.error && <Fault text={index.error} retry={index.refresh} />}
          {route.page === 'overview' ? (
            <Overview index={index.data} upload={() => setUpload(true)} />
          ) : route.page === 'work' ? (
            <Work
              index={index.data}
              params={route.params}
              upload={() => setUpload(true)}
              refresh={index.refresh}
            />
          ) : (
            <Records
              index={index.data}
              params={route.params}
              refresh={index.refresh}
            />
          )}
        </main>
      </div>
      {upload && (
        <UploadDialog
          close={() => setUpload(false)}
          created={(b) => {
            setUpload(false)
            index.refresh()
            go('work', { batch: b.id })
          }}
        />
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
