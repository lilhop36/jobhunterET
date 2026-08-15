import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

interface LinkCode {
  userId: string;
  expiresAt: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  private readonly globalRate = Math.max(1, Number(process.env.TELEGRAM_GLOBAL_RATE_PER_SEC ?? 25));
  private readonly perChatInterval = Number(process.env.TELEGRAM_PER_CHAT_INTERVAL_MS ?? 1200);

  private codes = new Map<string, LinkCode>();
  private lastGlobalAt = 0; // FR-024b.1: global 25 msg/s across all users
  private lastChatAt = new Map<string, number>(); // FR-024b.2: 1.2s min between messages per chat
  private updateOffset = 0;

  constructor(private readonly prisma: PrismaService) {}

  get configured(): boolean {
    return !!this.botToken;
  }

  /* ------------------------------------------------------------------ */
  /* Linking (FR-003b)                                                   */
  /* ------------------------------------------------------------------ */

  createCode(userId: string) {
    const code = this.genCode();
    this.codes.set(code, { userId, expiresAt: Date.now() + 10 * 60_000 });
    const bot = process.env.TELEGRAM_BOT_USERNAME || 'JobHunterBot';
    return {
      code,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      deepLink: `https://t.me/${bot}?start=${code}`,
    };
  }

  /** Non-destructive validation for the web UI (FR-003b step 3). */
  validateCode(code: string): { userId: string } | null {
    const rec = this.codes.get(code);
    if (!rec || rec.expiresAt < Date.now()) return null;
    return { userId: rec.userId };
  }

  /** Single-use, time-limited lookup used by the bot's /start handler. */
  consumeCode(code: string): { userId: string } | null {
    const rec = this.validateCode(code);
    if (!rec) return null;
    this.codes.delete(code);
    return rec;
  }

  async status(userId: string) {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    return { linked: !!link, linkedAt: link?.linkedAt ?? null };
  }

  async unlink(userId: string) {
    await this.prisma.telegramLink.deleteMany({ where: { userId } });
    return { ok: true };
  }

  private genCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Delivery (FR-024b)                                                  */
  /* ------------------------------------------------------------------ */

  private async throttle(chatId: string) {
    const globalMin = 1000 / this.globalRate; // e.g. 40ms at 25 msg/s
    const now = Date.now();
    const gWait = this.lastGlobalAt + globalMin - now;
    if (gWait > 0) await sleep(gWait);
    const last = this.lastChatAt.get(chatId) ?? 0;
    const cWait = last + this.perChatInterval - Date.now();
    if (cWait > 0) await sleep(cWait);
    this.lastGlobalAt = Date.now();
    this.lastChatAt.set(chatId, Date.now());
  }

  /** POST to the Bot API, honoring retry_after backoff on 429 (FR-024b.3). */
  private async callApi(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; description?: string; result?: any }> {
    let res: Response;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        const retryAfter = ((await res.json().catch(() => ({}))) as any)?.parameters?.retry_after;
        await sleep((Number(retryAfter) || 2) * 1000 + 500);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, description: text.slice(0, 300) };
      }
      return (await res.json()) as { ok: boolean; result?: any };
    }
    return { ok: false, description: 'Rate limit retries exhausted' };
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: unknown): Promise<'SENT' | 'FAILED'> {
    if (!this.botToken) return 'FAILED';
    try {
      await this.throttle(chatId);
      const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
      if (replyMarkup) body.reply_markup = replyMarkup;
      const res = await this.callApi('sendMessage', body);
      return res.ok ? 'SENT' : 'FAILED';
    } catch (err) {
      this.logger.error(`[NOTIFICATION] Telegram send failed (chatId=${chatId})`, err);
      return 'FAILED';
    }
  }

  private async answerCallback(id: string, text: string) {
    if (!this.botToken) return;
    await this.callApi('answerCallbackQuery', { callback_query_id: id, text }).catch(() => undefined);
  }

  /* ------------------------------------------------------------------ */
  /* Match alert formatting (FR-025 / FR-025c)                           */
  /* ------------------------------------------------------------------ */

  buildMatchText(match: {
    score: number;
    summary: string | null;
    matchedSkills: string[];
    missingSkills: string[];
    job: {
      title: string;
      company: string;
      location: string;
      workPlace: string;
      employmentType: string;
      url: string;
    };
  }): string {
    const band =
      match.score >= 90 ? 'Excellent' : match.score >= 80 ? 'Strong' : match.score >= 70 ? 'Good' : 'Possible';
    const lines = [
      `🔥 NEW JOB MATCH — ${band} (${match.score}%)`,
      ``,
      match.job.title,
      `Company: ${match.job.company}`,
      `Location: ${match.job.location} · ${match.job.workPlace} · ${match.job.employmentType}`,
      ``,
      `💡 Why: ${match.summary || 'High compatibility with your profile.'}`,
    ];
    if (match.matchedSkills.length) lines.push(``, `✓ ${match.matchedSkills.join('  ✓ ')}`);
    if (match.missingSkills.length) lines.push(`Missing: ${match.missingSkills.join(', ')}`);
    lines.push(``, `Apply: ${match.job.url}`);
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Bot polling (FR-003b / FR-025a / FR-025b)                           */
  /* ------------------------------------------------------------------ */

  @Interval(3000)
  async poll() {
    if (!this.botToken) return;
    try {
      await this.pollOnce();
    } catch (err) {
      this.logger.warn(`[BOT] poll failed: ${(err as Error).message}`);
    }
  }

  private async pollOnce() {
    const res = await fetch(
      `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.updateOffset}&timeout=5`,
    );
    if (!res.ok) return;
    const body = (await res.json()) as { result?: TelegramUpdate[] };
    for (const u of body.result ?? []) {
      this.updateOffset = Math.max(this.updateOffset, u.update_id + 1);
      if (u.message?.text !== undefined) {
        await this.handleMessage(u.message.chat.id, u.message.text);
      } else if (u.callback_query?.data && u.callback_query.message) {
        await this.handleCallback(
          u.callback_query.message.chat.id,
          u.callback_query.data,
          u.callback_query.id,
        );
      }
    }
  }

  private async chatToUser(chatId: number) {
    return this.prisma.telegramLink.findUnique({
      where: { chatId: String(chatId) },
      include: { user: true },
    });
  }

  private async handleMessage(chatId: number, text: string) {
    const trimmed = text.trim();
    if (trimmed.startsWith('/start')) {
      return this.handleStart(chatId, trimmed);
    }
    const link = await this.chatToUser(chatId);
    if (!link) {
      return this.sendMessage(String(chatId), '🔗 Your chat is not linked to a JobHunter account yet.\n\nOpen the web app → Settings → Telegram, tap "Open Telegram & Link", then send /start <code> here.');
    }
    const cmd = trimmed.toLowerCase();
    if (cmd === '/status') return this.handleStatus(chatId, link.userId);
    if (cmd === '/saved') return this.handleSaved(chatId, link.userId);
    if (cmd === '/pause') return this.handlePause(chatId, link.userId, true);
    if (cmd === '/resume') return this.handlePause(chatId, link.userId, false);
    if (cmd === '/help') return this.sendMessage(String(chatId), this.helpText());
    return this.sendMessage(String(chatId), '🤖 Unknown command. Send /help for usage.');
  }

  private async handleStart(chatId: number, text: string) {
    const parts = text.split(/\s+/);
    const code = parts[1];
    if (code) {
      const claimed = this.consumeCode(code);
      if (claimed) {
        await this.prisma.telegramLink.upsert({
          where: { userId: claimed.userId },
          create: { userId: claimed.userId, chatId: String(chatId) },
          update: { chatId: String(chatId) },
        });
        await this.sendMessage(String(chatId), '✅ Linked to your JobHunter account! I\u2019ll send your job matches here.');
        this.logger.log(`[BOT] /start linked userId=${claimed.userId} chatId=${chatId}`);
        return;
      }
      await this.sendMessage(String(chatId), '⏳ That code is invalid or expired. Generate a new one from the web app.');
      return;
    }
    const link = await this.chatToUser(chatId);
    if (link) {
      await this.sendMessage(String(chatId), `👋 Welcome back! Your JobHunter account is linked.\n\n${this.helpText()}`);
    } else {
      await this.sendMessage(String(chatId), '👋 Hi! I\u2019m the JobHunter bot.\n\nTo link this chat to your account: open the web app → Settings → Telegram → "Open Telegram & Link", then come back and send /start <code>.');
    }
  }

  private async handleStatus(chatId: number, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMatches = await this.prisma.jobMatch.count({ where: { userId, createdAt: { gte: today } } });
    const saved = await this.prisma.savedJob.count({ where: { userId } });
    const apps = await this.prisma.application.count({ where: { userId } });
    return this.sendMessage(
      String(chatId),
      `📊 JobHunter status\n· Matches today: ${todayMatches}\n· Saved jobs: ${saved}\n· Applications: ${apps}\n\n/pause and /resume control notifications.`,
    );
  }

  private async handleSaved(chatId: number, userId: string) {
    const saved = await this.prisma.savedJob.findMany({
      where: { userId },
      include: { job: { select: { title: true, company: true, url: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (!saved.length) return this.sendMessage(String(chatId), 'You have no saved jobs yet.');
    const lines = saved.map((s, i) => `${i + 1}. ${s.job.title} — ${s.job.company}\n   ${s.job.url}`);
    return this.sendMessage(String(chatId), `🔖 Saved jobs (latest ${saved.length})\n\n${lines.join('\n')}`);
  }

  private async handlePause(chatId: number, userId: string, paused: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { notificationsPaused: paused } });
    return this.sendMessage(
      String(chatId),
      paused ? '⏸ Notifications paused. Send /resume to re-enable.' : '▶️ Notifications resumed.',
    );
  }

  private helpText(): string {
    return [
      '🤖 JobHunter commands:',
      '/start <code> — link this chat to your account',
      '/status — link status + today\u2019s counts',
      '/saved — your latest saved jobs',
      '/pause — pause notifications',
      '/resume — resume notifications',
      '/help — this message',
    ].join('\n');
  }

  /** FR-025a: inline keyboard callbacks — [Save] [Reject] [Apply] [Open]. */
  private async handleCallback(chatId: number, data: string, callbackId: string) {
    const [action, jobId] = data.split(':');
    if (!jobId) return this.answerCallback(callbackId, 'Invalid action');
    const link = await this.chatToUser(chatId);
    if (!link) return this.answerCallback(callbackId, 'Link your account first (see /help)');
    const userId = link.userId;

    if (action === 'open') {
      const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { url: true } });
      return this.answerCallback(callbackId, job ? `Opening: ${job.url}` : 'Job not found');
    }
    if (action === 'save') {
      await this.prisma.savedJob.upsert({
        where: { userId_jobId: { userId, jobId } },
        create: { userId, jobId },
        update: {},
      });
      await this.trackAction();
      return this.answerCallback(callbackId, 'Saved ✓');
    }
    if (action === 'reject') {
      await this.prisma.application.upsert({
        where: { userId_jobId: { userId, jobId } },
        create: { userId, jobId, stage: 'REJECTED', stageSince: new Date() },
        update: { stage: 'REJECTED', stageSince: new Date(), followUp: null },
      });
      await this.trackAction();
      return this.answerCallback(callbackId, 'Noted as rejected');
    }
    if (action === 'apply') {
      await this.prisma.application.upsert({
        where: { userId_jobId: { userId, jobId } },
        create: { userId, jobId, stage: 'APPLIED', stageSince: new Date(), followUp: new Date(Date.now() + 7 * 86_400_000) },
        update: { stage: 'APPLIED', stageSince: new Date(), followUp: new Date(Date.now() + 7 * 86_400_000) },
      });
      await this.trackAction();
      return this.answerCallback(callbackId, 'Application tracked — good luck!');
    }
    return this.answerCallback(callbackId, 'Unknown action');
  }

  /** FR-037a: button actions increment the funnel counter on the latest MatchCycle. */
  private async trackAction() {
    const latest = await this.prisma.matchCycle.findFirst({ orderBy: { startedAt: 'desc' } });
    if (latest) await this.prisma.matchCycle.update({ where: { id: latest.id }, data: { actionsTaken: { increment: 1 } } });
  }
}
