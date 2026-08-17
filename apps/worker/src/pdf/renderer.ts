import { chromium, type Browser } from 'playwright';
import { METRIC, metrics, type Logger } from '@extrawork/observability';

/**
 * PDF rendering — report §8.5 and §14.1: "Versioned HTML/CSS plus Playwright
 * Chromium... Store template version, renderer version, generated file hash,
 * storage object version, and generation time."
 *
 * One browser is reused across jobs (launching Chromium per PDF is the single
 * most expensive thing this worker could do) and is relaunched if it dies.
 * Each render gets its own context and page so one bad job cannot poison the
 * next.
 */

export interface PdfRenderer {
  render(html: string, options?: { timeoutMs?: number }): Promise<Buffer>;
  rendererVersion(): Promise<string>;
  close(): Promise<void>;
}

export class ChromiumPdfRenderer implements PdfRenderer {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private version: string | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly defaultTimeoutMs: number,
  ) {}

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.launching ??= chromium
      .launch({
        args: [
          // The renderer only ever loads self-contained HTML that this process
          // generated; no network, no external fonts.
          '--disable-dev-shm-usage',
          '--no-sandbox',
        ],
      })
      .then((browser) => {
        this.browser = browser;
        this.launching = null;
        browser.on('disconnected', () => {
          this.browser = null;
        });
        return browser;
      })
      .catch((error: unknown) => {
        this.launching = null;
        throw error;
      });
    return this.launching;
  }

  async rendererVersion(): Promise<string> {
    if (this.version) return this.version;
    const browser = await this.ensureBrowser();
    this.version = `chromium/${browser.version()}`;
    return this.version;
  }

  async render(html: string, options: { timeoutMs?: number } = {}): Promise<Buffer> {
    const timeout = options.timeoutMs ?? this.defaultTimeoutMs;
    const started = Date.now();
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      // A fixed viewport and scale keep rendering deterministic enough for the
      // golden text-extraction tests.
      viewport: { width: 1240, height: 1754 },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    });

    try {
      const page = await context.newPage();
      // Block every external request. The template is fully inlined, so any
      // outbound fetch would be a template bug, not a legitimate resource.
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
        return route.abort();
      });
      await page.setContent(html, { waitUntil: 'load', timeout });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: false,
      });
      metrics.observe(METRIC.PDF_DURATION, 'PDF generation duration', Date.now() - started);
      return Buffer.from(pdf);
    } catch (error) {
      metrics.counter(METRIC.PDF_FAILURES, 'PDF generation failures');
      this.logger.error({ err: error }, 'pdf render failed');
      throw error;
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}

/**
 * Used when Chromium is unavailable (a slim container, or a CI job that only
 * exercises non-PDF paths). It fails the job rather than producing a fake
 * document: report §13.1 requires the receipt to show "PDF pending" and the
 * worker to retry, never to present a placeholder as evidence.
 */
export class UnavailablePdfRenderer implements PdfRenderer {
  async render(): Promise<Buffer> {
    throw new Error(
      'PDF rendering is not available in this deployment: Chromium is not installed. ' +
        'Run `pnpm exec playwright install chromium`.',
    );
  }
  async rendererVersion(): Promise<string> {
    return 'unavailable';
  }
  async close(): Promise<void> {
    /* nothing to release */
  }
}
