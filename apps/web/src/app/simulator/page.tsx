import { SimulatorConsole } from './simulator-console';

/**
 * The WhatsApp simulator — a development surface, not part of the product.
 *
 * It exists so the whole flow can be walked end to end before a Meta Business
 * Account exists: type what an employee would send, read what they would get
 * back, and open the link the homeowner would receive. The API refuses to expose
 * the endpoints behind it unless `WHATSAPP_DRIVER=simulator` and the
 * environment is not production, so this page is inert anywhere real.
 */
export const dynamic = 'force-dynamic';

export default function SimulatorPage() {
  return (
    <main className="page page-wide">
      <h1 style={{ marginBottom: 'var(--space-2)' }}>WhatsApp simulator</h1>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        Send a message the way someone on site or a homeowner would — text, a photo, or a one-word
        command — and see exactly what comes back. Nothing leaves this machine.
      </p>
      <SimulatorConsole />
    </main>
  );
}
