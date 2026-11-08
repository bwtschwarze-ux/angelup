// Edge Function: live-raum
// Gibt nur Teilnehmern mit gueltigem Online-Zugang (oder Ausbildern) Zutritt
// zum Live-Videoraum. Nutzt Daily, faellt ohne DAILY_API_KEY auf Jitsi zurueck.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(daten: unknown, status = 200) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const RAUM = "angelup-live";
const JITSI_RAUM = "AngelUp-Fischerpruefung-LVMZgSZZbpp1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ fehler: "nicht_angemeldet" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: u, error: uFehler } = await admin.auth.getUser(jwt);
    if (uFehler || !u?.user) return json({ fehler: "nicht_angemeldet" }, 401);

    const { data: prof } = await admin
      .from("profile").select("rolle,name").eq("id", u.user.id).maybeSingle();

    const istAusbilder = prof?.rolle === "ausbilder";
    const name = (prof?.name || u.user.email || "Teilnehmer").slice(0, 40);

    if (!istAusbilder) {
      const heute = new Date().toISOString().slice(0, 10);
      const { data: zug } = await admin
        .from("online_zugang").select("frei_bis")
        .eq("user_id", u.user.id).gte("frei_bis", heute).limit(1);
      if (!zug || !zug.length) return json({ fehler: "kein_zugang" }, 403);
    }

    const dailyKey = Deno.env.get("DAILY_API_KEY");

    if (dailyKey) {
      const kopf = {
        "Authorization": "Bearer " + dailyKey,
        "Content-Type": "application/json",
      };

      // Raum holen, bei 404 anlegen
      let r = await fetch("https://api.daily.co/v1/rooms/" + RAUM, { headers: kopf });
      let raum = await r.json();

      if (r.status === 404) {
        r = await fetch("https://api.daily.co/v1/rooms", {
          method: "POST",
          headers: kopf,
          body: JSON.stringify({
            name: RAUM,
            privacy: "private",
            properties: {
              enable_chat: true,
              enable_screenshare: true,
              enable_knocking: false,
              start_video_off: true,
              start_audio_off: true,
              lang: "de",
            },
          }),
        });
        raum = await r.json();
      }

      if (!raum?.url) return json({ fehler: "daily_fehler", detail: raum }, 502);

      const exp = Math.floor(Date.now() / 1000) + 6 * 60 * 60;
      const t = await fetch("https://api.daily.co/v1/meeting-tokens", {
        method: "POST",
        headers: kopf,
        body: JSON.stringify({
          properties: {
            room_name: RAUM,
            is_owner: istAusbilder,
            exp,
            user_name: name,
            start_video_off: !istAusbilder,
            start_audio_off: !istAusbilder,
          },
        }),
      });
      const tok = await t.json();
      if (!tok?.token) return json({ fehler: "token_fehler", detail: tok }, 502);

      return json({
        anbieter: "daily",
        url: raum.url,
        token: tok.token,
        moderator: istAusbilder,
        name,
      });
    }

    // Fallback ohne Daily-Konto
    return json({
      anbieter: "jitsi",
      domain: "meet.jit.si",
      raum: JITSI_RAUM,
      moderator: istAusbilder,
      name,
    });
  } catch (e) {
    return json({ fehler: "serverfehler", detail: String(e) }, 500);
  }
});
