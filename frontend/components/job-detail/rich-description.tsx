'use client';

import { useMemo } from 'react';
import { sanitiseHtml, plainToHtml } from './utils';

/** Renders a job description as sanitized HTML (supports both HTML and plain-text input). */
export function RichDescription({ text }: { text: string }) {
  const html = useMemo(() => {
    const isHtml = /<[a-z][\s\S]*>/i.test(text);
    return isHtml ? sanitiseHtml(text) : plainToHtml(text);
  }, [text]);

  return (
    <div
      className="prose"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
