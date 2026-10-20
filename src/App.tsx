import { useState } from "react";
import { getBackendStatus, type BackendStatus } from "./lib/backend";
import "./App.css";

function App() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkBackend() {
    setChecking(true);
    setError(null);
    try {
      setStatus(await getBackendStatus());
    } catch {
      setError("暂时无法连接本地桌面服务，请确认应用已在 Tauri 窗口中运行。");
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="主导航">
        <div className="brand-mark" aria-hidden="true">S</div>
        <div className="rail-label">SJTU<br />SCHEDULE</div>
        <nav>
          <button className="nav-item nav-item-active" type="button" aria-current="page">
            <span aria-hidden="true">▦</span>
            日历
          </button>
          <button className="nav-item" type="button" disabled title="将在后续阶段启用">
            <span aria-hidden="true">◷</span>
            设置
          </button>
        </nav>
        <div className="rail-footer">本地优先</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">你的校园日程</p>
            <h1>SJTU Schedule</h1>
          </div>
          <div className="date-control">
            <button type="button" aria-label="上一周" disabled>‹</button>
            <span>本地日历即将就绪</span>
            <button type="button" aria-label="下一周" disabled>›</button>
          </div>
          <button className="primary-button" type="button" disabled title="将在后续阶段启用">＋ 新建日程</button>
        </header>

        <div className="content-grid">
          <section className="welcome-card" aria-labelledby="welcome-title">
            <div className="welcome-copy">
              <span className="status-chip"><span className="status-dot" /> 桌面应用骨架</span>
              <h2 id="welcome-title">把课程、DDL 和日常安排放在一起。</h2>
              <p>本地日程数据保存在这台设备上。先确认桌面服务和 SQLite 数据库可以正常工作。</p>
              <button className="secondary-button" type="button" onClick={checkBackend} disabled={checking}>
                {checking ? "正在检查…" : "检查本地存储"}
              </button>
              {status && (
                <p className="result-message" role="status">
                  SQLite 已连接 · 迁移版本 {status.schemaVersion}
                </p>
              )}
              {error && <p className="error-message" role="alert">{error}</p>}
            </div>
            <div className="calendar-art" aria-hidden="true">
              <div className="art-top"><span /><span /><span /></div>
              <div className="art-month">10 <small>月</small></div>
              <div className="art-grid">
                {Array.from({ length: 21 }, (_, index) => (
                  <span className={index === 12 ? "art-day art-day-selected" : "art-day"} key={index}>
                    {index + 1}
                  </span>
                ))}
              </div>
              <div className="art-event"><span /> 课程与日程</div>
            </div>
          </section>

          <section className="setup-section" aria-labelledby="setup-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">准备工作区</p>
                <h2 id="setup-title">日程来源</h2>
              </div>
              <span className="muted-label">还没有连接</span>
            </div>
            <div className="source-grid">
              <article className="source-card">
                <span className="source-icon source-icon-course" aria-hidden="true">课</span>
                <div><h3>SJTU 教务课表</h3><p>登录后同步课程和教学周</p></div>
                <span className="source-state">待配置</span>
              </article>
              <article className="source-card">
                <span className="source-icon source-icon-canvas" aria-hidden="true">C</span>
                <div><h3>Canvas 作业</h3><p>授权后同步作业截止时间</p></div>
                <span className="source-state">待配置</span>
              </article>
              <article className="source-card source-card-local">
                <span className="source-icon source-icon-local" aria-hidden="true">＋</span>
                <div><h3>个人日程</h3><p>创建课程以外的安排和本地 DDL</p></div>
                <span className="source-state">即将开放</span>
              </article>
            </div>
          </section>
        </div>
        <footer className="workspace-footer">
          <span><span className="status-dot" /> 数据保存在此设备</span>
          <span>Phase 0 · 工程初始化</span>
        </footer>
      </section>
    </main>
  );
}

export default App;
