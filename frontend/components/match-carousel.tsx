'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { ScoreBadge, fmtDate } from '@/lib/ui';

export interface CarouselMatch {
  jobId: string;
  score: number;
  matchedSkills: string[];
  job: { title: string; company: string; location: string; postedDate: string };
}

export function MatchCarousel({ matches }: { matches: CarouselMatch[] }) {
  const ref = useRef<HTMLDivElement>(null);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * 300, behavior: 'smooth' });
  };

  if (!matches.length) return null;

  return (
    <section aria-label="Top matches" className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="mb-0">Top matches</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label="Scroll left" onClick={() => scroll(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Scroll right" onClick={() => scroll(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        ref={ref}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {matches.map((m) => (
          <Link
            key={m.jobId}
            href={`/jobs/${m.jobId}`}
            className="group min-w-[260px] max-w-[260px] snap-start no-underline"
          >
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardContent className="flex h-full flex-col p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="text-sm font-bold leading-tight text-foreground">{m.job.title}</div>
                  <ScoreBadge score={m.score} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.job.company} · {m.job.location}
                  <div className="mt-0.5">posted {fmtDate(m.job.postedDate)}</div>
                </div>
                {m.matchedSkills.length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-1 pt-3">
                    {m.matchedSkills.slice(0, 3).map((s) => (
                      <span key={s} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        {s}
                      </span>
                    ))}
                    {m.matchedSkills.length > 3 && (
                      <span className="text-[11px] text-muted-foreground">+{m.matchedSkills.length - 3}</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function CarouselSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading top matches" className="mb-6">
      <div className="mb-2 h-5 w-32 animate-pulse rounded bg-muted" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="min-w-[260px] rounded-lg border border-border bg-card p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}
