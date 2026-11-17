import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const work = resolve(`.local-data/settings-range-v12-${Date.now()}`);
await mkdir(join(work, 'user-data'), { recursive: true });
await mkdir(resolve('test-results'), { recursive: true });
await build({
  stdin: {
    contents: `
  import React, { useEffect, useRef, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { Appearance } from './src/renderer/V1Dialogs';
  import { createInitialSnapshot, applyCommand } from './src/shared/domain';
  import './src/renderer/styles.css';
  window.mindnote = { getBackgroundImageURL: async () => null };
  function Harness() {
    const [snapshot, setSnapshot] = useState(()=>applyCommand(createInitialSnapshot(), {type:'settings.update',patch:{blur:18}}));
    const [generation, setGeneration] = useState(0), [show, setShow] = useState(true);
    const server = useRef(snapshot), visible = useRef(snapshot); visible.current=snapshot;
    const options = useRef({broadcast:100,ack:240,reject:0}), calls = useRef([]), errors = useRef([]), pending = useRef(0);
    const accept = next => setSnapshot(old => next.revision >= old.revision ? next : old);
    useEffect(()=>{
      const s=snapshot.settings;
      document.documentElement.dataset.theme=s.theme;
      document.documentElement.style.setProperty('--saved-blur',s.blur+'px');
      document.documentElement.style.setProperty('--saved-panel-alpha',String(s.opacity));
      document.documentElement.style.setProperty('--base-font',s.fontSize+'px');
    },[snapshot.settings]);
    const dispatch = async command => {
      const cfg={...options.current}, rejected=options.current.reject>0;
      if (rejected) options.current.reject--;
      const call={patch:command.patch,started:performance.now(),rejected}; calls.current.push(call); pending.current++;
      const result = rejected ? null : applyCommand(server.current,command);
      if(result) {server.current=result;call.revision=result.revision;setTimeout(()=>{call.broadcast=performance.now();accept(result);},cfg.broadcast);}
      try {await new Promise(done=>setTimeout(done,cfg.ack));call.ack=performance.now();if(rejected)throw new Error('Injected save failure');accept(result);return result;}
      finally {pending.current--;}
    };
    window.settingsHarness={
      status:()=>({server:server.current,visible:visible.current,calls:calls.current,errors:errors.current,pending:pending.current}),
      reset(patch={},config={}){if(pending.current)throw new Error('Reset while a request is pending');options.current={broadcast:100,ack:240,reject:0,...config};calls.current=[];errors.current=[];server.current=applyCommand(server.current,{type:'settings.update',patch:{blur:18,opacity:.82,...patch}});accept(server.current);setGeneration(value=>value+1);setShow(true);},
      remote(patch){server.current=applyCommand(server.current,{type:'settings.update',patch});accept(server.current);},
      config(config){options.current={...options.current,...config};},
      remount(){setGeneration(value=>value+1);},
      hide(){setShow(false);},
    };
    return <div className="desktop-app" style={{height:'100vh',overflow:'auto'}}>{show&&<Appearance key={generation} snapshot={snapshot} dispatch={dispatch} onError={error=>errors.current.push(error)} onNotice={()=>{}}/>}</div>;
  }
  createRoot(document.getElementById('root')).render(<Harness/>);
`,
    resolveDir: process.cwd(),
    sourcefile: 'settings-v12-harness.tsx',
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
  `const {app,BrowserWindow}=require('electron');const path=require('node:path');app.setName('MindNoteSettingsRangeV12Test');app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'user-data'));app.whenReady().then(()=>new BrowserWindow({show:false,width:1150,height:980,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}).loadFile(path.join(__dirname,'index.html')));app.on('window-all-closed',()=>app.quit());`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [join(work, 'main.cjs')], env });
const checks = [],
  metrics = [],
  errors = [];
let failure;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  const blur = () => page.getByRole('slider', { name: '背景模糊', exact: true });
  const idle = () => page.waitForFunction(() => window.settingsHarness.status().pending === 0);
  const reset = async (patch = {}, config = {}) => {
    await idle();
    await page.evaluate(([patch, config]) => window.settingsHarness.reset(patch, config), [patch, config]);
    await page.waitForTimeout(50);
  };
  const status = () => page.evaluate(() => window.settingsHarness.status());
  const pass = (name) => {
    checks.push(name);
    console.log('PASS', name);
  };
  const settleValue = async (value) =>
    page.waitForFunction((value) => {
      const h = window.settingsHarness.status();
      return (
        h.pending === 0 &&
        h.server.settings.blur === value &&
        document.querySelector('input[aria-label="背景模糊"]').value === String(value)
      );
    }, value);
  const previewBlur = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--blur').trim());
  await blur().waitFor();

  await blur().focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await settleValue(36);
  let result = await status();
  assert.deepEqual(
    result.calls.map((call) => call.patch.blur),
    [0, 36],
  );
  await blur().blur();
  await blur().focus();
  await blur().blur();
  await page.waitForTimeout(80);
  assert.equal((await status()).calls.length, 2);
  assert.equal(await previewBlur(), '36px');
  metrics.push({ case: 'Home-End', calls: result.calls });
  pass('Home→End keeps 36 with delayed broadcast/ack; focus/blur adds no writes');

  await reset();
  await blur().focus();
  await page.keyboard.press('Home');
  await page.keyboard.down('End');
  await page.waitForTimeout(150);
  assert.equal(await blur().inputValue(), '36');
  assert.equal(await previewBlur(), '36px');
  assert.equal((await status()).calls.length, 1, 'held key should keep a draft, not add writes yet');
  await page.keyboard.up('End');
  await settleValue(36);
  pass('Old broadcast preserves the active keyboard draft and its live preview');

  await reset();
  await blur().focus();
  await page.keyboard.press('Home');
  const box = await blur().boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height / 2, { steps: 3 });
  const dragged = Number(await blur().inputValue());
  await page.waitForTimeout(150);
  assert.equal(Number(await blur().inputValue()), dragged);
  assert.equal(await previewBlur(), dragged + 'px');
  await page.mouse.up();
  await settleValue(dragged);
  result = await status();
  assert.deepEqual(
    result.calls.map((call) => call.patch.blur),
    [0, dragged],
  );
  pass('A new pointer drag survives an in-flight save and commits once at release');

  await reset({}, { broadcast: 100, ack: 280 });
  await blur().focus();
  await page.keyboard.press('Home');
  await page.evaluate(() => window.settingsHarness.remote({ blur: 12 }));
  await settleValue(12);
  assert.equal((await status()).calls.length, 1);
  assert.equal(await previewBlur(), '12px');
  pass('A newer external revision wins over an older acknowledgement without dirty local input');

  await reset({}, { broadcast: 100, ack: 280 });
  await blur().focus();
  await page.keyboard.press('Home');
  await page.keyboard.down('End');
  await page.evaluate(() => window.settingsHarness.remote({ blur: 12 }));
  await page.waitForTimeout(150);
  assert.equal(await blur().inputValue(), '36');
  assert.equal(await previewBlur(), '36px');
  await page.keyboard.up('End');
  await settleValue(36);
  pass('Finishing a newer local draft after an external revision preserves the user’s final value');

  await reset({}, { reject: 1, ack: 120 });
  await blur().focus();
  await page.keyboard.press('End');
  await settleValue(18);
  assert.equal((await status()).errors.length, 1);
  assert.equal(await previewBlur(), '18px');
  await page.keyboard.press('End');
  await settleValue(36);
  assert.equal((await status()).calls.length, 2);
  pass('A failed save restores the latest authoritative value and can be retried');

  await reset({}, { reject: 1, ack: 200 });
  await blur().focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await settleValue(36);
  result = await status();
  assert.deepEqual(
    result.calls.map((call) => call.patch.blur),
    [0, 36],
  );
  assert.equal(result.errors.length, 1);
  pass('Failure of an older save does not erase a newer queued draft');

  await reset();
  await blur().dispatchEvent('pointerdown', { pointerId: 1, button: 0 });
  await page.evaluate(() => window.settingsHarness.remote({ blur: 11 }));
  await blur().dispatchEvent('pointercancel', { pointerId: 1 });
  await settleValue(11);
  assert.equal((await status()).calls.length, 0);
  pass('Cancel without a changed value reconciles external state without writing');

  await reset({}, { broadcast: 100, ack: 400 });
  await blur().focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.evaluate(() => window.settingsHarness.hide());
  await page.waitForFunction(() => {
    const h = window.settingsHarness.status();
    return h.pending === 0 && h.server.settings.blur === 36;
  });
  result = await status();
  assert.deepEqual(
    result.calls.map((call) => call.patch.blur),
    [0, 36],
  );
  pass('Closing settings preserves the last explicitly committed choice');

  await reset({}, { broadcast: 100, ack: 400 });
  await blur().focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.evaluate(() => {
    window.settingsHarness.config({ ack: 80, broadcast: 20 });
    window.settingsHarness.remount();
  });
  await page.waitForTimeout(50);
  await blur().focus();
  await page.keyboard.press('Home');
  for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowRight');
  await settleValue(12);
  await page.waitForTimeout(450);
  result = await status();
  assert.equal(
    result.server.settings.blur,
    12,
    'old queued work must not override an explicit newer setting session',
  );
  assert(!result.calls.slice(1).some((call) => call.patch.blur === 36));
  pass('A newer settings session supersedes an old unsent draft');

  await reset();
  const opacity = page.getByRole('slider', { name: '背景不透明度', exact: true });
  await opacity.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.waitForFunction(() => {
    const h = window.settingsHarness.status();
    return h.pending === 0 && h.server.settings.opacity === 1;
  });
  result = await status();
  assert.deepEqual(
    result.calls.map((call) => call.patch.opacity),
    [0.35, 1],
  );
  assert.equal(await opacity.inputValue(), '100');
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--panel-alpha').trim(),
    ),
    '1',
  );
  pass('Opacity percent conversion and live preview follow the same final-intent rule');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
} finally {
  await writeFile(
    resolve('test-results/settings-range-v12-regression.json'),
    JSON.stringify({ ok: !failure, checks, metrics, errors, failure: failure?.stack }, null, 2),
  );
  const timer = setTimeout(() => app.process().kill(), 5000);
  timer.unref();
  await app.close().catch(() => {});
  clearTimeout(timer);
}
if (failure) throw failure;
console.log('Settings range V1.2 race regressions passed.');
