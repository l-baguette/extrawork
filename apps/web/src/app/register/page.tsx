import { RegisterForm } from './register-form';

/** Public sign-up. */
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return (
    <main className="page">
      <RegisterForm />
    </main>
  );
}
