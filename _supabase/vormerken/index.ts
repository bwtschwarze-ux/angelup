// Edge Function: vormerken
// Nimmt unverbindliche Vormerkungen fuer Kurse ohne festen Termin entgegen
// (Karpfen, Raubfisch, Waller ...), schreibt sie nach public.vormerkung und
// schickt eine Bestaetigung an den Interessenten mit Blindkopie an Mark.
// Bewusst OHNE Zahlungsaufforderung - die Vormerkung ist unverbindlich.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const ERLAUBTE_HERKUNFT = ['https://angelup.de', 'https://www.angelup.de'];

function corsKopf(req: Request): Record<string, string> {
  const herkunft = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin':
      ERLAUBTE_HERKUNFT.includes(herkunft) ? herkunft : ERLAUBTE_HERKUNFT[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

const RATE_LIMIT = 3;
const RATE_FENSTER_MS = 24 * 60 * 60 * 1000;

// denomailer bricht den Kopfblock bei Nicht-ASCII im Betreff ab
function asciiBetreff(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/€/g, 'EUR')
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

// Kuerzel fuer die Referenz aus dem Slug: karpfen -> KAR, raubfisch -> RAU
function kuerzel(slug: string): string {
  const s = slug.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return (s.slice(0, 3) || 'KUR').padEnd(3, 'X');
}

async function freieReferenz(praefix: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = String(Math.floor(1000 + Math.random() * 9000));
    const ref = `${praefix}-${n}`;
    const { data } = await db.from('vormerkung').select('id').eq('referenz', ref).maybeSingle();
    if (!data) return ref;
  }
  return `${praefix}-${Date.now().toString().slice(-6)}`;
}

type Daten = {
  name: string;
  referenz: string;
  kurs: string;
  termin: string;
  wunsch: string;
};

function textMail(d: Daten): string {
  return [
    `Hallo ${d.name},`,
    ``,
    `danke fuer deine Vormerkung. Sie ist unverbindlich und kostet dich nichts.`,
    ``,
    `Kurs: ${d.kurs}`,
    `Termin: ${d.termin}`,
    d.wunsch ? `Dein Wunsch: ${d.wunsch}` : ``,
    `Referenz: ${d.referenz}`,
    ``,
    `Sobald der Termin feststeht, melden wir uns bei dir per E-Mail und du`,
    `bekommst als Vorgemerkter zuerst die Moeglichkeit, verbindlich zu buchen.`,
    `Es entsteht dir bis dahin keinerlei Verpflichtung.`,
    ``,
    `Petri!`,
    `Mark Schwarze`,
    `Zur Kiepe - Alter Postweg 80 - 26607 Aurich`,
    `angelup.de`,
  ].filter((z) => z !== '').join('\n');
}

function htmlMail(d: Daten): string {
  const zeile = (k: string, w: string) =>
    `<tr><td style="padding:6px 10px;color:#7d8b98;font-size:13px;white-space:nowrap">${k}</td>` +
    `<td style="padding:6px 10px;color:#12212e;font-size:15px;font-weight:600">${esc(w)}</td></tr>`;
  return `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#eef3f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#12212e;border-radius:12px 12px 0 0;padding:22px 24px">
    <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.3px">Vormerkung notiert</div>
    <div style="color:#8fd0ff;font-size:14px;margin-top:4px">${esc(d.kurs)}</div>
  </div>
  <div style="background:#fff;border-radius:0 0 12px 12px;padding:24px">
    <p style="margin:0 0 14px;color:#12212e;font-size:15px">Hallo ${esc(d.name)},</p>
    <p style="margin:0 0 18px;color:#3b4a58;font-size:15px;line-height:1.55">danke f&uuml;r deine Vormerkung. Sie ist <b>unverbindlich</b> und kostet dich nichts.</p>
    <table style="width:100%;border-collapse:collapse;background:#f6f9fb;border-radius:12px;padding:8px">
      <tr><td colspan="2" style="height:8px"></td></tr>
      ${zeile('Kurs', d.kurs)}
      ${zeile('Termin', d.termin)}
      ${d.wunsch ? zeile('Dein Wunsch', d.wunsch) : ''}
      ${zeile('Referenz', d.referenz)}
      <tr><td colspan="2" style="height:8px"></td></tr>
    </table>
    <p style="margin:20px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">Sobald der Termin feststeht, melden wir uns bei dir per E-Mail. Als Vorgemerkter bekommst du zuerst die M&ouml;glichkeit, verbindlich zu buchen. Bis dahin entsteht dir keinerlei Verpflichtung.</p>
    <p style="margin:22px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">Petri!<br><b style="color:#12212e">Mark Schwarze</b><br>Zur Kiepe &middot; Alter Postweg 80 &middot; 26607 Aurich</p>
  </div>
  <p style="margin:14px 0 0;text-align:center;color:#7d8b98;font-size:12px">angelup.de</p>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsKopf(req) });

  // GET: Kursdaten samt Varianten fuer die Vormerkungsseite ausliefern
  if (req.method === 'GET') {
    const slug = kurz(new URL(req.url).searchParams.get('kurs'), 60);
    if (!slug) return json(req, { fehler: 'kurs' }, 400);
    const { data: kurs } = await db
      .from('kursangebot').select('*').eq('slug', slug).eq('aktiv', true).maybeSingle();
    if (!kurs) return json(req, { fehler: 'unbekannt' }, 404);
    const { data: varianten } = await db
      .from('kursangebot_variante').select('*')
      .eq('kurs_slug', slug).eq('aktiv', true).order('sortierung');
    return json(req, { kurs, varianten: varianten ?? [] });
  }

  if (req.method !== 'POST') return json(req, { fehler: 'methode' }, 405);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json(req, { fehler: 'ungueltig' }, 400);
  }

  // Honeypot
  if (kurz(b.website)) return json(req, { ok: true, referenz: 'VM-0000' });

  const slug = kurz(b.kurs, 60);
  if (!slug) return json(req, { fehler: 'kurs' }, 400);

  const { data: kurs } = await db
    .from('kursangebot').select('*').eq('slug', slug).eq('aktiv', true).maybeSingle();
  if (!kurs) return json(req, { fehler: 'unbekannt' }, 404);
  if (kurs.modus !== 'vormerken') return json(req, { fehler: 'kein_vormerken' }, 400);

  const name = kurz(b.name, 80);
  const email = kurz(b.email, 120).toLowerCase();
  if (name.length < 2) return json(req, { fehler: 'name' }, 400);
  if (!MAIL_RE.test(email)) return json(req, { fehler: 'email' }, 400);
  if (b.datenschutz_ok !== true) return json(req, { fehler: 'datenschutz' }, 400);

  // Variante ist optional, muss aber zum Kurs gehoeren
  const variante = kurz(b.variante, 40) || null;
  let variantenText = '';
  if (variante) {
    const { data: v } = await db
      .from('kursangebot_variante').select('*')
      .eq('kurs_slug', slug).eq('variante', variante).eq('aktiv', true).maybeSingle();
    if (!v) return json(req, { fehler: 'variante' }, 400);
    variantenText = [v.gruppe, v.titel].filter(Boolean).join(' - ') +
      (typeof v.preis_cent === 'number' ? ` (${euro(v.preis_cent)})` : '');
  }

  // Rate-Limit: hoechstens 3 Vormerkungen je Mailadresse in 24 Stunden
  const seit = new Date(Date.now() - RATE_FENSTER_MS).toISOString();
  const { count } = await db
    .from('vormerkung')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('angelegt_am', seit);
  if ((count ?? 0) >= RATE_LIMIT) return json(req, { fehler: 'zu_viele' }, 429);

  const referenz = await freieReferenz(`VM-${kuerzel(slug)}`);

  const { error } = await db.from('vormerkung').insert({
    referenz,
    kurs_slug: slug,
    variante,
    name,
    email,
    telefon: kurz(b.telefon, 40) || null,
    tiktok_name: kurz(b.tiktok_name, 60) || null,
    bemerkung: kurz(b.bemerkung, 500) || null,
    datenschutz_ok: true,
    status: 'offen',
  });
  if (error) {
    if (error.code === '23505') return json(req, { fehler: 'doppelt' }, 409);
    return json(req, { fehler: 'speichern', detail: error.message }, 500);
  }

  const d: Daten = {
    name,
    referenz,
    kurs: kurs.titel ?? slug,
    termin: kurs.termin_text ?? 'Termin folgt',
    wunsch: variantenText,
  };

  let mailOk = true;
  try {
    await mailSenden(email, `Vormerkung ${d.kurs} - ${referenz}`, textMail(d), htmlMail(d));
  } catch (e) {
    mailOk = false;
    const kopie = Deno.env.get('MAIL_KOPIE');
    if (kopie) {
      try {
        await mailSenden(
          kopie,
          `Vormerkung ${referenz} (Teilnehmermail fehlgeschlagen)`,
          textMail(d) + `\n\nMailfehler an ${email}: ${String(e)}`,
          htmlMail(d),
        );
      } catch { /* still */ }
    }
  }

  return json(req, { ok: true, referenz, mail: mailOk });
});
