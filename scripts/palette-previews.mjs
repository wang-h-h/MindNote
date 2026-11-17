import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const schemes = [
  {
    key: 'A',
    title: '雾蓝同色系',
    subtitle: '深蓝主干 · 雾蓝分支',
    root: '#294574',
    branch: '#52729D',
    line: '#718BAD',
    fill: '#EAF0F7',
    darkRoot: '#44699B',
    darkFill: '#283B53',
    darkLine: '#8EA9CC',
  },
  {
    key: 'B',
    title: '深蓝与暖金',
    subtitle: '深蓝主干 · 暖金分支',
    root: '#294574',
    branch: '#94743D',
    line: '#B59A63',
    fill: '#F5EEDC',
    darkRoot: '#44699B',
    darkFill: '#443E30',
    darkLine: '#D5BC83',
  },
  {
    key: 'C',
    title: '蓝灰与暖灰',
    subtitle: '蓝灰主干 · 暖灰分支',
    root: '#43536B',
    branch: '#7D796D',
    line: '#A4A093',
    fill: '#EFEEEA',
    darkRoot: '#4B5D75',
    darkFill: '#363A40',
    darkLine: '#B5B4AD',
  },
];
const font = 'Microsoft YaHei,Segoe UI,sans-serif';
function map(s, dark, y) {
  const bg = dark ? '#232A37' : '#F5F7FA';
  const text = dark ? '#F2F4F8' : '#273448';
  const muted = dark ? '#B7C1D1' : '#65758A';
  const line = dark ? s.darkLine : s.line;
  const fill = dark ? s.darkFill : s.fill;
  return `<g transform="translate(22 ${y})">
    <rect width="404" height="284" rx="18" fill="${bg}"/>
    <text x="18" y="29" fill="${muted}" font-size="14">${dark ? '深色' : '浅色'}</text>
    <path d="M119 141 C145 141 145 98 169 98 M119 141 C145 141 145 206 169 206 M269 98 C293 98 286 65 304 65 M269 98 C293 98 286 130 304 130" fill="none" stroke="${line}" stroke-width="2.6"/>
    <rect x="18" y="117" width="103" height="48" rx="14" fill="${dark ? s.darkRoot : s.root}"/>
    <text x="69" y="147" text-anchor="middle" fill="#fff" font-size="16" font-weight="600">我的项目</text>
    <rect x="167" y="75" width="104" height="46" rx="12" fill="${fill}" stroke="${line}" stroke-width="1.5"/>
    <text x="219" y="103" text-anchor="middle" fill="${text}" font-size="15">设计方案</text>
    <rect x="167" y="183" width="104" height="46" rx="12" fill="${fill}" stroke="${line}" stroke-width="1.5"/>
    <text x="219" y="211" text-anchor="middle" fill="${text}" font-size="15">执行计划</text>
    <rect x="302" y="44" width="86" height="42" rx="10" fill="${dark ? '#2B3341' : '#FFF'}" stroke="${line}"/>
    <text x="345" y="70" text-anchor="middle" fill="${text}" font-size="13">整理想法</text>
    <rect x="302" y="109" width="86" height="42" rx="10" fill="${dark ? '#2B3341' : '#FFF'}" stroke="${line}"/>
    <text x="345" y="135" text-anchor="middle" fill="${text}" font-size="13">完善细节</text>
    <rect x="181" y="239" width="76" height="4" rx="2" fill="${line}" opacity=".35"/>
    <rect x="181" y="239" width="45" height="4" rx="2" fill="#C6A452"/>
  </g>`;
}
const body = schemes
  .map(
    (s, index) => `<g transform="translate(${24 + index * 464} 102)">
  <rect width="448" height="738" rx="22" fill="#FFFFFF" stroke="#DCE2E9"/>
  <text x="22" y="43" font-size="22" font-weight="700" fill="#263B60">${s.key} · ${s.title}</text>
  <text x="22" y="71" font-size="14" fill="#6B778B">${s.subtitle}</text>
  ${map(s, false, 92)}${map(s, true, 392)}
  <circle cx="31" cy="706" r="8" fill="${s.root}"/><circle cx="56" cy="706" r="8" fill="${s.line}"/><circle cx="81" cy="706" r="8" fill="${s.fill}" stroke="#D0D5DD"/>
  <text x="103" y="711" font-size="13" fill="#6B778B">各分支使用统一色系，层级靠明暗区分</text>
</g>`,
  )
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="870" viewBox="0 0 1440 870"><rect width="1440" height="870" fill="#EEF1F5"/><g font-family="${font}"><text x="28" y="47" font-size="29" font-weight="700" fill="#263B60">MindNote V1.2 · 思维导图配色参考</text><text x="29" y="77" font-size="15" fill="#65758A">仅比较导图配色；软件的浅色／深色主题与暖黄进度强调保持一致。</text>${body}</g></svg>`;
const dir = resolve('docs/design');
await mkdir(dir, { recursive: true });
await writeFile(resolve(dir, 'v1.2-palette-options.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(resolve(dir, 'v1.2-palette-options.png'));
console.log(resolve(dir, 'v1.2-palette-options.png'));
