/**
 * Telegram Channel adapter — scrapes public Telegram channels via t.me/s/ previews.
 *
 * Telegram channels with public web previews (t.me/s/{channel}) serve an HTML
 * page listing recent posts. We parse the HTML to extract job postings.
 *
 * Each post typically contains:
 * - Job title (first line or bold text)
 * - Company name (often in #hashtag or bold)
 * - Education/experience requirements
 * - Deadline
 * - Application link (email, URL, or form)
 *
 * FR-008: adapter architecture — plugs into the pipeline without modification.
 */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface TelegramPost {
  id: string;
  text: string;
  date: string;
  views: number;
}

@Injectable()
export class TelegramChannelAdapter implements JobSourceAdapter {
  readonly sourceId: string;
  private readonly channelUsername: string;

  constructor(sourceId: string, channelUsername: string) {
    this.sourceId = sourceId;
    this.channelUsername = channelUsername;
  }

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 7 * 86_400_000);
    const posts = await this.fetchPosts();
    const jobs: RawJob[] = [];

    for (const post of posts) {
      const job = this.parsePost(post);
      if (job && job.postedDate >= since) {
        jobs.push(job);
      }
    }

    return jobs;
  }

  private async fetchPosts(): Promise<TelegramPost[]> {
    const url = `https://t.me/s/${this.channelUsername}`;
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'accept': 'text/html',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`Telegram channel responded ${res.status}`);

    const html = await res.text();
    return this.parseHtml(html);
  }

  private parseHtml(html: string): TelegramPost[] {
    const posts: TelegramPost[] = [];

    // Each post is in a div with class "tgme_widget_message_wrap"
    // or in a div with data-post="channel/id"
    const postRegex = /data-post="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;

    let match: RegExpExecArray | null;
    while ((match = postRegex.exec(html))) {
      const postId = match[1];
      const content = match[2];

      // Extract date from datetime attribute
      const dateMatch = html.slice(match.index).match(/datetime="([^"]+)"/);
      const date = dateMatch ? dateMatch[1] : new Date().toISOString();

      // Extract views
      const viewsMatch = html.slice(match.index).match(/(\d[\d,]*)\s*views/);
      const views = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, ''), 10) : 0;

      posts.push({
        id: postId,
        text: this.stripHtml(content),
        date,
        views,
      });
    }

    return posts;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parsePost(post: TelegramPost): RawJob | null {
    const text = post.text;

    // Skip posts that are too short or look like non-job content
    if (text.length < 50) return null;
    if (!/(?:job|position|vacancy|required|qualification|degree|experience|deadline|apply|submit)/i.test(text)) {
      return null;
    }

    // Extract job title (first meaningful line)
    const title = this.extractTitle(text);
    if (!title) return null;

    // Extract company (often in #hashtag or after "at" / "Company:" patterns)
    const company = this.extractCompany(text);

    // Extract deadline
    const deadline = this.extractDeadline(text);

    // Extract apply link (URL or email)
    const { applyUrl, applyEmail } = this.extractApplyInfo(text);

    // Use the Telegram post URL as the canonical URL
    const postUrl = `https://t.me/${this.channelUsername}/${post.id.replace(`${this.channelUsername}/`, '')}`;

    // Build a URL from the apply info or fall back to the post URL
    const url = applyUrl || postUrl;

    // Extract education/requirements for description
    const description = this.extractDescription(text);

    return {
      title,
      company,
      location: 'Addis Ababa, Ethiopia',
      locationClass: 'ETHIOPIA_LOCAL',
      employmentType: 'FULL_TIME',
      experienceLevel: deriveExperience(title),
      workPlace: 'ONSITE',
      skills: [],
      url,
      sourceJobId: `${this.channelUsername}:${post.id}`,
      postedDate: new Date(post.date),
      deadline: deadline ?? undefined,
      description,
      country: 'Ethiopia',
      parseConfidence: 65, // Lower confidence since we're parsing unstructured Telegram posts
      rawData: { channel: this.channelUsername, postId: post.id, views: post.views },
    };
  }

  private extractTitle(text: string): string | null {
    // Look for common job title patterns
    const patterns = [
      /(?:position|job title|vacancy)[:::]\s*(.+)/i,
      /^([A-Z][^.!?\n]{10,80})/, // First capitalized line
      /(?:🔹|▪️|✅|💎|🎨|📋)\s*(.+)/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        let title = match[1].trim();
        // Clean up common prefixes/suffixes
        title = title.replace(/^(?:at|@|for)\s+/i, '');
        title = title.replace(/\s*[-–]\s*(?:deadline|how to apply).*$/i, '');
        if (title.length >= 5 && title.length <= 120) {
          return title;
        }
      }
    }

    // Fallback: first line that looks like a job title
    const lines = text.split(/[.\n]/);
    for (const line of lines) {
      const cleaned = line.trim();
      if (cleaned.length >= 10 && cleaned.length <= 100 && /^[A-Z]/.test(cleaned)) {
        return cleaned;
      }
    }

    return null;
  }

  private extractCompany(text: string): string {
    // Look for company patterns
    const patterns = [
      /(?:company|organization|employer)[:::]\s*(.+)/i,
      /(?:at|@)\s+([A-Z][A-Za-z\s&]+(?:PLC|Ltd|Inc|Corp|SC|S\.C\.|Company|Organization))/,
      /#([A-Za-z_]+(?:PLC|Ltd|Inc|Corp|SC|Company))/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim().slice(0, 100);
      }
    }

    return 'Unknown';
  }

  private extractDeadline(text: string): Date | null {
    const patterns = [
      /deadline[:::]\s*(\d{1,2}[-/.]\w+[-/.]\d{2,4})/i,
      /deadline[:::]\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
      /deadline[:::]\s*(\d{1,2}\s+\w+\s+\d{4})/i,
      /by\s+(\d{1,2}[-/.]\w+[-/.]\d{2,4})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const d = new Date(match[1]);
        if (!isNaN(d.getTime())) return d;
      }
    }

    return null;
  }

  private extractApplyInfo(text: string): { applyUrl?: string; applyEmail?: string } {
    // Extract email
    const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (emailMatch) {
      return { applyEmail: emailMatch[0] };
    }

    // Extract URL
    const urlMatch = text.match(/https?:\/\/[^\s<>"]+/);
    if (urlMatch) {
      return { applyUrl: urlMatch[0] };
    }

    return {};
  }

  private extractDescription(text: string): string {
    // Return the full post text as description
    return text.slice(0, 2000);
  }
}
