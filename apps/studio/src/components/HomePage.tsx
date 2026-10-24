import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteProjects, fetchProjects, fetchStyles, type ProjectMeta, type StyleEntry } from '../useStudio';

const NAME_IDEAS = ['法拉利展馆', '我的生日倒数日', '学习打卡计数器', '读书速记本'];
const FEATURED_STYLES = [
  { id: '', name: '自动搭配', image: '/style-previews/auto.jpg', description: '按主题匹配色彩、字形与页面气质。', credit: 'Photo: Dell / Unsplash' },
  { id: 'brutalist-crimson', name: '新野兽派', image: '/style-previews/brutalist.jpg', description: '粗粝建筑感、醒目色块与大胆排版。', credit: 'Photo: Francesco Albertazzi / Unsplash' },
  { id: 'glass-amethyst', name: '毛玻璃', image: '/style-previews/glass.jpg', description: '通透玻璃、柔和紫光与悬浮层次。', credit: 'Photo: Unsplash' },
  { id: 'terminal-jade', name: '终端绿屏', image: '/style-previews/terminal.jpg', description: '深色界面、等宽字体与荧光绿点缀。', credit: 'Photo: Leopold Stenger / Unsplash' },
  { id: 'retro-moss', name: '复古报纸', image: '/style-previews/newspaper.jpg', description: '旧纸暖调、衬线标题与编辑式网格。', credit: 'Photo: balesstudio / Unsplash' },
  { id: 'aurora-azure', name: '极光渐变', image: '/style-previews/aurora.jpg', description: '冷色光晕、流动渐变与梦幻留白。', credit: 'Photo: Jonatan Pie / Unsplash' },
  { id: 'studio-gold', name: '鎏金奢华', image: '/style-previews/gold.jpg', description: '黑金质感、克制高光与精致细节。', credit: 'Photo: Rutger Lanser / Unsplash' },
];
const STYLE_BASE_INFO: Record<string, { name: string; image: string; description: string; credit: string }> = {
  neon: { name: '暗夜霓虹', image: '/style-previews/neon.jpg', description: '深色底、鲜亮高光与发光边缘。', credit: 'Photo: Cai Fang / Unsplash' },
  brutalist: { name: '新野兽派', image: '/style-previews/brutalist.jpg', description: '粗粝结构、强烈色块与大胆排版。', credit: 'Photo: Francesco Albertazzi / Unsplash' },
  editorial: { name: '编辑杂志', image: '/style-previews/newspaper.jpg', description: '衬线标题、清晰层级与编辑网格。', credit: 'Photo: balesstudio / Unsplash' },
  neumorph: { name: '新拟物派', image: '/style-previews/abstract.jpg', description: '柔和阴影、圆润表面与轻盈层次。', credit: 'Photo: Logan Voss / Unsplash' },
  glass: { name: '毛玻璃', image: '/style-previews/glass.jpg', description: '透明面板、背景虚化与悬浮层次。', credit: 'Photo: Unsplash' },
  clay: { name: '粘土拟态', image: '/style-previews/abstract.jpg', description: '圆润造型、柔和高光与立体触感。', credit: 'Photo: Logan Voss / Unsplash' },
  aurora: { name: '极光渐变', image: '/style-previews/aurora.jpg', description: '流动渐变、冷色光晕与通透留白。', credit: 'Photo: Jonatan Pie / Unsplash' },
  retro: { name: '复古报纸', image: '/style-previews/newspaper.jpg', description: '旧纸暖调、衬线字形与怀旧细节。', credit: 'Photo: balesstudio / Unsplash' },
  terminal: { name: '终端绿屏', image: '/style-previews/terminal.jpg', description: '等宽字、暗色界面与荧光绿强调。', credit: 'Photo: Leopold Stenger / Unsplash' },
  pixel: { name: '像素游戏', image: '/style-previews/terminal.jpg', description: '像素边缘、方正布局与游戏氛围。', credit: 'Photo: Leopold Stenger / Unsplash' },
  zen: { name: '和风禅意', image: '/style-previews/zen.jpg', description: '克制留白、自然质感与安静节奏。', credit: 'Photo: Andy Wang / Unsplash' },
  luxe: { name: '鎏金奢华', image: '/style-previews/gold.jpg', description: '深色底、金属高光与精致留白。', credit: 'Photo: Rutger Lanser / Unsplash' },
  corporate: { name: '企业简洁', image: '/style-previews/auto.jpg', description: '清晰导航、稳重配色与利落信息层级。', credit: 'Photo: Dell / Unsplash' },
  notion: { name: 'Notion 风', image: '/style-previews/newspaper.jpg', description: '文档式布局、轻量分隔与易读层级。', credit: 'Photo: balesstudio / Unsplash' },
  soft: { name: '柔和界面', image: '/style-previews/abstract.jpg', description: '低对比配色、柔软曲线与舒缓氛围。', credit: 'Photo: Logan Voss / Unsplash' },
  organic: { name: '自然有机', image: '/style-previews/organic.jpg', description: '自然色调、圆润曲线与轻松节奏。', credit: 'Photo: Greg Rosenke / Unsplash' },
};
const STYLE_PALETTE_INFO: Record<string, { label: string; description: string; color: string }> = {
  obsidian: { label: '曜黑', description: '曜黑与青绿点亮', color: '#71dcca' },
  crimson: { label: '绯红', description: '绯红强调色', color: '#ed526b' },
  tangerine: { label: '蜜橙', description: '温暖蜜橙色', color: '#f39a4b' },
  aurum: { label: '鎏金', description: '克制鎏金色', color: '#d7b969' },
  jade: { label: '青翠', description: '自然青翠色', color: '#48b58b' },
  azure: { label: '天青', description: '清透天青色', color: '#5dafe9' },
  amethyst: { label: '紫晶', description: '柔和紫晶色', color: '#a17ae8' },
  blossom: { label: '桃粉', description: '轻柔桃粉色', color: '#e881b5' },
  moss: { label: '苔绿', description: '沉静苔绿色', color: '#9dab68' },
};

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

type KeyApiResult = Record<string, unknown>;

async function requestKeyApi(path: string, init: RequestInit, fallback: string): Promise<KeyApiResult> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error('无法连接本地服务，请确认服务端正在运行。');
  }
  const data = await response.json().catch(() => null) as KeyApiResult | null;
  if (!response.ok || data?.ok === false) {
    throw new Error(typeof data?.error === 'string' ? data.error : fallback);
  }
  return data ?? {};
}

function KeySettings({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<KeyProvider[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const pendingActionRef = useRef<string | null>(null);
  pendingActionRef.current = pendingAction;

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/keys');
      if (!response.ok) throw new Error('配置读取失败');
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('配置格式无效');
      setProviders(data);
    } catch {
      setProviders([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const focusables = getFocusable();
    (focusables[0] ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingActionRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const current = getFocusable();
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const save = async (id: string) => {
    const key = (draft[id] ?? '').trim();
    if (!key || pendingAction) return;
    setPendingAction(`save:${id}`);
    try {
      await requestKeyApi('/api/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: id, key }),
      }, '保存失败');
      setDraft((m) => ({ ...m, [id]: '' }));
      setMsg(`${id} 已保存`);
      void load();
    } catch (error) {
      setMsg(`保存失败：${error instanceof Error ? error.message : '请求失败'}`);
    } finally {
      setPendingAction(null);
    }
  };
  const remove = async (id: string) => {
    if (pendingAction) return;
    setPendingAction(`remove:${id}`);
    try {
      await requestKeyApi(`/api/keys/${id}`, { method: 'DELETE' }, '删除失败');
      setMsg(`${id} 已删除`);
      void load();
    } catch (error) {
      setMsg(`删除失败：${error instanceof Error ? error.message : '请求失败'}`);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="overlay key-settings-overlay" onClick={(e) => { if (e.target === e.currentTarget && !pendingAction) onClose(); }}>
      <section className="card key-settings-card" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="key-settings-title" aria-describedby="key-settings-description" tabIndex={-1}>
        <div className="key-settings-heading">
          <h1 id="key-settings-title" style={{ fontSize: 18 }}>🔑 接入你自己的 <span>API Key</span></h1>
          <button className="key-settings-close" type="button" onClick={onClose} disabled={Boolean(pendingAction)} aria-label="关闭模型与图源设置">×</button>
        </div>
        <p id="key-settings-description" className="sub" style={{ marginBottom: 12 }}>
          密钥仅保存在本机（服务端 keys.json），不进入日志、事件流与导出包。
          配置图库 Key 后，生成展馆/图库类应用将优先使用高质量真实照片。
        </p>
        {!providers && <p className="key-settings-loading" role="status">正在读取服务配置…</p>}
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
            <button className="btn" disabled={Boolean(pendingAction) || !(draft[p.id] ?? '').trim()} onClick={() => void save(p.id)}>{pendingAction === `save:${p.id}` ? '保存中…' : '保存'}</button>
            {p.configured && <button className="btn" disabled={Boolean(pendingAction)} onClick={() => void remove(p.id)}>{pendingAction === `remove:${p.id}` ? '删除中…' : '删除'}</button>}
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
            <button className="btn" disabled={Boolean(pendingAction)} onClick={() => void remove(p.id)}>{pendingAction === `remove:${p.id}` ? '删除中…' : '删除'}</button>
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
            disabled={Boolean(pendingAction) || !(draft['__cf_label'] ?? '').trim() || !(draft['__cf_url'] ?? '').trim() || !(draft['__cf_key'] ?? '').trim()}
            onClick={async () => {
              if (pendingAction) return;
              setPendingAction('add-custom');
              try {
                await requestKeyApi('/api/keys/custom', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ label: draft['__cf_label'], baseUrl: draft['__cf_url'], key: draft['__cf_key'], model: draft['__cf_model'] }),
                }, '添加失败');
                setDraft((m) => ({ ...m, __cf_label: '', __cf_url: '', __cf_key: '', __cf_model: '' }));
                setMsg('自定义服务已保存');
                void load();
              } catch (error) {
                setMsg(`添加失败：${error instanceof Error ? error.message : '请求失败'}`);
              } finally {
                setPendingAction(null);
              }
            }}
          >{pendingAction === 'add-custom' ? '添加中…' : '添加'}</button>
        </div>
        <button
          className="dock-test"
          style={{ marginTop: 10 }}
          onClick={async () => {
            if (pendingAction) return;
            setPendingAction('test');
            setMsg('测试中…');
            try {
              const data = await requestKeyApi('/api/keys/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, '连接测试失败');
              setMsg(`✅ ${String(data.provider ?? '模型')}/${String(data.model ?? '')} 连通（${String(data.ms ?? '—')}ms）`);
            } catch (error) {
              setMsg(`❌ ${error instanceof Error ? error.message : '连接测试失败'}`);
            } finally {
              setPendingAction(null);
            }
          }}
          disabled={Boolean(pendingAction)}
        >{pendingAction === 'test' ? '⏳ 测试中…' : '🔌 测试模型连接（用当前自动选择的网关发一条真实消息）'}</button>
        {providers && providers.length === 0 && <p className="dim">密钥服务不可用（生成服务未启动？）</p>}
        {msg && <p className="key-settings-message" role="status" aria-live="polite">{msg}</p>}
        <button className="go" style={{ marginTop: 12 }} onClick={onClose} disabled={Boolean(pendingAction)}>完成</button>
      </section>
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
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [styleCount, setStyleCount] = useState<number | null>(null);
  const [styleGroups, setStyleGroups] = useState<{ base: string; items: StyleEntry[] }[] | null>(null);
  const [styleCatalogOpen, setStyleCatalogOpen] = useState(false);
  const [styleSearch, setStyleSearch] = useState('');
  const [styleBaseFilter, setStyleBaseFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'delivered' | 'blocked'>('all');
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmTargets, setConfirmTargets] = useState<ProjectMeta[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setLoadError(null);
    try {
      const nextProjects = await fetchProjects();
      setProjects(nextProjects);
      const availableIds = new Set(nextProjects.map((project) => project.id));
      setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
    }
    catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingProjects(false); }
  }, []);

  useEffect(() => {
    void loadProjects();
    fetchStyles()
      .then(({ count, styles }) => {
        setStyleCount(count);
        const groups = new Map<string, StyleEntry[]>();
        for (const s of styles) {
          if (!groups.has(s.base)) groups.set(s.base, []);
          groups.get(s.base)!.push(s);
        }
        setStyleGroups([...groups.entries()].map(([base, items]) => ({ base, items })));
      })
      .catch(() => {});
  }, [loadProjects]);

  useEffect(() => {
    if (!confirmTargets) return;
    cancelDeleteRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) setConfirmTargets(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmTargets, deleting]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (projects ?? []).filter((project) => {
      const matchesQuery = !needle || [project.name, project.sentence, project.typeName, project.styleName]
        .some((value) => String(value ?? '').toLocaleLowerCase().includes(needle));
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'delivered' ? project.delivered : !project.delivered);
      return matchesQuery && matchesStatus;
    });
  }, [projects, query, statusFilter]);

  const deliveredCount = (projects ?? []).filter((project) => project.delivered).length;
  const blockedCount = (projects ?? []).length - deliveredCount;
  const selectedVisibleCount = visibleProjects.filter((project) => selectedIds.includes(project.id)).length;
  const allVisibleSelected = visibleProjects.length > 0 && selectedVisibleCount === visibleProjects.length;
  const allProjectsSelected = (projects ?? []).length > 0 && (projects ?? []).every((project) => selectedIds.includes(project.id));
  const allCatalogStyles = styleGroups?.flatMap((group) => group.items) ?? [];
  const currentStyleName = FEATURED_STYLES.find((item) => item.id === style)?.name
    ?? allCatalogStyles.find((item) => item.id === style)?.name
    ?? '自动搭配';
  const visibleCatalogStyles = allCatalogStyles.filter((item) => {
    const matchesSearch = !styleSearch.trim() || `${item.name} ${item.id} ${item.base} ${item.palette}`.toLocaleLowerCase().includes(styleSearch.trim().toLocaleLowerCase());
    return matchesSearch && (styleBaseFilter === 'all' || item.base === styleBaseFilter);
  });

  const submit = () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    onSubmitProject(text.trim());
  };

  const toggleProject = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id]);

  const toggleVisibleSelection = () => {
    const ids = visibleProjects.map((project) => project.id);
    setSelectedIds((current) => allVisibleSelected
      ? current.filter((id) => !ids.includes(id))
      : [...new Set([...current, ...ids])]);
  };

  const toggleAllProjectSelection = () => setSelectedIds(allProjectsSelected ? [] : (projects ?? []).map((project) => project.id));

  const openDeleteConfirmation = (targets: ProjectMeta[]) => {
    if (!targets.length) return;
    setDeleteError(null);
    setConfirmTargets(targets);
  };

  const confirmDelete = async () => {
    if (!confirmTargets?.length || deleting) return;
    const ids = confirmTargets.map((project) => project.id);
    setDeleting(true);
    setDeleteError(null);
    setNotice(null);
    try {
      const deleted = await deleteProjects(ids);
      const removed = new Set(deleted);
      setProjects((current) => (current ?? []).filter((project) => !removed.has(project.id)));
      const remainingSelection = selectedIds.filter((id) => !removed.has(id));
      setSelectedIds(remainingSelection);
      setNotice(`已删除 ${deleted.length} 个项目及其本地文件`);
      setConfirmTargets(null);
      if (selectedIds.length > 0 && remainingSelection.length === 0) setManageMode(false);
    } catch (e) {
      const partiallyDeleted = e && typeof e === 'object' && 'deleted' in e && Array.isArray(e.deleted)
        ? e.deleted.filter((id): id is string => typeof id === 'string')
        : [];
      if (partiallyDeleted.length) {
        const removed = new Set(partiallyDeleted);
        setProjects((current) => (current ?? []).filter((project) => !removed.has(project.id)));
        setSelectedIds((current) => current.filter((id) => !removed.has(id)));
        setConfirmTargets((current) => current?.filter((project) => !removed.has(project.id)) ?? null);
        setNotice(`已删除 ${partiallyDeleted.length} 个项目，其余项目仍待确认`);
      }
      setDeleteError(e instanceof Error ? e.message : String(e));
      void loadProjects();
    } finally {
      setDeleting(false);
    }
  };

  const selectedProjects = (projects ?? []).filter((project) => selectedIds.includes(project.id));

  return (
    <div className="home">
      {showKeys && <KeySettings onClose={() => setShowKeys(false)} />}
      {confirmTargets && (
        <div className="delete-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setConfirmTargets(null); }}>
          <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
            <div className="delete-mark">!</div>
            <p className="home-kicker">删除确认</p>
            <h2 id="delete-title">删除 {confirmTargets.length} 个项目？</h2>
            <p id="delete-description">项目记录、生成网页、图片和本地文件都会一起删除，此操作无法撤销。</p>
            <ul className="delete-list">
              {confirmTargets.slice(0, 4).map((project) => <li key={project.id}>{project.name}</li>)}
              {confirmTargets.length > 4 && <li>以及另外 {confirmTargets.length - 4} 个项目</li>}
            </ul>
            {deleteError && <div className="home-error">{deleteError}</div>}
            <div className="delete-actions">
              <button ref={cancelDeleteRef} className="btn" disabled={deleting} onClick={() => setConfirmTargets(null)}>取消</button>
              <button className="danger-button" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? '删除中…' : `确认删除 ${confirmTargets.length} 个项目`}
              </button>
            </div>
          </section>
        </div>
      )}

      <header className="home-topline">
        <div className="home-brand"><span className="home-brand-mark">✦</span><span>Orchestr<span>AI</span></span><small>创作工作室</small></div>
        <div className="home-top-actions">
          <button className="btn" onClick={() => setShowKeys(true)}>🔑 模型与图源</button>
          <button className="btn" onClick={onDemo}>▶ 观看演示</button>
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <div className="hero-copy">
            <div className="home-badge"><span className="live-dot" />真实生成 · {styleCount ? `${styleCount} 种风格 · ` : ''}图片搜寻 · 交互门禁</div>
            <p className="home-kicker">ORCHESTRAI · AI WEBSITE STUDIO</p>
            <h1>把一个想法，<br /><span>做成能用的网站。</span></h1>
            <p className="hero-description">用一句话启动创作。Agent 会规划页面、搜寻合适图片、整理交互，并生成可预览、可下载的网站。</p>
            <div className="home-input">
              <label htmlFor="project-name">先给项目起个名字</label>
              <div className="home-input-row">
                <input
                  id="project-name"
                  value={text}
                  placeholder="例如：法拉利展馆、生日倒数日…"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                />
                <button className="go primary-go" disabled={busy || !text.trim()} onClick={submit}>
                  {busy ? '⏳ 创建中…' : '创建项目'} <span aria-hidden="true">→</span>
                </button>
              </div>
              <p className="input-note">项目创建后，再输入具体网站需求；支持 Word、TXT 和 Markdown 文档。</p>
            </div>
            <div className="home-examples">
              <span className="dim">从这里开始</span>
              {NAME_IDEAS.map((idea) => (
                <button key={idea} className="idea-chip" onClick={() => setText(idea)}>{idea}</button>
              ))}
            </div>
          </div>

          <div className="home-visual" aria-hidden="true">
            <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
            <div className="visual-float visual-float-top"><span>●</span> 创作流程已就绪</div>
            <div className="mini-browser">
              <div className="mini-browser-bar"><i /><i /><i /><span>orchestrai.studio</span><b>↗</b></div>
              <div className="mini-page">
                <div className="mini-page-nav"><b>STUDIO</b><span>灵感 · 设计 · 交付</span></div>
                <div className="mini-page-copy"><small>YOUR NEXT IDEA</small><strong>从灵感，<br />到真实体验。</strong><span /></div>
                <div className="mini-landscape"><i /><b /><em /></div>
                <div className="mini-page-cards"><i /><i /><i /></div>
              </div>
            </div>
            <div className="visual-float visual-float-bottom"><span>✦</span> 图片 · 交互 · 可交付</div>
          </div>

          <div className="pref-card">
            <div className="pref-section">
              <div><div className="pref-title">🎨 创作风格</div><div className="pref-hint">选择一款基调，也可以留给系统按主题定制</div></div>
              <div className="style-picker">
                <div className="featured-style-grid" role="group" aria-label="精选创作风格">
                {FEATURED_STYLES.map((item) => (
                  <button key={item.id || 'auto'} className={`style-card ${style === item.id ? 'active' : ''}`} aria-pressed={style === item.id} onClick={() => setStyle(item.id)}>
                    <span className="style-card-art"><img src={item.image} alt="" loading="lazy" /><span className="style-card-check" aria-hidden="true">✓</span><span className="photo-credit">{item.credit}</span></span>
                    <span className="style-card-copy"><b>{item.name}</b><span>{item.description}</span></span>
                  </button>
                ))}
                </div>
                <div className="style-catalog">
                  <div className="style-catalog-heading">
                    <div><b>完整风格库</b><span>{styleCount ? `${styleCount} 种照片图签 · 当前：${currentStyleName}` : '正在载入风格预览…'}</span></div>
                    <button className="catalog-toggle" aria-expanded={styleCatalogOpen} onClick={() => setStyleCatalogOpen((open) => !open)}>
                      {styleCatalogOpen ? '收起目录' : `浏览全部 ${styleCount ?? '…'} 种`} <span aria-hidden="true">{styleCatalogOpen ? '⌃' : '⌄'}</span>
                    </button>
                  </div>
                  {styleCatalogOpen && (
                    <>
                      <div className="style-catalog-controls">
                        <label className="style-catalog-search"><span aria-hidden="true">⌕</span><input value={styleSearch} onChange={(event) => setStyleSearch(event.target.value)} placeholder="搜索风格或色彩…" aria-label="搜索全部风格" /></label>
                        <span className="style-result-count">显示 {visibleCatalogStyles.length} / {allCatalogStyles.length}</span>
                      </div>
                      <div className="style-base-filters" role="group" aria-label="按风格类别筛选">
                        <button className={styleBaseFilter === 'all' ? 'active' : ''} aria-pressed={styleBaseFilter === 'all'} onClick={() => setStyleBaseFilter('all')}>全部类别</button>
                        {(styleGroups ?? []).map((group) => (
                          <button key={group.base} className={styleBaseFilter === group.base ? 'active' : ''} aria-pressed={styleBaseFilter === group.base} onClick={() => setStyleBaseFilter(group.base)}>{STYLE_BASE_INFO[group.base]?.name ?? group.base}</button>
                        ))}
                      </div>
                      <div className="all-style-grid">
                        {visibleCatalogStyles.map((item) => {
                          const baseInfo = STYLE_BASE_INFO[item.base] ?? STYLE_BASE_INFO.neon!;
                          const paletteInfo = STYLE_PALETTE_INFO[item.palette] ?? STYLE_PALETTE_INFO.obsidian!;
                          return (
                            <button key={item.id} className={`style-card all-style-card ${style === item.id ? 'active' : ''}`} aria-pressed={style === item.id} onClick={() => setStyle(item.id)}>
                              <span className="style-card-art"><img src={baseInfo.image} alt="" loading="lazy" /><span className="style-palette-dot" style={{ backgroundColor: paletteInfo.color }} /><span className="photo-credit">{baseInfo.credit}</span></span>
                              <span className="style-card-copy"><b>{item.name}</b><span>{baseInfo.description} · {paletteInfo.description}</span></span>
                            </button>
                          );
                        })}
                        {visibleCatalogStyles.length === 0 && <p className="style-no-results">没有匹配风格，试试其他名称或类别。</p>}
                      </div>
                    </>
                  )}
                </div>
                <input className="style-desc" value={styleDesc} placeholder="自定义视觉描述：暖棕、玻璃质感、衬线标题…" onChange={(e) => setStyleDesc(e.target.value)} aria-label="自定义视觉风格" />
              </div>
            </div>
            <div className="pref-divider" />
            <div className="pref-section pref-fx-section">
              <div><div className="pref-title">✨ 页面动效</div><div className="pref-hint">粒子避让、鼠标拖尾与点击涟漪</div></div>
              <div className="style-picker fx-picker" role="group" aria-label="页面动效级别">
                {([['', '自动'], ['subtle', '柔和'], ['full', '炫动'], ['off', '关闭']] as const).map(([id, label]) => (
                  <button key={id || 'fxauto'} className={`chip style-chip ${fx === id ? 'cyan' : ''}`} aria-pressed={fx === id} onClick={() => setFx(id)}>{label}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="home-body" aria-labelledby="projects-title">
          <div className="library-heading">
            <div>
              <p className="home-kicker">YOUR WORKSPACE</p>
              <h2 id="projects-title">项目库 <span>{projects ? projects.length : '—'}</span></h2>
              <p className="library-subtitle">集中管理你创建的网站、图片素材和交付记录。</p>
            </div>
            <button className="btn refresh-button" onClick={() => void loadProjects()} disabled={loadingProjects}>{loadingProjects ? '同步中…' : '↻ 刷新项目'}</button>
          </div>

          <div className="project-stats">
            <div className="stat-card"><span className="stat-icon cyan-icon">◈</span><div><b>{projects?.length ?? '—'}</b><small>全部项目</small></div></div>
            <div className="stat-card"><span className="stat-icon green-icon">✓</span><div><b>{projects ? deliveredCount : '—'}</b><small>已交付</small></div></div>
            <div className="stat-card"><span className="stat-icon amber-icon">◷</span><div><b>{projects ? blockedCount : '—'}</b><small>待处理</small></div></div>
          </div>

          <div className="project-toolbar">
            <label className="project-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称、需求或风格…" aria-label="搜索项目" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索">×</button>}</label>
            <div className="project-filters" role="group" aria-label="项目状态筛选">
              {([['all', '全部'], ['delivered', '已交付'], ['blocked', '待处理']] as const).map(([key, label]) => (
                <button key={key} className={statusFilter === key ? 'active' : ''} aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}>{label}</button>
              ))}
            </div>
            <button className={`btn manage-button ${manageMode ? 'selected' : ''}`} onClick={() => { setManageMode((mode) => !mode); setSelectedIds([]); }}>
              {manageMode ? '退出管理' : '批量管理'}
            </button>
          </div>

          {manageMode && (
            <div className="selection-toolbar">
              <span>已选 <b>{selectedIds.length}</b> 个项目</span>
              <button className="text-action select-all-action" onClick={toggleAllProjectSelection} disabled={!projects?.length} aria-pressed={allProjectsSelected} aria-label={allProjectsSelected ? '取消选择全部项目' : `选择全部 ${projects?.length ?? 0} 个项目`}>{allProjectsSelected ? '取消全选' : `全选全部项目（${projects?.length ?? 0}）`}</button>
              <button className="text-action" onClick={toggleVisibleSelection} disabled={!visibleProjects.length}>{allVisibleSelected ? '取消当前筛选' : `选择当前筛选（${visibleProjects.length}）`}</button>
              {selectedIds.length > 0 && <button className="text-action" onClick={() => setSelectedIds([])}>清空选择</button>}
              <button className="danger-button small-danger" disabled={!selectedIds.length} onClick={() => openDeleteConfirmation(selectedProjects)}>删除所选</button>
            </div>
          )}

          {notice && <div className="home-notice"><span>✓</span>{notice}<button onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
          {loadError && <div className="home-error"><span>项目列表加载失败：{loadError}</span><button className="btn" onClick={() => void loadProjects()}>重试</button></div>}

          <div className="home-grid">
            {visibleProjects.map((project) => {
              const selected = selectedIds.includes(project.id);
              return (
                <article className={`proj-card ${selected ? 'is-selected' : ''}`} key={project.id}>
                  <div className="proj-card-top">
                    {manageMode ? (
                      <label className="project-checkbox"><input type="checkbox" checked={selected} onChange={() => toggleProject(project.id)} /><span>选择项目</span></label>
                    ) : <span className="project-type">{project.typeName || 'PagePlan 页面'}</span>}
                    <span className={`project-status ${project.delivered ? 'delivered' : 'blocked'}`}><i />{project.delivered ? `已交付${project.deliveryVersion ? ` · v${project.deliveryVersion}` : ''}` : '待处理'}</span>
                  </div>
                  <h3 className="p-name">{project.name}</h3>
                  <div className="p-chips">
                    {project.styleName && <span className="chip">{project.styleName}</span>}
                    {project.hadDefectFix && <span className="chip amber">含缺陷修复</span>}
                    {(project.imageCount ?? 0) > 0 && <span className="chip purple">🖼 {project.imageCount} 张素材</span>}
                  </div>
                  <p className="p-sentence">{project.sentence}</p>
                  <div className="p-meta"><span>{new Date(project.createdAt).toLocaleString('zh-CN', { hour12: false })}</span><span>{project.fileCount ?? 0} 个文件</span></div>
                  <div className="project-card-actions">
                    <button className="btn delete-project-button" onClick={() => openDeleteConfirmation([project])} aria-label={`删除项目 ${project.name}`}>删除</button>
                    <button className="open-project-button" onClick={() => onEnterProject(project)}>打开项目 <span aria-hidden="true">↗</span></button>
                  </div>
                </article>
              );
            })}
            {loadingProjects && !projects && <div className="projects-loading"><span className="loading-orbit" />正在整理项目库…</div>}
            {!loadingProjects && !loadError && projects?.length === 0 && (
              <div className="projects-empty"><span className="empty-glyph">✦</span><h3>你的项目空间已准备好</h3><p>从上方创建一个项目，随后描述你想做的网站。</p></div>
            )}
            {!loadingProjects && projects && projects.length > 0 && visibleProjects.length === 0 && (
              <div className="projects-empty"><span className="empty-glyph">⌕</span><h3>没有找到匹配项目</h3><p>试试其他关键词或状态筛选。</p><button className="btn" onClick={() => { setQuery(''); setStatusFilter('all'); }}>清除筛选</button></div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
