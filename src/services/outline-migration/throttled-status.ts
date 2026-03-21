import { bot } from '../../core/bot';

/** Telegram `editMessageText` hard limit */
const TELEGRAM_TEXT_MAX = 4096;
/** Small margin for entity/encoding edge cases */
const TELEGRAM_SAFE = 4088;

const BODY_FOOTER_SEP = '\n\n';

export type MigrationProgressRef = {
  startedAt: number;
  /** 1-based step index for display */
  step: number;
  totalSteps: number;
  phaseLabel: string;
};

const formatDuration = (totalSec: number): string => {
  if (totalSec < 0) totalSec = 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const buildFooter = (ref: MigrationProgressRef): string => {
  const elapsedSec = Math.floor((Date.now() - ref.startedAt) / 1000);
  const lines = [
    '─────────────',
    `⏱ Elapsed: ${formatDuration(elapsedSec)}`,
    `📍 Step ${ref.step}/${ref.totalSteps}: ${ref.phaseLabel}`,
  ];
  if (ref.step === 1) {
    lines.push('📅 Est. remaining: updates after step 2');
  } else if (ref.step < ref.totalSteps) {
    const avg = elapsedSec / (ref.step - 1);
    const remaining = Math.round(avg * (ref.totalSteps - ref.step + 1));
    lines.push(`📅 Est. remaining: ~${formatDuration(remaining)} (very rough)`);
  } else {
    lines.push('📅 Final step — finishing up');
  }
  return lines.join('\n');
};

/** Keep the end of `body` (newest logs); drop from the top when over `maxLen`. */
const truncateBodyFromTop = (body: string, maxLen: number): string => {
  if (maxLen <= 0) return '';
  if (body.length <= maxLen) return body;
  const marker = '…\n';
  const keep = maxLen - marker.length;
  if (keep <= 0) return body.slice(-maxLen);
  return marker + body.slice(body.length - keep);
};

export type ThrottledStatusEditor = {
  push: (line: string) => void;
  /** Re-render footer (elapsed / step / ETA) without adding a log line. */
  touch: () => void;
  finish: () => Promise<void>;
};

export const createThrottledStatusEditor = (
  chatId: number,
  messageId: number,
  minIntervalMs: number,
  initialTitle: string,
  progressRef: MigrationProgressRef,
): ThrottledStatusEditor => {
  let buffer = initialTitle;
  let lastEdit = 0;
  let timeout: NodeJS.Timeout | null = null;

  const doEdit = async () => {
    timeout = null;
    const footer = buildFooter(progressRef);
    const sepLen = BODY_FOOTER_SEP.length;
    const maxBody = Math.max(0, TELEGRAM_SAFE - footer.length - sepLen);
    const body = truncateBodyFromTop(buffer, maxBody);
    let text = `${body}${BODY_FOOTER_SEP}${footer}`;
    if (text.length > TELEGRAM_TEXT_MAX) {
      text = text.slice(text.length - TELEGRAM_TEXT_MAX);
    }
    try {
      await bot.telegram.editMessageText(chatId, messageId, undefined, text, {
        link_preview_options: { is_disabled: true },
      });
    } catch {
      // Rate limits / message not modified — ignore
    }
    lastEdit = Date.now();
  };

  const schedule = () => {
    if (timeout) return;
    const wait = Math.max(0, minIntervalMs - (Date.now() - lastEdit));
    timeout = setTimeout(() => {
      void doEdit();
    }, wait);
  };

  const editor: ThrottledStatusEditor = {
    push(line: string) {
      buffer = buffer.length ? `${buffer}\n${line}` : line;
      schedule();
    },
    touch() {
      if (timeout) clearTimeout(timeout);
      const wait = Math.max(0, minIntervalMs - (Date.now() - lastEdit));
      timeout = setTimeout(() => {
        void doEdit();
      }, wait);
    },
    async finish() {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      await doEdit();
    },
  };

  queueMicrotask(() => {
    void doEdit();
  });

  return editor;
};
