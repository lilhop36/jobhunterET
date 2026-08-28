'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ErrorContent() {
  const params = useSearchParams();
  const code = params.get('code') || '500';
  const message = params.get('message') || 'Something went wrong.';

  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-6xl font-extrabold">{code}</h1>
      <p className="mt-2 text-lg font-semibold">Error</p>
      <p className="muted mt-2 max-w-md text-sm">{message}</p>
      <Link href="/" className="btn mt-8">
        Back to Dashboard
      </Link>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<p className="muted text-center py-24">Loading…</p>}>
      <ErrorContent />
    </Suspense>
  );
}
