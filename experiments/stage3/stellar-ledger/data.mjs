// 星轨档案馆 · 亮星数据
// 数据说明：示例数据——依据公开星表（Hipparcos/Yale BSC）的常识级数值整理，用于设计原型验证；
// 数值为常见科普口径的约数，非精确天文归算（页面档案卡内明确标注）。
// spec: 光谱型 → 恒星颜色（天体物理常规的光谱-色温对应）
export const SPECTRAL_COLORS = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff', G: '#fff4ea', K: '#ffd2a1', M: '#ffcc6f',
};
export const SPECTRAL_NAMES = { O: 'O 型·蓝巨星', B: 'B 型·蓝白', A: 'A 型·白', F: 'F 型·黄白', G: 'G 型·黄', K: 'K 型·橙', M: 'M 型·红' };

// x/y 为版式坐标（0-1 天区布局，非天文坐标）；mag 视星等；dist 光年；spec 光谱型
export const STARS = [
  { n: '天狼星', en: 'Sirius', bayer: 'α CMa', mag: -1.46, dist: 8.6, spec: 'A', x: 0.72, y: 0.30, note: '全天最亮恒星，古希腊以它的偕日升标定夏季的开始。' },
  { n: '老人星', en: 'Canopus', bayer: 'α Car', mag: -0.74, dist: 310, spec: 'A', x: 0.18, y: 0.78, note: '南天第二亮星，航海者的"南极之星"。' },
  { n: '大角星', en: 'Arcturus', bayer: 'α Boo', mag: -0.05, dist: 36.7, spec: 'K', x: 0.55, y: 0.14, note: '北天最亮星，1933 年芝加哥世博会用它的星光点亮开幕灯光。' },
  { n: '南门二', en: 'Rigil Kentaurus', bayer: 'α Cen', mag: -0.27, dist: 4.37, spec: 'G', x: 0.12, y: 0.86, note: '距太阳最近的恒星系统之一。' },
  { n: '织女一', en: 'Vega', bayer: 'α Lyr', mag: 0.03, dist: 25, spec: 'A', x: 0.44, y: 0.10, note: '织女星，历史上的摄影零等标准星。' },
  { n: '五车二', en: 'Capella', bayer: 'α Aur', mag: 0.08, dist: 42.9, spec: 'G', x: 0.34, y: 0.08, note: '御夫座α，北天冬季的黄色灯塔。' },
  { n: '参宿七', en: 'Rigel', bayer: 'β Ori', mag: 0.13, dist: 860, spec: 'B', x: 0.86, y: 0.44, note: '猎户座左足，蓝超巨星，光度约为太阳的 12 万倍。' },
  { n: '南河三', en: 'Procyon', bayer: 'α CMi', mag: 0.34, dist: 11.5, spec: 'F', x: 0.66, y: 0.16, note: '小犬座α，"先行于犬"——先于天狼星升起。' },
  { n: '参宿四', en: 'Betelgeuse', bayer: 'α Ori', mag: 0.50, dist: 548, spec: 'M', x: 0.80, y: 0.58, note: '红超巨星，未来的超新星候选。' },
  { n: '水委一', en: 'Achernar', bayer: 'α Eri', mag: 0.46, dist: 139, spec: 'B', x: 0.06, y: 0.62, note: '波江尽头之星，因高速自转呈扁球形。' },
  { n: '马腹一', en: 'Hadar', bayer: 'β Cen', mag: 0.61, dist: 390, spec: 'B', x: 0.15, y: 0.92, note: '半人马座β，与南门二相邻的蓝巨星。' },
  { n: '牛郎星', en: 'Altair', bayer: 'α Aql', mag: 0.76, dist: 16.7, spec: 'A', x: 0.52, y: 0.24, note: '河鼓二，自转极快（约 9 小时一周）的扁星。' },
  { n: '毕宿五', en: 'Aldebaran', bayer: 'α Tau', mag: 0.86, dist: 65, spec: 'K', x: 0.26, y: 0.30, note: '金牛之眼，毕星团的"追随者"。' },
  { n: '心宿二', en: 'Antares', bayer: 'α Sco', mag: 1.06, dist: 550, spec: 'M', x: 0.62, y: 0.82, note: '天蝎之心，"火星的对手"。' },
  { n: '角宿一', en: 'Spica', bayer: 'α Vir', mag: 0.97, dist: 250, spec: 'B', x: 0.58, y: 0.66, note: '室女座α，夏季大三角之外的南天亮星。' },
  { n: '北河三', en: 'Pollux', bayer: 'β Gem', mag: 1.14, dist: 33.8, spec: 'K', x: 0.30, y: 0.12, note: '双子之兄，已确认拥有系外行星。' },
  { n: '北落师门', en: 'Fomalhaut', bayer: 'α PsA', mag: 1.16, dist: 25, spec: 'A', x: 0.40, y: 0.90, note: '秋夜南天孤星，拥有尘埃盘。' },
  { n: '天津四', en: 'Deneb', bayer: 'α Cyg', mag: 1.25, dist: 2600, spec: 'A', x: 0.48, y: 0.06, note: '天鹅之尾，已知最明亮恒星之一。' },
  { n: '十字架二', en: 'Acrux', bayer: 'α Cru', mag: 0.76, dist: 320, spec: 'B', x: 0.10, y: 0.94, note: '南十字座α，出现在多国国旗上。' },
  { n: '轩辕十四', en: 'Regulus', bayer: 'α Leo', mag: 1.40, dist: 79, spec: 'B', x: 0.50, y: 0.34, note: '狮子之心，黄道上的"王者之星"。' },
  { n: '娄宿三', en: 'Hamal', bayer: 'α Ari', mag: 2.00, dist: 65.8, spec: 'K', x: 0.36, y: 0.22, note: '白羊座α，春分点的古老标记。' },
  { n: '天船三', en: 'Mirfak', bayer: 'α Per', mag: 1.79, dist: 510, spec: 'F', x: 0.28, y: 0.04, note: '英仙座α，英仙α星团之首。' },
];
