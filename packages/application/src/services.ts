import type { AppContext } from './context.js';
import { DecisionService } from './approvals/decide.js';
import { OtpService } from './approvals/otp.js';
import { PublicApprovalService } from './approvals/public-view.js';
import { ChangeOrderService } from './change-orders/service.js';
import { EmployeeService } from './employees/service.js';
import { SendService } from './change-orders/send.js';
import { FileService } from './files/service.js';
import { IntakeService } from './intake/intake-service.js';
import { GoogleOAuthProvider } from './identity/google-oauth.js';
import { AuthService, type AuthProvider } from './identity/auth-service.js';
import { LocalMagicLinkProvider, ManagedJwtProvider } from './identity/providers.js';
import { ProjectService } from './projects/service.js';

/** The use-case surface the API and worker consume. */
export interface Services {
  auth: AuthService;
  projects: ProjectService;
  changeOrders: ChangeOrderService;
  send: SendService;
  publicApproval: PublicApprovalService;
  decisions: DecisionService;
  otp: OtpService;
  files: FileService;
  employees: EmployeeService;
  intake: IntakeService;
  /** Null when GOOGLE_CLIENT_ID/SECRET are not configured. */
  google: GoogleOAuthProvider | null;
}

export function createAuthProvider(app: AppContext): AuthProvider {
  if (app.env.AUTH_DRIVER === 'supabase' || app.env.AUTH_DRIVER === 'clerk') {
    if (!app.env.AUTH_JWKS_URL || !app.env.AUTH_JWT_ISSUER) {
      throw new Error(
        `AUTH_DRIVER=${app.env.AUTH_DRIVER} requires AUTH_JWKS_URL and AUTH_JWT_ISSUER`,
      );
    }
    return new ManagedJwtProvider({
      jwksUrl: app.env.AUTH_JWKS_URL,
      issuer: app.env.AUTH_JWT_ISSUER,
      ...(app.env.AUTH_JWT_AUDIENCE ? { audience: app.env.AUTH_JWT_AUDIENCE } : {}),
      providerName: app.env.AUTH_DRIVER,
    });
  }
  return new LocalMagicLinkProvider({
    uow: app.uow,
    repos: app.repos,
    ttlMinutes: app.env.MAGIC_LINK_TTL_MINUTES,
  });
}

export function createServices(app: AppContext): Services {
  const changeOrders = new ChangeOrderService(app);
  const send = new SendService(app);
  return {
    auth: new AuthService(app, createAuthProvider(app)),
    projects: new ProjectService(app),
    changeOrders,
    send,
    publicApproval: new PublicApprovalService(app),
    decisions: new DecisionService(app),
    otp: new OtpService(app),
    files: new FileService(app),
    employees: new EmployeeService(app),
    intake: new IntakeService(app, changeOrders, send),
    google:
      app.env.GOOGLE_CLIENT_ID && app.env.GOOGLE_CLIENT_SECRET
        ? new GoogleOAuthProvider({
            clientId: app.env.GOOGLE_CLIENT_ID,
            clientSecret: app.env.GOOGLE_CLIENT_SECRET,
            redirectUri: `${app.env.API_PUBLIC_URL.replace(/\/+$/, '')}/v1/auth/google/callback`,
          })
        : null,
  };
}
