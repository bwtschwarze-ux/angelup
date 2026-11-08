// Edge Function: aal
// Nimmt die Anmeldung zum Aalkurs AAL TOTAL entgegen, schreibt sie in
// public.aal_anmeldung und schickt sofort eine Bestaetigung an den Teilnehmer
// mit Blindkopie an Mark (Secret MAIL_KOPIE).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const ERLAUBTE_HERKUNFT = ['https://angelup.de', 'https://www.angelup.de'];

function corsKopf(req: Request): Record<string, string> {
  const herkunft = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin':
      ERLAUBTE_HERKUNFT.includes(herkunft) ? herkunft : ERLAUBTE_HERKUNFT[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(req: Request, daten: unknown, status = 200) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { ...corsKopf(req), 'Content-Type': 'application/json' },
  });
}

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const kurz = (w: unknown, max = 120) => String(w ?? '').trim().slice(0, max);
const euro = (cent: number) =>
  (cent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €';
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const VARIANTEN: Record<string, { art: string; titel: string; preis: number; versand: boolean }> = {
  tiktok_kurs: { art: 'TikTok Live', titel: 'Nur Kurs', preis: 1900, versand: false },
  tiktok_paket: { art: 'TikTok Live', titel: 'Aal-Paket', preis: 3400, versand: true },
  vorort_kurs: { art: 'Vor Ort in Aurich', titel: 'Kursabend', preis: 2900, versand: false },
  vorort_paket: { art: 'Vor Ort in Aurich', titel: 'Kursabend + Aal-Paket', preis: 3900, versand: false },
};

const PRAEFIX = 'AAL-2608';
const RATE_LIMIT = 3;
const RATE_FENSTER_MS = 24 * 60 * 60 * 1000;

// denomailer bricht den Kopfblock bei Nicht-ASCII im Betreff ab
function asciiBetreff(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[–—]/g, '-').replace(/·/g, '-')
    .replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'")
    .replace(/€/g, 'EUR')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

async function mailSenden(an: string, betreff: string, text: string, html: string) {
  const host = Deno.env.get('SMTP_HOST');
  const user = Deno.env.get('SMTP_USER');
  const pass = Deno.env.get('SMTP_PASS');
  const from = Deno.env.get('SMTP_FROM');
  if (!host || !user || !pass || !from) throw new Error('SMTP nicht konfiguriert');
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465');
  const client = new SMTPClient({
    connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } },
  });
  const kopie = Deno.env.get('MAIL_KOPIE');
  try {
    await client.send({
      from: `${Deno.env.get('SMTP_FROM_NAME') ?? 'AngelUp'} <${from}>`,
      to: an,
      bcc: kopie ? [kopie] : undefined,
      subject: asciiBetreff(betreff),
      content: text,
      html,
    });
  } finally {
    await client.close();
  }
}

async function freieReferenz(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = String(1000 + Math.floor(Math.random() * 9000));
    const ref = `${PRAEFIX}-${n}`;
    const { data } = await db.from('aal_anmeldung').select('id').eq('referenz', ref).limit(1);
    if (!data || !data.length) return ref;
  }
  return `${PRAEFIX}-${String(Date.now()).slice(-4)}`;
}

function textMail(d: Record<string, string>): string {
  const z = [
    `Hallo ${d.name},`,
    '',
    'danke fuer deine Anmeldung zu AAL TOTAL am Freitag, 14.08.2026 ab 19:00 Uhr.',
    '',
    `Deine Referenz: ${d.referenz}`,
    `Gebucht: ${d.variante}`,
    `Betrag: ${d.betrag}`,
    '',
    'Bitte ueberweise den Betrag mit der Referenz als Verwendungszweck:',
    'Empfaenger: Mark Schwarze',
    'IBAN: DE66 5001 0517 6000 3634 26',
    'BIC: INGDDEFFXXX (ING)',
    `Verwendungszweck: ${d.referenz}`,
    '',
    d.hinweis,
    '',
    'Bis dahin, Petri!',
    'Mark Schwarze - Zur Kiepe',
    'Alter Postweg 80, 26607 Aurich',
  ];
  return z.join('\n');
}

function htmlMail(d: Record<string, string>): string {
  const zeile = (k: string, w: string) =>
    `<tr><td style="padding:6px 0;color:#5b6b7a;font-size:14px">${esc(k)}</td>` +
    `<td style="padding:6px 0;text-align:right;font-weight:600;color:#12212e;font-size:14px">${esc(w)}</td></tr>`;
  return `<!doctype html><html lang="de"><body style="margin:0;padding:24px 12px;background:#eef3f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto">
  <div style="background:#12212e;border-radius:12px 12px 0 0;padding:22px 24px">
    <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.3px">AAL TOTAL</div>
    <div style="color:#8fd0ff;font-size:14px;margin-top:4px">Freitag, 14.08.2026 &middot; ab 19:00 Uhr</div>
  </div>
  <div style="background:#fff;border-radius:0 0 12px 12px;padding:24px">
    <p style="margin:0 0 14px;color:#12212e;font-size:15px">Hallo ${esc(d.name)},</p>
    <p style="margin:0 0 18px;color:#3b4a58;font-size:15px;line-height:1.55">danke f&uuml;r deine Anmeldung. Hier sind deine Daten auf einen Blick.</p>
    <table style="width:100%;border-collapse:collapse;background:#f6f9fb;border-radius:12px;padding:8px">
      <tr><td colspan="2" style="height:8px"></td></tr>
      ${zeile('Referenz', d.referenz)}
      ${zeile('Gebucht', d.variante)}
      ${zeile('Betrag', d.betrag)}
      <tr><td colspan="2" style="height:8px"></td></tr>
    </table>
    <p style="margin:20px 0 8px;color:#12212e;font-size:15px;font-weight:600">Bezahlung per &Uuml;berweisung</p>
    <table style="width:100%;border-collapse:collapse">
      ${zeile('Empf&auml;nger', 'Mark Schwarze')}
      ${zeile('IBAN', 'DE66 5001 0517 6000 3634 26')}
      ${zeile('BIC', 'INGDDEFFXXX (ING)')}
      ${zeile('Verwendungszweck', d.referenz)}
    </table>
    <p style="margin:20px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">${esc(d.hinweis)}</p>
    <p style="margin:22px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">Bis dahin, Petri!<br><b style="color:#12212e">Mark Schwarze</b><br>Zur Kiepe &middot; Alter Postweg 80 &middot; 26607 Aurich</p>
  </div>
  <p style="margin:14px 0 0;text-align:center;color:#7d8b98;font-size:12px">angelup.de</p>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsKopf(req) });
  if (req.method !== 'POST') return json(req, { fehler: 'methode' }, 405);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json(req, { fehler: 'ungueltig' }, 400);
  }

  // Honeypot
  if (kurz(b.website)) return json(req, { ok: true, referenz: `${PRAEFIX}-0000` });

  const v = VARIANTEN[kurz(b.variante, 40)];
  if (!v) return json(req, { fehler: 'variante' }, 400);

  const name = kurz(b.name, 80);
  const email = kurz(b.email, 120).toLowerCase();
  if (name.length < 2) return json(req, { fehler: 'name' }, 400);
  if (!MAIL_RE.test(email)) return json(req, { fehler: 'email' }, 400);
  if (b.datenschutz_ok !== true) return json(req, { fehler: 'datenschutz' }, 400);

  const strasse = v.versand ? kurz(b.strasse, 120) : null;
  const plz = v.versand ? kurz(b.plz, 10) : null;
  const wohnort = v.versand ? kurz(b.wohnort, 80) : null;
  if (v.versand && (!strasse || !plz || !wohnort)) return json(req, { fehler: 'anschrift' }, 400);

  // Rate-Limit: hoechstens 3 Anmeldungen je Mailadresse in 24 Stunden
  const seit = new Date(Date.now() - RATE_FENSTER_MS).toISOString();
  const { count } = await db
    .from('aal_anmeldung')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('angelegt_am', seit);
  if ((count ?? 0) >= RATE_LIMIT) return json(req, { fehler: 'zu_viele' }, 429);

  const referenz = await freieReferenz();

  const satz = {
    referenz,
    variante: kurz(b.variante, 40),
    betrag_cent: v.preis,
    name,
    email,
    telefon: kurz(b.telefon, 40) || null,
    tiktok_name: kurz(b.tiktok_name, 60) || null,
    strasse,
    plz,
    wohnort,
    bemerkung: kurz(b.bemerkung, 500) || null,
    datenschutz_ok: true,
  };

  const { error } = await db.from('aal_anmeldung').insert(satz);
  if (error) {
    if (error.code === '23505') return json(req, { fehler: 'doppelt' }, 409);
    return json(req, { fehler: 'speichern', detail: error.message }, 500);
  }

  const hinweis = v.art.startsWith('Vor Ort')
    ? 'Du kommst am 14.08. zu uns: Zur Kiepe, Alter Postweg 80, 26607 Aurich. Los geht es um 19:00 Uhr, sei ein paar Minuten vorher da.'
    : 'Den Link zum TikTok Live und alle Infos schicken wir dir vor dem Kurs per E-Mail. Aufzeichnung und Skript kommen im Anschluss.';

  const d = {
    name,
    referenz,
    variante: `${v.art} - ${v.titel}`,
    betrag: euro(v.preis),
    hinweis,
  };

  let mailOk = true;
  let mailFehler = '';
  try {
    await mailSenden(
      email,
      `Anmeldung AAL TOTAL - ${referenz}`,
      textMail(d),
      htmlMail(d),
    );
  } catch (e) {
    mailOk = false;
    mailFehler = String(e);
    // Notfall: Mark bekommt die Anmeldung trotzdem, sofern die Kopie geht
    const kopie = Deno.env.get('MAIL_KOPIE');
    if (kopie) {
      try {
        await mailSenden(
          kopie,
          `Aalkurs-Anmeldung ${referenz} (Teilnehmermail fehlgeschlagen)`,
          textMail(d) + `\n\nMailfehler an ${email}: ${mailFehler}`,
          htmlMail(d),
        );
      } catch { /* still */ }
    }
  }

  return json(req, { ok: true, referenz, mail: mailOk });
});
