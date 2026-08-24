import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface MatchEvent {
  type: 'match';
  jobId: string;
  score: number;
  title: string;
  company: string;
  summary: string;
  createdAt: string;
}

export interface ApplicationEvent {
  type: 'application';
  jobId: string;
  title: string;
  company: string;
  from: string;
  to: string;
  createdAt: string;
}

export interface DigestEvent {
  type: 'digest';
  digestId: string;
  jobsCollected: number;
  newJobs: number;
  strongMatches: number;
  createdAt: string;
}

export interface CollectionEvent {
  type: 'collection';
  sourceId: string;
  sourceName: string;
  status: string;
  jobsFetched: number;
  jobsCreated: number;
  duplicates: number;
  duration: number;
  createdAt: string;
}

export type SseEvent = MatchEvent | ApplicationEvent | DigestEvent | CollectionEvent;

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  /** Per-user subjects — created on SSE connect, cleaned up on disconnect. */
  private readonly clients = new Map<string, Subject<SseEvent>>();

  /**
   * Register a new SSE listener. Returns the Observable the controller
   * wraps in a MessageEvent stream, plus a teardown function.
   */
  subscribe(userId: string): { stream$: Observable<SseEvent>; close: () => void } {
    let subject = this.clients.get(userId);
    if (!subject) {
      subject = new Subject<SseEvent>();
      this.clients.set(userId, subject);
      this.logger.debug(`SSE client added for user ${userId} (total: ${this.clients.size})`);
    }

    const close = () => {
      subject!.complete();
      this.clients.delete(userId);
      this.logger.debug(`SSE client removed for user ${userId} (total: ${this.clients.size})`);
    };

    return { stream$: subject.asObservable(), close };
  }

  /** Push an event to a specific user's SSE stream (no-op if not connected). */
  pushToUser(userId: string, event: SseEvent) {
    const subject = this.clients.get(userId);
    if (subject) {
      subject.next(event);
      this.logger.debug(`SSE event pushed to user ${userId}: ${event.type}`);
    }
  }

  /** Number of active SSE connections (useful for health/debug endpoints). */
  get connectionCount(): number {
    return this.clients.size;
  }
}
