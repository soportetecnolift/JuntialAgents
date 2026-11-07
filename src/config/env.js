import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_API_URL: z.string().url(),
  // Dirección con la que el PANEL habla con esta API (p. ej. http://localhost:4000 mientras PUBLIC_API_URL es un túnel).
  // El login termina ahí para que la cookie de sesión quede en el mismo sitio que el panel. Vacío = PUBLIC_API_URL.
  AUTH_API_URL: z.string().url().optional(),
  WEB_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(40),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  SESSION_DAYS: z.coerce.number().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('JuntialAgents <no-reply@localhost>'),
  PLATFORM_OPENAI_KEY: z.string().optional(),
  DEFAULT_CLAUDE_MODEL: z.string().default('claude-sonnet-5-5'),
  DEFAULT_OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  TRANSCRIBE_MODEL: z.string().default('gpt-4o-mini-transcribe'),
  WORKER_CONCURRENCY: z.coerce.number().default(50),
  LOG_LEVEL: z.string().default('info'),
  SUPERADMIN_EMAIL: z.string().email().optional(),
  STAFF_MFA_REQUIRED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Juntial Center: identidad (SSO) y administración de la organización
  CENTER_URL: z.string().url(),                // URL de center-bk (p. ej. http://localhost:4100)
  CENTER_WEB_URL: z.string().url(),            // URL de center-front (enlaces «Juntial Center» del panel)
  CENTER_APP_ID: z.string().default('juntialagents'),
  CENTER_APP_SECRET: z.string().min(16),       // el mismo que figura para juntialagents en CENTER_APPS de Center
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
