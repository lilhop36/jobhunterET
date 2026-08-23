/**
 * Telegram channel definitions for the collection pipeline.
 * Each entry maps a source ID (stored in JobSource table) to a
 * t.me/s/{channel} username.
 */

export interface TelegramChannelConfig {
  sourceId: string;
  name: string;
  channelUsername: string;
}

export const TELEGRAM_CHANNELS: TelegramChannelConfig[] = [
  {
    sourceId: 'tg-elelanajobs',
    name: 'ElelanaJobs (Telegram)',
    channelUsername: 'Elelanajobs',
  },
  {
    sourceId: 'tg-shegarjob',
    name: 'ShegerJobs (Telegram)',
    channelUsername: 'shegarjob',
  },
  {
    sourceId: 'tg-ethiojobvacancy1',
    name: 'EthioJobVacancy (Telegram)',
    channelUsername: 'ethiojobvacancy1',
  },
];
