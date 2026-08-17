import type { Env } from '@extrawork/config';
import {
  DisabledPaymentGateway,
  UnavailableESignGateway,
  type ESignGateway,
  type MessageGateway,
  type OtpGateway,
  type PaymentGateway,
} from './gateways.js';
import {
  ConsoleEmailDriver,
  EmailGateway,
  FileEmailDriver,
  SmtpEmailDriver,
  type EmailDriver,
} from './messaging/email.js';
import { NativeShareWhatsAppGateway, WhatsAppCloudGateway } from './messaging/whatsapp.js';
import { SimulatorWhatsAppGateway } from './messaging/whatsapp-simulator.js';
import { ConsoleOtpGateway, UnavailableOtpGateway } from './otp.js';
import { RazorpayGateway } from './payments/razorpay.js';

export * from './gateways.js';
export * from './webhooks/signature.js';
export * from './messaging/whatsapp.js';
export * from './messaging/whatsapp-simulator.js';
export * from './messaging/email.js';
export * from './otp.js';
export * from './payments/razorpay.js';

/**
 * The provider set for one process. Report §10.1: providers are replaceable
 * services behind adapters, so this is the only place a driver is chosen.
 */
export interface Integrations {
  whatsapp: MessageGateway;
  email: MessageGateway;
  otp: OtpGateway;
  payments: PaymentGateway;
  esign: ESignGateway;
}

export function createEmailDriver(env: Env): EmailDriver {
  switch (env.EMAIL_DRIVER) {
    case 'smtp':
      if (!env.SMTP_URL) {
        throw new Error('EMAIL_DRIVER=smtp requires SMTP_URL');
      }
      return new SmtpEmailDriver(env.SMTP_URL);
    case 'file':
      return new FileEmailDriver(env.EMAIL_OUTBOX_DIR);
    default:
      return new ConsoleEmailDriver();
  }
}

export function createIntegrations(
  env: Env,
  hooks: { onOtpCode?: (phoneE164: string, code: string) => void } = {},
): Integrations {
  const whatsapp =
    env.WHATSAPP_DRIVER === 'simulator'
      ? new SimulatorWhatsAppGateway({ outboxDir: env.WHATSAPP_SIMULATOR_DIR })
      : env.WHATSAPP_DRIVER === 'cloud-api' &&
          env.WHATSAPP_PHONE_NUMBER_ID &&
          env.WHATSAPP_ACCESS_TOKEN &&
          env.WHATSAPP_APP_SECRET
        ? new WhatsAppCloudGateway({
            phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
            accessToken: env.WHATSAPP_ACCESS_TOKEN,
            appSecret: env.WHATSAPP_APP_SECRET,
          })
        : new NativeShareWhatsAppGateway();

  const email = new EmailGateway(createEmailDriver(env), env.EMAIL_FROM);

  const otp =
    env.OTP_DRIVER === 'console'
      ? new ConsoleOtpGateway(hooks.onOtpCode)
      : new UnavailableOtpGateway();

  const payments =
    env.PAYMENTS_DRIVER === 'razorpay' &&
    env.RAZORPAY_KEY_ID &&
    env.RAZORPAY_KEY_SECRET &&
    env.RAZORPAY_WEBHOOK_SECRET
      ? new RazorpayGateway({
          keyId: env.RAZORPAY_KEY_ID,
          keySecret: env.RAZORPAY_KEY_SECRET,
          webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
        })
      : new DisabledPaymentGateway();

  return { whatsapp, email, otp, payments, esign: new UnavailableESignGateway() };
}
