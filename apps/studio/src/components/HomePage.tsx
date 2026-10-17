import { useEffect, useState } from 'react';
import { fetchProjects, fetchStyles, type ProjectMeta, type StyleEntry } from '../useStudio';

const NAME_IDEAS = ['法拉利展馆', '我的生日倒数日', '学习打卡计数器', '读书速记本'];
const FEATURED_STYLES = [
  { id: '', name: '自动' },
  { id: 'brutalist-crimson', name: '新野兽派' },
  { id: 'glass-amethyst', name: '毛玻璃' },
  { id: 'terminal-jade', name: '终端绿屏' },
  { id: 'retro-moss', name: '复古报纸' },
  { id: 'aurora-azure', name: '极光渐变' },
  { id: 'studio-gold', name: '鎏金奢华' },
];

interface KeyProvider {
  id: string;
  label: string;
  purpose: string;
  url: string;
  masked: string | null;
  configured: boolean;
  custom?: boolean;
  model?: string;
}

function KeySettings({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<KeyProvider[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    fetch('/api/keys').then((r) => r.json()).then(setProviders).catch(() => setProviders([]));
  };
  useEffect(load, []);

  const save = async (id: string) => {
    const key = (draft[id] ?? '').trim();
    if (!key) return;
    const res = await fetch('/api/keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: id, key }),
    });
    if (res.ok) { setDraft((m) => ({ ...m, [id]: '' })); setMsg(`${id} 已保存`); load(); }
    else setMsg(`保存失败（${res.status}）`);
  };
  const remove = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    setMsg(`${id} 已删除`); load();
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 620 }}>
        <h1 style={{ fontSize: 18 }}>🔑 接入你自己的 <span>API Key</span></h1>
        <p className="sub" style={{ marginBottom: 12 }}>
          密钥仅保存在本机（服务端 keys.json），不进入日志、事件流与导出包。
          配置图库 Key 后，生成展馆/图库类应用将优先使用高质量真实照片。
        </p>
        {(providers ?? []).filter((p) => !p.custom).map((p) => (
          <div key={p.id} className="key-row">
            <div className="key-meta">
              <b>{p.label}</b>
              <span className="dim"> {p.configured ? `已配置 ${p.masked}` : '未配置'}</span>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.purpose}</div>
            </div>
            <input
              type="password"
              placeholder={p.configured ? '输入新 Key 覆盖' : '粘贴 API Key'}
              value={draft[p.id] ?? ''}
              onChange={(e) => setDraft((m) => ({ ...m, [p.id]: e.target.value }))}
            />
            <button className="btn" disabled={!(draft[p.id] ?? '').trim()} onClick={() => save(p.id)}>保存</button>
            {p.configured && <button className="btn" onClick={() => remove(p.id)}>删除</button>}
            {!p.configured && <a className="btn" href={p.url} target="_blank" rel="noreferrer">获取 ↗</a>}
          </div>
        ))}
        {(providers ?? []).filter((p) => p.custom).length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-faint)', margin: '10px 0 2px' }}>自定义服务</div>
        )}
        {(providers ?? []).filter((p) => p.custom).map((p) => (
          <div key={p.id} className="key-row">
            <div className="key-meta">
              <b>{p.label}</b>
              <span className="dim"> {p.masked}</span>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.purpose}</div>
            </div>
            <span />
            <button className="btn" onClick={() => remove(p.id)}>删除</button>
            <span />
          </div>
        ))}

        <div style={{ fontSize: 11, color: 'var(--text-faint)', margin: '14px 0 4px' }}>➕ 添加自定义服务（任意 OpenAI 兼容网关 / 自建中转）</div>
        <div className="key-row custom-form">
          <input className="cf" placeholder="名称，如：DeepSeek" value={draft['__cf_label'] ?? ''} onChange={(e) => setDraft((m) => ({ ...m, __cf_label: e.target.value }))} />
          <input className="cf" placeholder="Base URL，如 https://api.deepseek.com" value={draft['__cf_url'] ?? ''} onChange={(e) => setDraft((m) => ({ ...m, __cf_url: e.target.value }))} />
          <input className="cf" type="password" placeholder="API Key" value={draft['__cf_key'] ?? ''} onChange={(e) => setDraft((m) => ({ ...m, __cf_key: e.target.value }))} />
          <input className="cf" placeholder="模型名（留空自动识别）" value={draft['__cf_model'] ?? ''} onChange={(e) => setDraft((m) => ({ ...m, __cf_model: e.target.value }))} />
          <button
            className="btn"
            disabled={!(draft['__cf_label'] ?? '').trim() || !(draft['__cf_url'] ?? '').trim() || !(draft['__cf_key'] ?? '').trim()}
            onClick={async () => {
              const res = await fetch('/api/keys/custom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: draft['__cf_label'], baseUrl: draft['__cf_url'], key: draft['__cf_key'], model: draft['__cf_model'] }),
              });
              if (res.ok) {
                setDraft((m) => ({ ...m, __cf_label: '', __cf_url: '', __cf_key: '', __cf_model: '' }));
                setMsg('自定义服务已保存'); load();
              } else setMsg(`添加失败（${res.status}）`);
            }}
          >添加</button>
        </div>
        <button
          className="dock-test"
          style={{ marginTop: 10 }}
          onClick={async () => {
            setMsg('测试中…');
            try {
              const res = await fetch('/api/keys/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
              const d = await res.json();
              setMsg(d.ok ? `✅ ${d.provider}/${d.model} 连通（${d.ms}ms）` : `❌ ${d.error ?? '失败'}`);
            } catch (e) { setMsg(`❌ ${String(e)}`); }
          }}
        >🔌 测试模型连接（用当前自动选择的网关发一条真实消息）</button>
        {providers && providers.length === 0 && <p className="dim">密钥服务不可用（生成服务未启动？）</p>}
        {msg && <p style={{ color: 'var(--cyan)', fontSize: 12, marginTop: 8 }}>{msg}</p>}
        <button className="go" style={{ marginTop: 12 }} onClick={onClose}>完成</button>
      </div>
    </div>
  );
}

export function HomePage({
  style, setStyle, fx, setFx, styleDesc, setStyleDesc,
  onSubmitProject, onEnterProject, onDemo,
}: {
  style: string; setStyle: (v: string) => void;
  fx: string; setFx: (v: string) => void;
  styleDesc: string; setStyleDesc: (v: string) => void;
  onSubmitProject: (name: string) => void;
  onEnterProject: (meta: ProjectMeta) => void;
  onDemo: () => void;
}) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [styleCount, setStyleCount] = useState<number | null>(null);
  const [styleGroups, setStyleGroups] = useState<{ base: string; items: StyleEntry[] }[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProjects()
      .then((list) => { if (alive) setProjects(list); })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)); });
    fetchStyles()
      .then(({ count, styles }) => {
        if (!alive) return;
        setStyleCount(count);
        const groups = new Map<string, StyleEntry[]>();
        for (const s of styles) {
          if (!groups.has(s.base)) groups.set(s.base, []);
          groups.get(s.base)!.push(s);
        }
        setStyleGroups([...groups.entries()].map(([base, items]) => ({ base, items })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const submit = () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    onSubmitProject(text.trim());
  };

  return (
    <div className="home">
      {showKeys && <KeySettings onClose={() => setShowKeys(false)} />}
      <div className="home-hero">
        <div className="home-badge">⚡ 真实生成 · {styleCount ? `${styleCount} 种风格 · ` : ''}事件溯源 · 门禁保障</div>
        <h1>OrchestrAI<span> · Agent 软件研发工作室</span></h1>
        <p>描述你想要的软件，OrchestrAI 组织 Agent 完成真实交付<br />真实生成文件 · 真实执行测试 · 网络采集真实素材 · 可安装（PWA / .exe / .apk）</p>
        <div className="home-input">
          <input
            value={text}
            placeholder="给项目起个名字，例如：法拉利展馆（具体需求进入项目后再填写，支持 Word/txt/md 文档）"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <button className="go primary-go" disabled={busy || !text.trim()} onClick={submit}>
            {busy ? '⏳ 创建中…' : '创建项目 →'}
          </button>
        </div>
        <div className="home-examples">
          <span className="dim">起名灵感：</span>
          {NAME_IDEAS.map((s) => (
            <span key={s} className="chip cyan" style={{ cursor: 'pointer' }} onClick={() => setText(s)}>{s}</span>
          ))}
        </div>
        <div className="pref-card">
        <div className="pref-title">🎨 创作风格 <span className="dim">（148 种精选 + 自由描述）</span></div>
        <div className="style-picker">
          <span className="dim">精选：</span>
          {FEATURED_STYLES.map((s) => (
            <span
              key={s.id || 'auto'}
              className={`chip ${style === s.id ? 'cyan' : ''}`}
              style={{ cursor: 'pointer', ...(style === s.id ? { borderColor: 'var(--cyan)' } : {}) }}
              onClick={() => setStyle(s.id)}
            >
              {s.name}
            </span>
          ))}
          <select
            className="style-select"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            title={styleCount ? `${styleCount} 种风格全目录` : '风格目录加载中…'}
          >
            <option value="">全部 {styleCount ?? '…'} 种风格…</option>
            {(styleGroups ?? []).map((g) => (
              <optgroup key={g.base} label={g.base}>
                {g.items.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            className="style-desc"
            value={styleDesc}
            placeholder="或用文字描述风格，如：深色玻璃质感、紫色调、圆角…"
            onChange={(e) => setStyleDesc(e.target.value)}
            title="自由描述你想要的视觉风格（支持色彩/明暗/质感/圆角/字体）"
          />
        </div>
        <div className="pref-title" style={{ marginTop: 10 }}>✨ 动效</div>
        <div className="style-picker fx-picker">
          <span className="dim">级别：</span>
          {[['', '自动'], ['subtle', '柔和'], ['full', '炫动 🪐'], ['off', '关闭']].map(([id, name]) => (
            <span key={id || 'fxauto'} className={`chip ${fx === id ? 'cyan' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setFx(id ?? '')}>{name}</span>
          ))}
          <span className="dim" style={{ marginLeft: 4 }}>炫动 = 粒子避让鼠标 + 光标拖尾 + 点击涟漪</span>
        </div>
        </div>
      </div>

      <div className="home-body">
        <div className="home-sect">
          <h3>我的项目{projects ? `（${projects.length}）` : ''}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setShowKeys(true)}>🔑 API Key</button>
            <button className="btn" onClick={onDemo}>▶ 观看演示剧本</button>
          </div>
        </div>
        {loadError && <div className="home-error">项目列表加载失败：{loadError}</div>}
        <div className="home-grid">
          {(projects ?? []).map((p) => (
            <div className="proj-card" key={p.id} onClick={() => onEnterProject(p)}>
              <div className="p-head">
                <span className="p-name">{p.name}</span>
                <span className="p-enter">进入 →</span>
              </div>
              <div className="p-chips">
                <span className="chip cyan">{p.typeName}</span>
                {p.styleName && <span className="chip">{p.styleName}</span>}
                {p.delivered
                  ? <span className="chip green">已交付 v{p.deliveryVersion}</span>
                  : <span className="chip red">已阻塞</span>}
                {p.hadDefectFix && <span className="chip amber">含缺陷修复</span>}
                {(p.imageCount ?? 0) > 0 && <span className="chip purple">🖼 {p.imageCount} 张素材</span>}
              </div>
              <div className="p-sentence">「{p.sentence}」</div>
              <div className="p-meta">
                {new Date(p.createdAt).toLocaleString('zh-CN', { hour12: false })} · {p.fileCount} 个文件
              </div>
            </div>
          ))}
          {projects && projects.length === 0 && (
            <div className="empty" style={{ gridColumn: '1 / -1', padding: '32px 0' }}>
              还没有项目 —— 用上面的一句话创建第一个吧 ✨
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
