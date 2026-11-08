// Edge Function: widerruf
// Elektronische Widerrufsfunktion ("Vertrag widerrufen", § 356a BGB, gilt seit 19.06.2026).
// Nimmt den Widerruf von widerruf.html entgegen, speichert ihn in public.widerruf
// und schickt dem Kunden SOFORT eine Eingangsbestaetigung (dauerhafter Datentraeger = E-Mail)
// mit Datum und Uhrzeit, Blindkopie an MAIL_KOPIE (Mark).
// Deploy: supabase functions deploy widerruf --no-verify-jwt
// Benoetigt dieselben Secrets wie "vormerken": SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
// SMTP_FROM, SMTP_FROM_NAME, MAIL_KOPIE. Tabelle: _supabase/sql/2026-11-08_widerruf.sql
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
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

// Schutz vor Missbrauch: hoechstens 5 Widerrufe je E-Mail-Adresse in 24 Stunden
const RATE_LIMIT = 5;
const RATE_FENSTER_MS = 24 * 60 * 60 * 1000;

// denomailer bricht den Kopfblock bei Nicht-ASCII im Betreff ab
function asciiBetreff(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, 120);
}

async function mailSenden(an: string, betreff: string, text: string, html: string) {
  const host = Deno.env.get('SMTP_HOST');
  const user = Deno.env.get('SMTP_USER');
  const pass = Deno.env.get('SMTP_PASS');
  const from = Deno.env.get('SMTP_FROM') ?? user;
  const kopie = Deno.env.get('MAIL_KOPIE');
  if (!host || !user || !pass || !from) throw new Error('SMTP nicht eingerichtet');

  const port = Number(Deno.env.get('SMTP_PORT') ?? '465');
  const client = new SMTPClient({
    connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } },
  });
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
    try { await client.close(); } catch { /* still */ }
  }
}

function vorgangsnummer(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return `WR-${String(n).padStart(6, '0')}`;
}

function zeitDeutsch(d: Date): string {
  return d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) + ' Uhr';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsKopf(req) });
  if (req.method !== 'POST') return json(req, { fehler: 'methode' }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { fehler: 'json' }, 400); }

  // Honigtopf-Feld: Bots fuellen es aus, Menschen sehen es nicht
  if (kurz(b.website)) return json(req, { ok: true, vorgang: 'WR-000000', eingang: zeitDeutsch(new Date()) });

  const name = kurz(b.name, 120);
  const email = kurz(b.email, 160).toLowerCase();
  const vertrag = kurz(b.vertrag, 200);
  const referenz = kurz(b.referenz, 60);
  const bestelltRoh = kurz(b.bestellt_am, 10);
  const bestellt_am = DATUM_RE.test(bestelltRoh) ? bestelltRoh : null;
  const bemerkung = kurz(b.bemerkung, 1000);

  if (!name) return json(req, { fehler: 'name' }, 400);
  if (!MAIL_RE.test(email)) return json(req, { fehler: 'email' }, 400);
  if (!vertrag) return json(req, { fehler: 'vertrag' }, 400);

  const seit = new Date(Date.now() - RATE_FENSTER_MS).toISOString();
  const { count } = await db.from('widerruf')
    .select('id', { count: 'exact', head: true })
    .eq('email', email).gte('eingang', seit);
  if ((count ?? 0) >= RATE_LIMIT) return json(req, { fehler: 'zu_viele' }, 429);

  const jetzt = new Date();
  const vorgang = vorgangsnummer();
  const { error } = await db.from('widerruf').insert({
    vorgang, name, email, vertrag, referenz: referenz || null, bestellt_am,
    bemerkung: bemerkung || null, eingang: jetzt.toISOString(),
  });
  if (error) {
    console.error('widerruf insert', error);
    return json(req, { fehler: 'speichern' }, 500);
  }

  const eingang = zeitDeutsch(jetzt);
  const zeilen: [string, string][] = [
    ['Vorgangsnummer', vorgang],
    ['Eingegangen am', eingang],
    ['Name', name],
    ['E-Mail', email],
    ['Vertrag', vertrag],
  ];
  if (referenz) zeilen.push(['Referenz', referenz]);
  if (bestellt_am) zeilen.push(['Bestellt am', bestellt_am.split('-').reverse().join('.')]);
  if (bemerkung) zeilen.push(['Bemerkung', bemerkung]);

  const text = [
    `Hallo ${name},`,
    ``,
    `wir bestaetigen den Eingang deines Widerrufs.`,
    ``,
    ...zeilen.map(([k, v]) => `${k}: ${v}`),
    ``,
    `Bereits gezahlte Betraege erstatten wir dir nach den Regeln unserer Widerrufsbelehrung`,
    `(https://angelup.de/agb.html#p6) spaetestens binnen 14 Tagen.`,
    ``,
    `Viele Gruesse`,
    `Mark Schwarze, AngelUp`,
    `Alter Postweg 80, 26607 Aurich, kontakt@angelup.de`,
  ].join('\n');

  const html = `<p>Hallo ${esc(name)},</p>
<p>wir bestätigen den Eingang deines Widerrufs.</p>
<table cellpadding="4" style="border-collapse:collapse">${
    zeilen.map(([k, v]) => `<tr><td style="color:#555">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')
  }</table>
<p>Bereits gezahlte Beträge erstatten wir dir nach den Regeln unserer
<a href="https://angelup.de/agb.html#p6">Widerrufsbelehrung</a> spätestens binnen 14 Tagen.</p>
<p>Viele Grüße<br>Mark Schwarze, AngelUp<br>Alter Postweg 80, 26607 Aurich, kontakt@angelup.de</p>`;

  let mail_ok = true;
  try {
    await mailSenden(email, `Eingangsbestaetigung Widerruf ${vorgang}`, text, html);
  } catch (e) {
    mail_ok = false;
    console.error('widerruf mail', e);
  }
  await db.from('widerruf').update({ mail_gesendet: mail_ok }).eq('vorgang', vorgang);

  // Der Widerruf ist gespeichert und damit zugegangen - auch wenn die Mail hakt.
  return json(req, { ok: true, vorgang, eingang, mail_ok });
});
