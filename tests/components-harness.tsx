import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DateFields, DraftField, Modal } from '../src/renderer/components';
import type { Schedule } from '../src/shared/types';
import '../src/renderer/styles.css';

function Harness() {
  const [schedule, setSchedule] = useState<Schedule>({ mode: 'none' });
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(false);
  const [width, setWidth] = useState(480);
  const [fontSize, setFontSize] = useState(14);
  const failures = useRef(false),
    saves = useRef<string[]>([]);
  Object.assign(window, {
    componentsHarness: {
      schedule: () => schedule,
      note: () => note,
      saves: () => saves.current,
      fail: (value: boolean) => {
        failures.current = value;
      },
      width: setWidth,
      fontSize: setFontSize,
      rootFont: (size: number) => {
        window.setTimeout(() => document.documentElement.style.setProperty('--base-font', `${size}px`), 0);
      },
    },
  });
  return (
    <div style={{ padding: 28, width, fontSize, height: '100vh', overflow: 'auto' }}>
      <DateFields
        value={schedule}
        onChange={setSchedule}
        allowInherit
        inheritedRange={{ start: '2026-11-14', end: '2026-11-18' }}
      />
      <DraftField
        value={note}
        onCommit={async (value) => {
          if (failures.current) throw new Error('Test save failure');
          saves.current.push(value);
          setNote(value);
        }}
        label="自适应备注"
        multiline
        draftKey="components-regression-note"
      />
      <button type="button" onClick={() => setModal(true)}>
        打开长对话框
      </button>
      {modal && (
        <Modal title="长内容回归" onClose={() => setModal(false)}>
          <input aria-label="对话框输入" defaultValue="保持焦点" />
          {Array.from({ length: 80 }, (_, index) => (
            <p key={index}>第 {index + 1} 行内容：滚动正文时关闭按钮始终可见。</p>
          ))}
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
