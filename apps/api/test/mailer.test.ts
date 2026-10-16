import { afterEach, describe, expect, it, vi } from 'vitest';
import { brevoMailer, parseFrom, resendMailer } from '../src/lib/mailer.js';

const mail = { to: 'lea@exemple.test', subject: 'Sujet', text: 'Texte', html: '<p>Texte</p>' };

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(status = 200, body = '{}') {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  });
  return calls;
}

describe('envoi des courriels par API', () => {
  it('adresse d’expédition : nom et courriel', () => {
    expect(parseFrom('Journal de bord <no-reply@exemple.ca>')).toEqual({ name: 'Journal de bord', email: 'no-reply@exemple.ca' });
    expect(parseFrom('no-reply@exemple.ca')).toEqual({ email: 'no-reply@exemple.ca' });
  });

  it('Resend : clé dans l’en-tête, destinataire et contenu', async () => {
    const calls = stubFetch();
    await resendMailer('re_test_123456', 'Journal <no-reply@exemple.ca>').send(mail);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_test_123456');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: 'Journal <no-reply@exemple.ca>', to: ['lea@exemple.test'], subject: 'Sujet', text: 'Texte', html: '<p>Texte</p>',
    });
  });

  it('Brevo : expéditeur séparé, contenu texte et HTML', async () => {
    const calls = stubFetch(201);
    await brevoMailer('xkeysib-test', 'Journal <no-reply@exemple.ca>').send(mail);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]!.init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      sender: { name: 'Journal', email: 'no-reply@exemple.ca' }, to: [{ email: 'lea@exemple.test' }],
      textContent: 'Texte', htmlContent: '<p>Texte</p>',
    });
  });

  it('refus du fournisseur : erreur avec le code', async () => {
    stubFetch(403, '{"message":"domain not verified"}');
    await expect(resendMailer('re_test_123456', 'x@y.z').send(mail)).rejects.toThrow(/403.*domain not verified/);
  });
});
