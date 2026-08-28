import Link from 'next/link';

export default function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-6xl font-extrabold">403</h1>
      <p className="mt-2 text-lg font-semibold">Access restricted</p>
      <p className="muted mt-2 max-w-md text-sm">
        Source management and admin features are restricted to ADMIN accounts.
      </p>
      <Link href="/" className="btn mt-8">
        Back to Dashboard
      </Link>
    </div>
  );
}
