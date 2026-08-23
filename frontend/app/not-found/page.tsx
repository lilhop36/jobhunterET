import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-4xl" aria-hidden="true">
        🔍
      </div>
      <h1 className="mt-6 text-3xl font-extrabold">404</h1>
      <p className="mt-2 text-lg font-semibold">Page not found</p>
      <p className="muted mt-2 max-w-md text-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/" className="btn mt-8">
        Back to Dashboard
      </Link>
    </div>
  );
}
