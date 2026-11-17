import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const work = resolve(`.local-data/plan-order-v12-${Date.now()}`);
await mkdir(work, { recursive: true });
await mkdir(join(work, 'user-data'), { recursive: true });
await mkdir(resolve('test-results'), { recursive: true });
await build({
  stdin: {
    contents: `
      import React, { useRef, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import PlanViews from './src/renderer/PlanViews';
      import { createInitialSnapshot, applyCommand, localDate, SYSTEM_MAP_ID, SYSTEM_ROOT_ID } from './src/shared/domain';
      import './src/renderer/styles.css';
      import './src/renderer/plan-v11.css';
      function fixture(count) {
        let state = createInitialSnapshot();
        state = applyCommand(state, { type:'settings.update', patch:{gridColumns:2} });
        return applyCommand(state, { type:'batch', commands:Array.from({length:count},(_,i)=>({
          type:'node.create', id:String.fromCharCode(97+i), mapId:SYSTEM_MAP_ID,
          parentId:SYSTEM_ROOT_ID, title:'事项 '+String.fromCharCode(97+i),
          schedule:{mode:'range',start:localDate(),end:localDate()},
        })) });
      }
      function Harness() {
        const [snapshot,setSnapshot] = useState(()=>fixture(3));
        const current = useRef(snapshot); current.current = snapshot;
        const [height,setHeight] = useState(360), [card,setCard] = useState(false);
        const [filter,setFilter] = useState('today'), [generation,setGeneration] = useState(0);
        const dispatch = async command => { const next=applyCommand(current.current,command);current.current=next;setSnapshot(next);return next; };
        window.planHarness = {
          reset(count,h,asCard=false) {const next=fixture(count);current.current=next;setSnapshot(next);setHeight(h);setCard(asCard);setFilter(asCard?'all':'today');setGeneration(g=>g+1);},
          complete(id,progress=100) {return dispatch({type:'node.update',id,patch:{progress}});},
          notes(id,text) {return dispatch({type:'node.update',id,patch:{notes:{other:text}}});},
          hide(value) {return dispatch({type:'settings.update',patch:{hideCompleted:value}});},
          height:setHeight, filter:setFilter,
        };
        return <div className="desktop-app" style={{padding:12}}>
          <div id="test-viewport" className={card?'view-content':'sticky-list'}
            style={{height,width:card?540:360,overflow:'auto',flex:'none',padding:12}}>
            <PlanViews key={generation} snapshot={snapshot} filter={filter} day={localDate()}
              setDay={()=>{}} dispatch={dispatch} onSelect={()=>{}} onLocate={()=>{}} onAdd={()=>{}} compact={!card}/>
          </div>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
    resolveDir: process.cwd(),
    sourcefile: 'plan-v12-harness.tsx',
    loader: 'tsx',
  },
  bundle: true,
  format: 'esm',
  outfile: join(work, 'bundle.js'),
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(
  join(work, 'index.html'),
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="./bundle.css"></head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>',
);
await writeFile(
  join(work, 'main.cjs'),
  `
  const { app, BrowserWindow } = require('electron');
  const path = require('node:path');
  app.setName('MindNotePlanV12Test');
  app.setPath('userData', path.join(__dirname,'user-data'));
  app.whenReady().then(()=>new BrowserWindow({show:false,width:900,height:1000,webPreferences:{sandbox:true,contextIsolation:true}}).loadFile(path.join(__dirname,'index.html')));
  app.on('window-all-closed',()=>app.quit());
`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [join(work, 'main.cjs')], env });
const checks = [],
  metrics = [],
  errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 30)))),
    );
  const ids = () =>
    page.locator('[data-task-id]').evaluateAll((items) => items.map((item) => item.dataset.taskId));
  const geometry = () =>
    page
      .locator('#test-viewport')
      .evaluate((box) => ({
        client: box.clientHeight,
        scroll: box.scrollHeight,
        overflow: box.querySelector('.plan-projects')?.dataset.planOverflow,
      }));
  const reset = async (count, height, card = false) => {
    await page.evaluate(([c, h, k]) => window.planHarness.reset(c, h, k), [count, height, card]);
    await settle();
  };
  const complete = async (id, progress = 100) => {
    await page.evaluate(([id, p]) => window.planHarness.complete(id, p), [id, progress]);
    await settle();
  };
  const pass = (name) => {
    checks.push(name);
    console.log('PASS', name);
  };
  await page.locator('[data-task-id=a]').waitFor();
  await settle();
  assert.equal((await geometry()).overflow, 'false');
  await complete('a');
  assert.deepEqual(await ids(), ['a', 'b', 'c']);
  metrics.push({ case: 'fit', ...(await geometry()) });
  pass('Completion keeps original position when all rows fit');

  await page.evaluate(() => window.planHarness.height(120));
  await settle();
  assert.equal((await geometry()).overflow, 'true');
  assert.deepEqual(await ids(), ['a', 'b', 'c']);
  pass('Resize overflow alone does not trigger delayed completion movement');
  await complete('b');
  assert.deepEqual(await ids(), ['c', 'b', 'a']);
  await settle();
  assert.deepEqual(await ids(), ['c', 'b', 'a']);
  metrics.push({ case: 'overflow', ...(await geometry()) });
  pass('A new completion in an overflowing list sinks finished items once');

  await page.evaluate(() => window.planHarness.height(500));
  await settle();
  assert.deepEqual(await ids(), ['c', 'b', 'a']);
  await page.evaluate(() => window.planHarness.hide(true));
  await settle();
  assert.deepEqual(await ids(), ['c']);
  await page.evaluate(() => window.planHarness.hide(false));
  await settle();
  assert.deepEqual(await ids(), ['c', 'b', 'a']);
  pass('Resize and completed-item visibility changes remain stable');

  await reset(3, 360);
  await complete('a');
  await page.evaluate(() => window.planHarness.filter('week'));
  await settle();
  assert.deepEqual(await ids(), ['b', 'c', 'a']);
  pass('Switching plan filters establishes a fresh canonical order');

  await reset(8, 160);
  await page.getByRole('button', { name: '收起项目 草稿箱' }).click();
  await complete('a');
  await page.getByRole('button', { name: '展开项目 草稿箱' }).click();
  await settle();
  assert.deepEqual(await ids(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  pass('A completion in a collapsed project does not displace hidden rows');

  await reset(3, 250, true);
  const note = Array.from({ length: 20 }, (_, i) => '完整便签第 ' + (i + 1) + ' 行').join('\n');
  await page.evaluate((text) => window.planHarness.notes('a', text), note);
  await settle();
  const noteGeometry = await page
    .locator('[data-task-id=a] .plan-note-field p')
    .evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight, text: el.textContent }));
  assert.equal(noteGeometry.text, note);
  assert.ok(noteGeometry.height >= noteGeometry.scroll);
  assert.equal((await geometry()).overflow, 'true');
  await complete('a');
  assert.deepEqual(await ids(), ['b', 'c', 'a']);
  await settle();
  assert.deepEqual(await ids(), ['b', 'c', 'a']);
  metrics.push({ case: 'full-card-notes', ...(await geometry()), noteHeight: noteGeometry.height });
  pass('Full card notes participate in actual overflow and completion sorting');
  const style = await page
    .locator('[data-task-id=a] .task-open strong')
    .evaluate((el) => ({
      weight: getComputedStyle(el).fontWeight,
      line: getComputedStyle(el).textDecorationLine,
      thickness: getComputedStyle(el).textDecorationThickness,
      color: getComputedStyle(el).color,
    }));
  assert.equal(style.weight, '700');
  assert.equal(style.line, 'line-through');
  assert.equal(style.thickness, '2px');
  pass('Completed title uses a bold warm strike-through');
  assert.deepEqual(errors, []);
  await writeFile(
    resolve('test-results/plan-v12-regression.json'),
    JSON.stringify({ ok: true, checks, metrics, completedStyle: style, errors }, null, 2),
  );
} finally {
  await app.close();
}
