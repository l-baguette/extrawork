import { RegisterForm } from './register-form';

/** Public sign-up. */
export const dynamic = 'force-dynamic';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="page">
      <RegisterForm next={typeof next === 'string' ? next : null} />
    </main>
  );
}
