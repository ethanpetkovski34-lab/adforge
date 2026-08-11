// The creative director. Turns a plain-English product brief into a timed,
// scene-by-scene ad script the renderer can actually shoot.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIRECTOR = `You are an elite advertising creative director who writes short-form product ads that stop the scroll.
Reply with ONLY a JSON object, no markdown fences, no prose:
{
 "hook": "3-7 word opening line that creates tension or curiosity",
 "scenes": [
   {"t": seconds_this_scene_lasts, "headline": "max 6 words on screen", "sub": "max 9 words, optional, can be empty", "vo": "one spoken sentence, natural, max 18 words", "fx": "zoom|slide|glitch|flash|rise"}
 ],
 "cta": "max 5 words call to action",
 "endline": "max 6 words tagline",
 "palette": {"a": "#hex primary", "b": "#hex accent"}
}
RULES:
- Total of all scene t values MUST equal the requested duration.
- 4 scenes for 15s, 6 scenes for 30s.
- Scene 1 is the HOOK: name the viewer's problem or a bold claim. Never start with the product name.
- Middle scenes each show ONE benefit — concrete, not corporate. No "revolutionize", "seamless", "empower", "unlock the power".
- Final scene is the payoff + CTA.
- VOICEOVER IS SPEECH, NOT COPY. Write it the way a person actually talks out loud:
  * Always use contractions — "you're", "it's", "doesn't", "won't". Never the expanded form.
  * Talk TO the viewer as "you". Never describe the product in the third person like a press release.
  * Vary the length. A long-ish sentence, then a really short one. That rhythm is what makes it sound human.
  * Starting a sentence with "And", "But" or "So" is good. Sentence fragments are good.
  * Never read the on-screen headline back word for word — the voice should add something the text doesn't say.
  * Banned entirely: "revolutionary", "seamless", "empower", "unlock", "elevate", "game-changing", "solution", "leverage", "in today's world".
  * Say it out loud in your head first. If a real person wouldn't say it to a friend, rewrite it.
- Headlines are punchy fragments, not sentences. No full stops.
- Match the requested vibe exactly.
- If real features are supplied, build the middle scenes from THOSE — they are true and specific.
- If real pricing is supplied, you may use it in the final scene or CTA (e.g. "From $9 a month"). Never invent a price.
- Pick a palette that suits the product (dark tech = deep blues/cyans, warm brands = ambers, bold = magenta).`;

export async function POST(req: Request) {
  try {
    const { product, what, vibe, duration, audience, features, pricing } = await req.json();
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: 'Server not configured' }, { status: 500 });

    const brief = `Product name: ${product || 'the product'}
What it does: ${what || 'not specified'}
Who it's for: ${audience || 'general audience'}
Vibe: ${vibe || 'bold and modern'}${Array.isArray(features) && features.length ? `
Real features from their website: ${features.join('; ')}` : ''}${pricing ? `
Their real pricing: ${pricing}` : ''}
Total duration: ${duration || 15} seconds (${(duration || 15) <= 15 ? '4' : '6'} scenes)`;

    const groq = process.env.GROQ_API_KEY;
    const endpoint = groq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = groq ? 'llama-3.3-70b-versatile' : 'gpt-4o';

    // Two attempts — models occasionally wrap JSON in prose and one retry fixes it.
    let script: any = null;
    let lastErr = '';
    for (let attempt = 0; attempt < 2 && !script; attempt++) {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq || key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: DIRECTOR + (attempt ? '\nIMPORTANT: reply with the raw JSON object ONLY.' : '') },
            { role: 'user', content: brief },
          ],
          temperature: attempt ? 0.4 : 0.9,
          max_tokens: 900,
        }),
      });
      const d = await r.json();
      if (!r.ok) { lastErr = d.error?.message || 'AI failed'; continue; }
      let raw = String(d.choices?.[0]?.message?.content || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')      // reasoning models leak this
        .replace(/```json|```/g, '').trim();
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      if (a < 0 || b <= a) { lastErr = 'Could not parse the script'; continue; }
      try { script = JSON.parse(raw.slice(a, b + 1)); } catch { lastErr = 'Could not parse the script'; }
    }
    if (!script) return Response.json({ error: lastErr || 'Could not write the script' }, { status: 500 });

    // Normalise so the renderer can trust it
    const total = Number(duration) || 15;
    script.scenes = (Array.isArray(script.scenes) ? script.scenes : []).slice(0, 8).map((s: any) => ({
      t: Math.max(1.5, Number(s.t) || 3),
      headline: String(s.headline || '').slice(0, 42),
      sub: String(s.sub || '').slice(0, 60),
      vo: String(s.vo || '').slice(0, 140),
      fx: ['zoom', 'slide', 'glitch', 'flash', 'rise'].includes(s.fx) ? s.fx : 'zoom',
    }));
    if (!script.scenes.length) return Response.json({ error: 'Empty script' }, { status: 500 });
    // rescale scene times to hit the exact duration
    const sum = script.scenes.reduce((n: number, s: any) => n + s.t, 0);
    script.scenes.forEach((s: any) => { s.t = +(s.t * (total / sum)).toFixed(2); });
    script.palette = {
      a: /^#[0-9a-f]{6}$/i.test(script.palette?.a || '') ? script.palette.a : '#2af0ff',
      b: /^#[0-9a-f]{6}$/i.test(script.palette?.b || '') ? script.palette.b : '#ffd24a',
    };
    script.hook = String(script.hook || '').slice(0, 48);
    script.cta = String(script.cta || 'Try it free').slice(0, 30);
    script.endline = String(script.endline || product || '').slice(0, 40);
    script.duration = total;

    return Response.json({ script });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'error' }, { status: 500 });
  }
}
