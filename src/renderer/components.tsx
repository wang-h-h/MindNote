import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, Sun, CalendarDays, CalendarRange } from 'lucide-react';
import type { Schedule } from '../shared/types';
import { localDate, periodRange, type DateRange } from '../shared/domain';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src={new URL('../../assets/icon.png', import.meta.url).href}
      width={size}
      height={size}
      alt="MindNote 图标"
      style={{ objectFit: 'contain' }}
    />
  );
}
export function IconButton({
  title,
  children,
  onClick,
  active,
  disabled,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={title}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const focusable = () => [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
      ),
    ];
    (dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable()[1] ?? dialog).focus();
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener('keydown', key);
    return () => {
      dialog.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton title="关闭对话框" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function DateFields({
  value,
  onChange,
  allowInherit = false,
  required = false,
  inheritedRange = null,
}: {
  value: Schedule;
  onChange: (value: Schedule) => void;
  allowInherit?: boolean;
  required?: boolean;
  inheritedRange?: DateRange | null;
}) {
  const today = localDate();
  const choose = (filter: 'today' | 'week' | 'month') =>
    onChange({ mode: 'range', ...periodRange(filter, today)! });
  const range = value.mode === 'range' ? value : value.mode === 'inherit' ? inheritedRange : null;
  const start = range?.start ?? '',
    end = range?.end ?? '';
  const changeDate = (part: 'start' | 'end', next: string) => {
    if (!next) {
      onChange(
        required
          ? { mode: 'range', start: part === 'start' ? '' : start, end: part === 'end' ? '' : end }
          : { mode: 'none' },
      );
    } else if (part === 'start') {
      onChange({ mode: 'range', start: next, end: end && end >= next ? end : next });
    } else {
      onChange({ mode: 'range', start: start && start <= next ? start : next, end: next });
    }
  };
  return (
    <div className="date-fields">
      <label className="field-label">
        <CalendarDays size={16} />
        计划日期
      </label>
      <div className="date-presets">
        {(['today', 'week', 'month'] as const).map((f, i) => {
          const Icon = [Sun, CalendarDays, CalendarRange][i];
          const chosen =
            value.mode === 'range' &&
            value.start === periodRange(f, today)?.start &&
            value.end === periodRange(f, today)?.end;
          return (
            <button
              type="button"
              key={f}
              onClick={() => choose(f)}
              aria-pressed={chosen}
              className={chosen ? 'chosen' : ''}
            >
              <Icon size={17} />
              {['今天', '本周', '本月'][i]}
            </button>
          );
        })}
      </div>
      <div className="date-inputs">
        <label>
          开始日期
          <input
            aria-label="开始日期"
            type="date"
            required={required || value.mode === 'range'}
            value={start}
            onChange={(e) => changeDate('start', e.target.value)}
          />
        </label>
        <span>至</span>
        <label>
          结束日期
          <input
            aria-label="结束日期"
            type="date"
            required={required || value.mode === 'range'}
            min={start || undefined}
            value={end}
            onChange={(e) => changeDate('end', e.target.value)}
          />
        </label>
      </div>
      {(!required || allowInherit) && (
        <div className="date-mode-buttons">
          {!required && (
            <button
              type="button"
              aria-pressed={value.mode === 'none'}
              onClick={() => onChange({ mode: 'none' })}
            >
              暂不安排
            </button>
          )}
          {allowInherit && (
            <button
              type="button"
              aria-pressed={value.mode === 'inherit'}
              onClick={() => onChange({ mode: 'inherit' })}
            >
              跟随父项
            </button>
          )}
        </div>
      )}
    </div>
  );
}
// Only unfinished edits are kept here. They survive inspector switches, not app restarts.
const pendingDrafts = new Map<string, { text: string; failed: boolean }>();

export function DraftField({
  value,
  onCommit,
  label,
  multiline = false,
  placeholder,
  className = '',
  readOnly = false,
  draftKey,
}: {
  value: string;
  readOnly?: boolean;
  onCommit: (value: string) => Promise<unknown>;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  draftKey?: string;
}) {
  const initial = useRef(draftKey ? pendingDrafts.get(draftKey) : undefined);
  const [draft, setDraft] = useState(initial.current?.text ?? value);
  const [failed, setFailed] = useState(initial.current?.failed ?? false);
  const [restored, setRestored] = useState(!!initial.current);
  const dirty = useRef(!!initial.current),
    latest = useRef(initial.current?.text ?? value),
    saved = useRef(value);
  const mounted = useRef(true),
    composing = useRef(false),
    flushAfterComposition = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<{ text: string; promise: Promise<void> } | null>(null);
  const queued = useRef(false);
  const commitRef = useRef(onCommit),
    readOnlyRef = useRef(readOnly);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeRef = useRef<() => void>(() => {});
  commitRef.current = onCommit;
  readOnlyRef.current = readOnly;
  resizeRef.current = () => {
    const field = textareaRef.current;
    if (!field || !field.isConnected) return;
    const style = getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    field.style.height = '0px';
    field.style.height = `${Math.ceil(Math.max(line * 2 + padding + borders, field.scrollHeight + borders))}px`;
  };
  useLayoutEffect(() => {
    if (multiline) resizeRef.current();
  });
  useEffect(() => {
    if (!multiline || !textareaRef.current) return;
    let previousWidth = -1;
    let fontFrame = 0;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== previousWidth) {
        previousWidth = width;
        resizeRef.current();
      }
    });
    observer.observe(textareaRef.current);
    // App writes --base-font in a passive effect after this field's layout
    // measurement. Its width can stay fixed, so ResizeObserver alone misses
    // changed line height and wrapping. Batch root CSS changes into one frame.
    const fontObserver = new MutationObserver(() => {
      if (fontFrame) return;
      fontFrame = requestAnimationFrame(() => {
        fontFrame = 0;
        resizeRef.current();
      });
    });
    fontObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => {
      observer.disconnect();
      fontObserver.disconnect();
      cancelAnimationFrame(fontFrame);
    };
  }, [multiline]);

  function cancelTimer() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function clearCached(text: string, key = draftKey) {
    if (key && pendingDrafts.get(key)?.text === text) pendingDrafts.delete(key);
  }
  function clearStatus() {
    if (mounted.current) {
      setFailed(false);
      setRestored(false);
    }
  }
  function scheduleSave() {
    cancelTimer();
    if (!readOnlyRef.current && !composing.current && dirty.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        void saveRef.current();
      }, 650);
    }
  }
  async function save(): Promise<void> {
    cancelTimer();
    if (readOnlyRef.current || composing.current || !dirty.current) return;
    const running = inFlight.current;
    if (running) {
      // A blur and a timeout for the same text share one request. A later edit is serialized.
      if (running.text !== latest.current) queued.current = true;
      return running.promise;
    }
    const submitted = latest.current,
      key = draftKey,
      commit = commitRef.current;
    if (submitted === saved.current) {
      dirty.current = false;
      clearCached(submitted, key);
      clearStatus();
      return;
    }
    const promise = Promise.resolve()
      .then(() => commit(submitted))
      .then(() => {
        saved.current = submitted;
        if (latest.current === submitted) {
          dirty.current = false;
          clearCached(submitted, key);
          clearStatus();
        }
      })
      .catch(() => {
        // Preserve the exact input, including a temporarily empty title rejected by validation.
        if (latest.current === submitted) {
          if (key && pendingDrafts.get(key)?.text === submitted)
            pendingDrafts.set(key, { text: submitted, failed: true });
          if (mounted.current) {
            setFailed(true);
            setRestored(false);
          }
        }
      })
      .finally(() => {
        inFlight.current = null;
        const shouldFlush = queued.current;
        queued.current = false;
        if (shouldFlush && dirty.current && mounted.current && !composing.current) void saveRef.current();
      });
    inFlight.current = { text: submitted, promise };
    return promise;
  }
  saveRef.current = save;

  useEffect(() => {
    saved.current = value;
    if (!dirty.current || (!inFlight.current && latest.current === value)) {
      dirty.current = false;
      clearCached(latest.current);
      latest.current = value;
      setDraft(value);
      clearStatus();
    }
  }, [value]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelTimer();
    };
  }, []);

  function change(text: string) {
    if (readOnlyRef.current || text === latest.current) return;
    dirty.current = true;
    latest.current = text;
    if (draftKey) pendingDrafts.set(draftKey, { text, failed: false });
    setDraft(text);
    clearStatus();
    if (!composing.current) scheduleSave();
  }
  const props = {
    value: draft,
    readOnly,
    'aria-label': label,
    placeholder,
    className,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      change(event.target.value),
    onCompositionStart: () => {
      composing.current = true;
      cancelTimer();
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      change(event.currentTarget.value);
      composing.current = false;
      if (flushAfterComposition.current) {
        flushAfterComposition.current = false;
        void saveRef.current();
      } else scheduleSave();
    },
    onBlur: () => {
      if (composing.current) {
        flushAfterComposition.current = true;
        cancelTimer();
      } else void saveRef.current();
    },
  };
  return (
    <div className="draft-field">
      {multiline ? (
        <textarea
          {...props}
          ref={textareaRef}
          rows={2}
          style={{ resize: 'none', overflow: 'hidden', minHeight: 0, boxSizing: 'border-box' }}
        />
      ) : (
        <input
          {...props}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current)
              event.currentTarget.blur();
          }}
        />
      )}
      {(failed || restored) && (
        <button
          type="button"
          className="save-retry"
          disabled={readOnly}
          onClick={() => void saveRef.current()}
        >
          {failed ? '保存失败，点击重试' : '有未保存内容，点击保存'}
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-art">
        <div className="empty-line one" />
        <div className="empty-line two" />
        <div className="empty-dot a" />
        <div className="empty-dot b" />
        <div className="empty-dot c" />
        <div className="empty-note">
          <Logo size={48} />
        </div>
      </div>
      <h2>{title}</h2>
      <p>{detail}</p>
      {children}
    </div>
  );
}
