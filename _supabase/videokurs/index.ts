// Edge Function: videokurs
// Verkauf und Auslieferung der Videokurse.
//
// Oeffentlich (ohne Anmeldung):
//   GET  ?was=katalog                  -> alle aktiven Kurse, Pakete, Preise
//   GET  ?was=kurs&k=<slug>            -> ein Kurs mit Lektionsliste (ohne Videopfade)
//   POST {was:'kauf'}                  -> Kauf anlegen, Rechnung per Mail
//   POST {was:'zugang'}                -> Mail + Code pruefen, Freischaltungen liefern
//   POST {was:'video'}                 -> signierte Video-URL (Gratislektion oder mit Zugang)
//   POST {was:'fortschritt'}           -> Sehfortschritt merken
//
// Nur fuer Mark (Bearer-JWT eines Profils mit rolle 'ausbilder' oder 'admin'):
//   POST {was:'studio'}                -> alles inkl. Videopfade und offener Kaeufe
//   POST {was:'upload_url'}            -> signierte Upload-URL fuer ein Video
//   POST {was:'lektion_speichern'}     -> Lektion anlegen/aendern
//   POST {was:'lektion_loeschen'}      -> Lektion entfernen
//   POST {was:'kurs_speichern'}        -> Kursdaten und Status aendern
//   POST {was:'kauf_bezahlt'}          -> Zahlung buchen, Zugang + Code, Mail an den Kaeufer
//   POST {was:'zugang_haendisch'}      -> Zugang ohne Kauf vergeben
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

const RATE_LIMIT = 5;
const RATE_FENSTER_MS = 24 * 60 * 60 * 1000;
const VIDEO_GUELTIG_SEK = 30 * 60; // kurzlebig, damit weitergegebene Links schnell tot sind
const GERAETE_MAX = 2; // eine Person: z. B. Handy + Rechner

const KONTO = {
  inhaber: 'Mark Schwarze',
  iban: 'DE66500105176000363426',
  bic: 'INGDDEFFXXX',
  bank: 'ING-DiBa',
};

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
      bcc: kopie && kopie !== an ? kopie : undefined,
      subject: asciiBetreff(betreff),
      content: text,
      html,
    });
  } finally {
    try { await client.close(); } catch { /* still */ }
  }
}

// ---------------------------------------------------------------- Hilfsmittel

function kuerzel(slug: string): string {
  const s = slug.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return (s.slice(0, 3) || 'KUR').padEnd(3, 'X');
}

const ZEICHEN = 'ACDEFGHJKLMNPQRTUVWXY3467889';
function zufall(laenge: number): string {
  const b = new Uint8Array(laenge);
  crypto.getRandomValues(b);
  return Array.from(b, (z) => ZEICHEN[z % ZEICHEN.length]).join('');
}

async function freieReferenz(praefix: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const ref = `${praefix}-${zufall(4)}`;
    const { data } = await db.from('videokurs_kauf').select('id').eq('referenz', ref).maybeSingle();
    if (!data) return ref;
  }
  return `${praefix}-${Date.now().toString().slice(-6)}`;
}

async function freierCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = `${zufall(4)}-${zufall(4)}`;
    const { data } = await db.from('videokurs_zugang').select('id').eq('code', code).maybeSingle();
    if (!data) return code;
  }
  return `${zufall(4)}-${Date.now().toString().slice(-4)}`;
}

// Welche Kurse deckt ein gekaufter Artikel ab? Ein Paket schaltet seine Teile mit frei.
async function enthalteneKurse(slug: string): Promise<string[]> {
  const { data } = await db.from('videokurs_bundle').select('kurs_slug').eq('bundle_slug', slug);
  const teile = (data ?? []).map((z: { kurs_slug: string }) => z.kurs_slug);
  return [slug, ...teile];
}

// Alle Slugs, die eine Mailadresse sehen darf
async function freigeschaltet(email: string): Promise<string[]> {
  const { data } = await db.from('videokurs_zugang').select('kurs_slug').eq('email', email);
  const direkt = (data ?? []).map((z: { kurs_slug: string }) => z.kurs_slug);
  if (!direkt.length) return [];
  const { data: teile } = await db
    .from('videokurs_bundle').select('kurs_slug').in('bundle_slug', direkt);
  const aus = new Set(direkt);
  for (const t of teile ?? []) aus.add((t as { kurs_slug: string }).kurs_slug);
  return [...aus];
}

// Bearer-JWT pruefen und Ausbilderrolle verlangen
async function ausbilder(req: Request): Promise<{ id: string; email: string } | null> {
  const kopf = req.headers.get('authorization') ?? '';
  const token = kopf.toLowerCase().startsWith('bearer ') ? kopf.slice(7).trim() : '';
  if (!token || token.split('.').length !== 3) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: p } = await db.from('profile').select('rolle').eq('id', data.user.id).maybeSingle();
  const rolle = (p as { rolle?: string } | null)?.rolle ?? '';
  if (rolle !== 'ausbilder' && rolle !== 'admin') return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}

// Zugang an Geraete binden: bekanntes Geraet -> ok, neues Geraet nur solange Platz frei ist
async function geraetOk(email: string, geraetId: string, ua: string): Promise<boolean> {
  if (!geraetId || geraetId.length < 8) return false;
  const { data: g } = await db.from('videokurs_geraet').select('id')
    .eq('email', email).eq('geraet_id', geraetId).maybeSingle();
  if (g) {
    await db.from('videokurs_geraet')
      .update({ zuletzt: new Date().toISOString() }).eq('id', (g as { id: string }).id);
    return true;
  }
  const { count } = await db.from('videokurs_geraet')
    .select('id', { count: 'exact', head: true }).eq('email', email);
  if ((count ?? 0) >= GERAETE_MAX) return false;
  const { error } = await db.from('videokurs_geraet')
    .insert({ email, geraet_id: geraetId, ua: ua.slice(0, 200) });
  return !error;
}

async function signierteVideoUrl(pfad: string): Promise<string | null> {
  const { data } = await db.storage.from('kursvideos').createSignedUrl(pfad, VIDEO_GUELTIG_SEK);
  return data?.signedUrl ?? null;
}

// ------------------------------------------------------------------- Mailtexte

type KaufDaten = {
  name: string;
  referenz: string;
  kurs: string;
  preis: number;
};

function textKauf(d: KaufDaten): string {
  return [
    `Hallo ${d.name},`,
    ``,
    `danke fuer deine Bestellung.`,
    ``,
    `Kurs: ${d.kurs}`,
    `Preis: ${euro(d.preis).replace('€', 'EUR')}`,
    `Referenz: ${d.referenz}`,
    ``,
    `Bitte ueberweise den Betrag auf:`,
    `${KONTO.inhaber}`,
    `IBAN ${KONTO.iban}`,
    `BIC ${KONTO.bic} (${KONTO.bank})`,
    `Verwendungszweck: ${d.referenz}`,
    ``,
    `Sobald die Zahlung da ist, bekommst du von uns einen Zugangscode per Mail.`,
    `Damit kannst du den Kurs zeitlich unbegrenzt und so oft du willst ansehen.`,
    ``,
    `Petri!`,
    `Mark Schwarze`,
    `Zur Kiepe - Alter Postweg 80 - 26607 Aurich`,
    `angelup.de`,
  ].join('\n');
}

function htmlRahmen(titel: string, unter: string, innen: string): string {
  return `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#eef3f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#12212e;border-radius:12px 12px 0 0;padding:22px 24px">
    <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.3px">${esc(titel)}</div>
    <div style="color:#2ee6c5;font-size:14px;margin-top:4px">${esc(unter)}</div>
  </div>
  <div style="background:#fff;border-radius:0 0 12px 12px;padding:24px">${innen}</div>
  <p style="margin:14px 0 0;text-align:center;color:#7d8b98;font-size:12px">angelup.de</p>
</div></body></html>`;
}

const zeile = (k: string, w: string) =>
  `<tr><td style="padding:6px 10px;color:#7d8b98;font-size:13px;white-space:nowrap">${k}</td>` +
  `<td style="padding:6px 10px;color:#12212e;font-size:15px;font-weight:600">${esc(w)}</td></tr>`;

function htmlKauf(d: KaufDaten): string {
  return htmlRahmen('Bestellung eingegangen', d.kurs, `
    <p style="margin:0 0 14px;color:#12212e;font-size:15px">Hallo ${esc(d.name)},</p>
    <p style="margin:0 0 18px;color:#3b4a58;font-size:15px;line-height:1.55">danke f&uuml;r deine Bestellung. Bitte &uuml;berweise den Betrag mit der Referenz als Verwendungszweck.</p>
    <table style="width:100%;border-collapse:collapse;background:#f6f9fb;border-radius:12px">
      <tr><td colspan="2" style="height:8px"></td></tr>
      ${zeile('Kurs', d.kurs)}
      ${zeile('Preis', euro(d.preis))}
      ${zeile('Referenz', d.referenz)}
      ${zeile('Empf&auml;nger', KONTO.inhaber)}
      ${zeile('IBAN', KONTO.iban)}
      ${zeile('BIC', KONTO.bic + ' (' + KONTO.bank + ')')}
      <tr><td colspan="2" style="height:8px"></td></tr>
    </table>
    <p style="margin:20px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">Sobald die Zahlung da ist, bekommst du einen Zugangscode per Mail. Damit kannst du den Kurs <b>zeitlich unbegrenzt</b> und so oft du willst ansehen.</p>
    <p style="margin:22px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">Petri!<br><b style="color:#12212e">Mark Schwarze</b><br>Zur Kiepe &middot; Alter Postweg 80 &middot; 26607 Aurich</p>`);
}

function textFrei(name: string, kurs: string, email: string, code: string): string {
  return [
    `Hallo ${name},`,
    ``,
    `die Zahlung ist da - dein Kurs ist freigeschaltet.`,
    ``,
    `Kurs: ${kurs}`,
    `Zugang: https://angelup.de/player.html`,
    `E-Mail: ${email}`,
    `Zugangscode: ${code}`,
    ``,
    `Der Zugang laeuft nicht ab. Du kannst den Kurs so oft ansehen, wie du willst.`,
    `Wichtig: Der Zugang ist persoenlich und gilt auf bis zu ${GERAETE_MAX} eigenen Geraeten`,
    `(z. B. Handy und Rechner). Bitte gib Code und Videos nicht weiter.`,
    ``,
    `Petri!`,
    `Mark Schwarze`,
    `Zur Kiepe - Alter Postweg 80 - 26607 Aurich`,
    `angelup.de`,
  ].join('\n');
}

function htmlFrei(name: string, kurs: string, email: string, code: string): string {
  return htmlRahmen('Dein Kurs ist frei', kurs, `
    <p style="margin:0 0 14px;color:#12212e;font-size:15px">Hallo ${esc(name)},</p>
    <p style="margin:0 0 18px;color:#3b4a58;font-size:15px;line-height:1.55">die Zahlung ist da. Du kannst sofort loslegen.</p>
    <table style="width:100%;border-collapse:collapse;background:#f6f9fb;border-radius:12px">
      <tr><td colspan="2" style="height:8px"></td></tr>
      ${zeile('Kurs', kurs)}
      ${zeile('E-Mail', email)}
      ${zeile('Zugangscode', code)}
      <tr><td colspan="2" style="height:8px"></td></tr>
    </table>
    <p style="margin:20px 0 0;text-align:center">
      <a href="https://angelup.de/player.html" style="display:inline-block;background:#12212e;color:#2ee6c5;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">Kurs jetzt ansehen</a>
    </p>
    <p style="margin:20px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">Der Zugang <b>l&auml;uft nicht ab</b> und ist <b>pers&ouml;nlich</b>: Er gilt auf bis zu ${GERAETE_MAX} eigenen Ger&auml;ten (z.&nbsp;B. Handy und Rechner). Bitte gib Code und Videos nicht weiter.</p>
    <p style="margin:22px 0 0;color:#3b4a58;font-size:15px;line-height:1.55">Petri!<br><b style="color:#12212e">Mark Schwarze</b><br>Zur Kiepe &middot; Alter Postweg 80 &middot; 26607 Aurich</p>`);
}

// ----------------------------------------------------------------------- Server

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsKopf(req) });

  // ------------------------------------------------------------------ GET
  if (req.method === 'GET') {
    const p = new URL(req.url).searchParams;
    const was = kurz(p.get('was'), 30) || 'katalog';

    if (was === 'katalog') {
      const { data: kurse } = await db
        .from('videokurs')
        .select('slug, art, titel, untertitel, badge, beschreibung, fuer_wen, inhalt, symbol, farbe, preis_cent, dauer_min, status, vorschau_bild, sortierung')
        .eq('aktiv', true).order('sortierung');
      const { data: pakete } = await db
        .from('videokurs_bundle').select('bundle_slug, kurs_slug, sortierung').order('sortierung');
      const { data: lektionen } = await db
        .from('videokurs_lektion').select('kurs_slug, dauer_sek').eq('aktiv', true);

      const anzahl: Record<string, number> = {};
      const laenge: Record<string, number> = {};
      for (const l of lektionen ?? []) {
        const z = l as { kurs_slug: string; dauer_sek: number | null };
        anzahl[z.kurs_slug] = (anzahl[z.kurs_slug] ?? 0) + 1;
        laenge[z.kurs_slug] = (laenge[z.kurs_slug] ?? 0) + (z.dauer_sek ?? 0);
      }
      return json(req, { kurse: kurse ?? [], pakete: pakete ?? [], anzahl, laenge });
    }

    if (was === 'kurs') {
      const slug = kurz(p.get('k'), 60);
      if (!slug) return json(req, { fehler: 'kurs' }, 400);
      const { data: kurs } = await db
        .from('videokurs').select('*').eq('slug', slug).eq('aktiv', true).maybeSingle();
      if (!kurs) return json(req, { fehler: 'unbekannt' }, 404);
      const { data: roh } = await db
        .from('videokurs_lektion')
        .select('id, nr, titel, beschreibung, dauer_sek, frei, video_pfad, material_pfad')
        .eq('kurs_slug', slug).eq('aktiv', true).order('nr');
      const lektionen = (roh ?? []).map((l: Record<string, unknown>) => ({
        id: l.id, nr: l.nr, titel: l.titel, beschreibung: l.beschreibung,
        dauer_sek: l.dauer_sek, frei: l.frei,
        hat_video: Boolean(l.video_pfad), hat_material: Boolean(l.material_pfad),
      }));
      const { data: teile } = await db
        .from('videokurs_bundle').select('kurs_slug, sortierung')
        .eq('bundle_slug', slug).order('sortierung');
      let paketKurse: unknown[] = [];
      if (teile?.length) {
        const { data: pk } = await db
          .from('videokurs').select('slug, titel, untertitel, symbol, farbe, preis_cent, art')
          .in('slug', teile.map((t: { kurs_slug: string }) => t.kurs_slug));
        paketKurse = pk ?? [];
      }
      return json(req, { kurs, lektionen, paketKurse });
    }

    return json(req, { fehler: 'unbekannt' }, 400);
  }

  if (req.method !== 'POST') return json(req, { fehler: 'methode' }, 405);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json(req, { fehler: 'ungueltig' }, 400);
  }

  const was = kurz(b.was, 30);

  // ------------------------------------------------------------ Kauf anlegen
  if (was === 'kauf') {
    if (kurz(b.website)) return json(req, { ok: true, referenz: 'VK-0000' });

    const slug = kurz(b.kurs, 60);
    const name = kurz(b.name, 80);
    const email = kurz(b.email, 120).toLowerCase();
    if (!slug) return json(req, { fehler: 'kurs' }, 400);
    if (name.length < 2) return json(req, { fehler: 'name' }, 400);
    if (!MAIL_RE.test(email)) return json(req, { fehler: 'email' }, 400);
    if (b.agb_ok !== true) return json(req, { fehler: 'agb' }, 400);
    if (b.widerruf_ok !== true) return json(req, { fehler: 'widerruf' }, 400);

    const { data: kurs } = await db
      .from('videokurs').select('*').eq('slug', slug).eq('aktiv', true).maybeSingle();
    if (!kurs) return json(req, { fehler: 'unbekannt' }, 404);
    const k = kurs as Record<string, unknown>;
    if (k.status !== 'fertig') return json(req, { fehler: 'noch_nicht' }, 409);

    // schon freigeschaltet?
    const schon = await freigeschaltet(email);
    if (schon.includes(slug)) return json(req, { fehler: 'hast_schon' }, 409);

    const seit = new Date(Date.now() - RATE_FENSTER_MS).toISOString();
    const { count } = await db
      .from('videokurs_kauf').select('id', { count: 'exact', head: true })
      .eq('email', email).gte('angelegt_am', seit);
    if ((count ?? 0) >= RATE_LIMIT) return json(req, { fehler: 'zu_viele' }, 429);

    const preis = Number(k.preis_cent);
    const referenz = await freieReferenz(`VK-${kuerzel(slug)}`);

    const { error } = await db.from('videokurs_kauf').insert({
      referenz, kurs_slug: slug, name, email,
      telefon: kurz(b.telefon, 40) || null,
      preis_cent: preis, zahlart: 'ueberweisung', status: 'offen',
      agb_ok: true, widerruf_ok: true,
    });
    if (error) return json(req, { fehler: 'speichern', detail: error.message }, 500);

    const d: KaufDaten = { name, referenz, kurs: String(k.titel), preis };
    let mailOk = true;
    try {
      await mailSenden(email, `Bestellung ${d.kurs} - ${referenz}`, textKauf(d), htmlKauf(d));
    } catch (_e) {
      mailOk = false;
    }
    return json(req, {
      ok: true, referenz, preis_cent: preis, mail: mailOk,
      konto: KONTO, titel: k.titel,
    });
  }

  // ---------------------------------------------- Zugang pruefen (Mail + Code)
  if (was === 'zugang') {
    const email = kurz(b.email, 120).toLowerCase();
    const code = kurz(b.code, 20).toUpperCase();
    if (!MAIL_RE.test(email)) return json(req, { fehler: 'email' }, 400);
    if (!code) return json(req, { fehler: 'code' }, 400);

    const { data: treffer } = await db
      .from('videokurs_zugang').select('kurs_slug').eq('email', email).eq('code', code).maybeSingle();
    if (!treffer) return json(req, { fehler: 'falsch' }, 403);

    const geraet = kurz(b.geraet, 80);
    if (!(await geraetOk(email, geraet, req.headers.get('user-agent') ?? ''))) {
      return json(req, { fehler: 'geraet', max: GERAETE_MAX }, 403);
    }

    const slugs = await freigeschaltet(email);
    const { data: kurse } = await db
      .from('videokurs')
      .select('slug, art, titel, untertitel, symbol, farbe, beschreibung')
      .in('slug', slugs.length ? slugs : ['-']).eq('aktiv', true).order('sortierung');
    return json(req, { ok: true, kurse: kurse ?? [], slugs });
  }

  // ------------------------------------------------------- Video ausliefern
  if (was === 'video') {
    const slug = kurz(b.kurs, 60);
    const nr = Number(b.nr ?? 0);
    const email = kurz(b.email, 120).toLowerCase();
    const code = kurz(b.code, 20).toUpperCase();
    if (!slug || !nr) return json(req, { fehler: 'kurs' }, 400);

    const { data: lek } = await db
      .from('videokurs_lektion').select('*')
      .eq('kurs_slug', slug).eq('nr', nr).eq('aktiv', true).maybeSingle();
    if (!lek) return json(req, { fehler: 'unbekannt' }, 404);
    const l = lek as Record<string, unknown>;
    if (!l.video_pfad) return json(req, { fehler: 'kein_video' }, 404);

    let darf = l.frei === true;
    if (!darf) {
      if (!MAIL_RE.test(email) || !code) return json(req, { fehler: 'anmelden' }, 401);
      const { data: t } = await db
        .from('videokurs_zugang').select('id').eq('email', email).eq('code', code).maybeSingle();
      if (!t) return json(req, { fehler: 'falsch' }, 403);
      const geraet = kurz(b.geraet, 80);
      if (!(await geraetOk(email, geraet, req.headers.get('user-agent') ?? ''))) {
        return json(req, { fehler: 'geraet', max: GERAETE_MAX }, 403);
      }
      darf = (await freigeschaltet(email)).includes(slug);
    }
    if (!darf) return json(req, { fehler: 'kein_zugang' }, 403);

    const url = await signierteVideoUrl(String(l.video_pfad));
    if (!url) return json(req, { fehler: 'video_fehlt' }, 500);
    let material: string | null = null;
    if (l.material_pfad) material = await signierteVideoUrl(String(l.material_pfad));
    return json(req, { ok: true, url, material, gueltig_sek: VIDEO_GUELTIG_SEK });
  }

  // ------------------------------------------------------------ Fortschritt
  if (was === 'fortschritt') {
    const email = kurz(b.email, 120).toLowerCase();
    const lektion = kurz(b.lektion_id, 60);
    if (!MAIL_RE.test(email) || !lektion) return json(req, { fehler: 'ungueltig' }, 400);
    await db.from('videokurs_fortschritt').upsert({
      lektion_id: lektion, email,
      sekunden: Math.max(0, Math.floor(Number(b.sekunden ?? 0))),
      fertig: b.fertig === true,
      zuletzt: new Date().toISOString(),
    }, { onConflict: 'lektion_id,email' });
    return json(req, { ok: true });
  }

  // ================================================== ab hier nur fuer Mark

  const chef = await ausbilder(req);
  if (!chef) return json(req, { fehler: 'nicht_erlaubt' }, 403);

  if (was === 'studio') {
    const { data: kurse } = await db.from('videokurs').select('*').order('sortierung');
    const { data: lektionen } = await db.from('videokurs_lektion').select('*').order('kurs_slug').order('nr');
    const { data: kaeufe } = await db
      .from('videokurs_kauf').select('*').order('angelegt_am', { ascending: false }).limit(200);
    const { data: zugaenge } = await db
      .from('videokurs_zugang').select('*').order('seit', { ascending: false }).limit(200);
    const { data: pakete } = await db.from('videokurs_bundle').select('*').order('sortierung');
    const { data: geraete } = await db
      .from('videokurs_geraet').select('email, geraet_id, ua, seit, zuletzt')
      .order('zuletzt', { ascending: false }).limit(400);
    return json(req, {
      kurse: kurse ?? [], lektionen: lektionen ?? [], kaeufe: kaeufe ?? [],
      zugaenge: zugaenge ?? [], pakete: pakete ?? [], geraete: geraete ?? [],
    });
  }

  // Geraete einer Mailadresse zuruecksetzen (wenn ein Kunde sein Geraet wechselt)
  if (was === 'geraete_reset') {
    const email = kurz(b.email, 120).toLowerCase();
    if (!MAIL_RE.test(email)) return json(req, { fehler: 'ungueltig' }, 400);
    const { error } = await db.from('videokurs_geraet').delete().eq('email', email);
    if (error) return json(req, { fehler: 'loeschen', detail: error.message }, 500);
    return json(req, { ok: true });
  }

  if (was === 'upload_url') {
    const slug = kurz(b.kurs, 60);
    const nr = Number(b.nr ?? 0);
    const dateiname = kurz(b.dateiname, 120).replace(/[^A-Za-z0-9._-]/g, '_');
    const art = kurz(b.art, 12) || 'video';
    if (!slug || !nr || !dateiname) return json(req, { fehler: 'ungueltig' }, 400);
    const endung = dateiname.includes('.') ? dateiname.split('.').pop()!.toLowerCase() : 'mp4';
    const pfad = `${slug}/${String(nr).padStart(2, '0')}-${art}-${zufall(6)}.${endung}`;
    const { data, error } = await db.storage.from('kursvideos').createSignedUploadUrl(pfad);
    if (error || !data) return json(req, { fehler: 'upload', detail: error?.message }, 500);
    return json(req, { ok: true, pfad, url: data.signedUrl, token: data.token });
  }

  if (was === 'lektion_speichern') {
    const id = kurz(b.id, 60);
    const slug = kurz(b.kurs, 60);
    const satz: Record<string, unknown> = {
      titel: kurz(b.titel, 160) || 'Ohne Titel',
      beschreibung: kurz(b.beschreibung, 800) || null,
      dauer_sek: b.dauer_sek == null ? null : Math.max(0, Math.floor(Number(b.dauer_sek))),
      frei: b.frei === true,
      aktiv: b.aktiv !== false,
    };
    if (b.video_pfad !== undefined) satz.video_pfad = kurz(b.video_pfad, 300) || null;
    if (b.material_pfad !== undefined) satz.material_pfad = kurz(b.material_pfad, 300) || null;

    if (id) {
      const { error } = await db.from('videokurs_lektion').update(satz).eq('id', id);
      if (error) return json(req, { fehler: 'speichern', detail: error.message }, 500);
      return json(req, { ok: true, id });
    }
    if (!slug) return json(req, { fehler: 'kurs' }, 400);
    const { data: max } = await db
      .from('videokurs_lektion').select('nr').eq('kurs_slug', slug)
      .order('nr', { ascending: false }).limit(1).maybeSingle();
    satz.kurs_slug = slug;
    satz.nr = ((max as { nr?: number } | null)?.nr ?? 0) + 1;
    const { data, error } = await db.from('videokurs_lektion').insert(satz).select('id').single();
    if (error) return json(req, { fehler: 'speichern', detail: error.message }, 500);
    return json(req, { ok: true, id: (data as { id: string }).id, nr: satz.nr });
  }

  if (was === 'lektion_loeschen') {
    const id = kurz(b.id, 60);
    if (!id) return json(req, { fehler: 'ungueltig' }, 400);
    const { data: alt } = await db
      .from('videokurs_lektion').select('video_pfad, material_pfad').eq('id', id).maybeSingle();
    const wege = [
      (alt as Record<string, string | null> | null)?.video_pfad,
      (alt as Record<string, string | null> | null)?.material_pfad,
    ].filter(Boolean) as string[];
    if (wege.length) { try { await db.storage.from('kursvideos').remove(wege); } catch { /* still */ } }
    const { error } = await db.from('videokurs_lektion').delete().eq('id', id);
    if (error) return json(req, { fehler: 'loeschen', detail: error.message }, 500);
    return json(req, { ok: true });
  }

  if (was === 'kurs_speichern') {
    const slug = kurz(b.slug, 60);
    if (!slug) return json(req, { fehler: 'kurs' }, 400);
    const satz: Record<string, unknown> = {};
    for (const f of ['titel', 'untertitel', 'badge', 'beschreibung', 'fuer_wen', 'inhalt', 'symbol', 'farbe', 'status', 'art']) {
      if (b[f] !== undefined) satz[f] = kurz(b[f], 2000) || null;
    }
    if (b.preis_cent !== undefined) satz.preis_cent = Math.max(0, Math.floor(Number(b.preis_cent)));
    if (b.dauer_min !== undefined) satz.dauer_min = b.dauer_min == null ? null : Math.max(0, Math.floor(Number(b.dauer_min)));
    if (b.sortierung !== undefined) satz.sortierung = Math.floor(Number(b.sortierung));
    if (b.aktiv !== undefined) satz.aktiv = b.aktiv === true;

    const { data: da } = await db.from('videokurs').select('slug').eq('slug', slug).maybeSingle();
    if (!da) {
      satz.slug = slug;
      if (!satz.titel) satz.titel = slug;
      const { error } = await db.from('videokurs').insert(satz);
      if (error) return json(req, { fehler: 'speichern', detail: error.message }, 500);
      return json(req, { ok: true, neu: true });
    }
    const { error } = await db.from('videokurs').update(satz).eq('slug', slug);
    if (error) return json(req, { fehler: 'speichern', detail: error.message }, 500);
    return json(req, { ok: true });
  }

  if (was === 'kauf_bezahlt') {
    const id = kurz(b.id, 60);
    if (!id) return json(req, { fehler: 'ungueltig' }, 400);
    const { data: kauf } = await db.from('videokurs_kauf').select('*').eq('id', id).maybeSingle();
    if (!kauf) return json(req, { fehler: 'unbekannt' }, 404);
    const kf = kauf as Record<string, unknown>;
    const email = String(kf.email);
    const slug = String(kf.kurs_slug);

    const { data: kurs } = await db.from('videokurs').select('titel').eq('slug', slug).maybeSingle();
    const titel = (kurs as { titel?: string } | null)?.titel ?? slug;

    const { data: vorhanden } = await db
      .from('videokurs_zugang').select('code').eq('email', email).limit(1).maybeSingle();
    const code = (vorhanden as { code?: string } | null)?.code ?? await freierCode();

    const { error: zErr } = await db.from('videokurs_zugang').upsert({
      kurs_slug: slug, email, kauf_id: id, code, unbegrenzt: true,
    }, { onConflict: 'kurs_slug,email' });
    if (zErr) return json(req, { fehler: 'zugang', detail: zErr.message }, 500);

    await db.from('videokurs_kauf')
      .update({ status: 'bezahlt', bezahlt_am: new Date().toISOString() }).eq('id', id);

    let mailOk = true;
    try {
      await mailSenden(
        email, `Freigeschaltet: ${titel}`,
        textFrei(String(kf.name), titel, email, code),
        htmlFrei(String(kf.name), titel, email, code),
      );
    } catch (_e) {
      mailOk = false;
    }
    return json(req, { ok: true, code, mail: mailOk });
  }

  if (was === 'zugang_haendisch') {
    const slug = kurz(b.kurs, 60);
    const email = kurz(b.email, 120).toLowerCase();
    if (!slug || !MAIL_RE.test(email)) return json(req, { fehler: 'ungueltig' }, 400);
    const { data: vorhanden } = await db
      .from('videokurs_zugang').select('code').eq('email', email).limit(1).maybeSingle();
    const code = (vorhanden as { code?: string } | null)?.code ?? await freierCode();
    const { error } = await db.from('videokurs_zugang').upsert({
      kurs_slug: slug, email, code, unbegrenzt: true,
    }, { onConflict: 'kurs_slug,email' });
    if (error) return json(req, { fehler: 'zugang', detail: error.message }, 500);

    if (b.mail === true) {
      const { data: kurs } = await db.from('videokurs').select('titel').eq('slug', slug).maybeSingle();
      const titel = (kurs as { titel?: string } | null)?.titel ?? slug;
      try {
        await mailSenden(
          email, `Freigeschaltet: ${titel}`,
          textFrei(kurz(b.name, 80) || 'Angler', titel, email, code),
          htmlFrei(kurz(b.name, 80) || 'Angler', titel, email, code),
        );
      } catch { /* still */ }
    }
    return json(req, { ok: true, code });
  }

  if (was === 'zugang_weg') {
    const slug = kurz(b.kurs, 60);
    const email = kurz(b.email, 120).toLowerCase();
    if (!slug || !email) return json(req, { fehler: 'ungueltig' }, 400);
    const { error } = await db.from('videokurs_zugang').delete()
      .eq('kurs_slug', slug).eq('email', email);
    if (error) return json(req, { fehler: 'loeschen', detail: error.message }, 500);
    return json(req, { ok: true });
  }

  return json(req, { fehler: 'unbekannt' }, 400);
});
