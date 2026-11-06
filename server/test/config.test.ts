import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('config', () => {
  const env = { STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_abc' };

  it('loads with defaults', () => {
    expect(loadConfig(env)).toMatchObject({ port: 3002, demoMode: false, appUrl: 'http://localhost:5174' });
  });

  it('refuses demo mode with a live key', () => {
    expect(() => loadConfig({ ...env, STRIPE_SECRET_KEY: 'sk_live_abc', DEMO_MODE: 'true' })).toThrow(/sandbox/);
  });

  it('rejects a publishable key in place of the secret key', () => {
    expect(() => loadConfig({ ...env, STRIPE_SECRET_KEY: 'pk_test_abc' })).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('sets Secure cookies on HTTPS', () => {
    expect(loadConfig({ ...env, APP_URL: 'https://billing.example.com/' })).toMatchObject({
      appUrl: 'https://billing.example.com',
      secureCookies: true,
    });
  });

  it('uses Render’s public URL when APP_URL is not set', () => {
    expect(loadConfig({ ...env, RENDER_EXTERNAL_URL: 'https://billing-demo.onrender.com' })).toMatchObject({
      appUrl: 'https://billing-demo.onrender.com',
      secureCookies: true,
    });
  });

  it('starts without a webhook secret, so a new deployment can boot before its endpoint exists', () => {
    expect(loadConfig({ STRIPE_SECRET_KEY: 'sk_test_abc' }).stripeWebhookSecret).toBeNull();
    expect(() => loadConfig({ ...env, STRIPE_WEBHOOK_SECRET: 'not-a-secret' })).toThrow(/whsec_/);
  });
});
