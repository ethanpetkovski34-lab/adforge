// Narration. Returns MP3 audio for one line of voiceover.
// Free tier gets the standard voice; Pro gets the cinematic direction.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STYLES: Record<string, string> = {
  cinematic: 'Deep, cinematic movie-trailer narrator. Confident, weighty, deliberate pauses, rich low tone.',
  hype: 'High-energy hype narrator. Fast, punchy, excited, like a sports ad. Crisp consonants.',
  warm: 'Warm, friendly, conversational. Like a trusted friend recommending something they love.',
  premium: 'Calm, refined, understated luxury. Slow, smooth, expensive-sounding. Apple-advert restraint.',
};

export async function POST(req: Request) {
  try {
    const { text, style, pro, speed } = await req.json();
    const key = process.env.OPENAI_API_KEY;
    if (!key) return new Response('Server not configured', { status: 500 });
    if (!text || !String(text).trim()) return new Response('No text', { status: 400 });

    const voice = style === 'hype' ? 'ash' : style === 'warm' ? 'nova' : style === 'premium' ? 'sage' : 'onyx';
    const speak = String(text).slice(0, 500);
    // 0.8 = slower//weightier, 1.4 = fast and punchy
    const rate = Math.max(0.7, Math.min(1.6, Number(speed) || 1));

    const tts = async (model: string, opts: any) => {
      const body: any = { model, voice: opts.voice, input: speak, response_format: 'mp3' };
      if (opts.speed) body.speed = opts.speed;
      if (opts.instructions) body.instructions = opts.instructions;
      try {
        const r = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
        });
        return r.ok && r.body ? r : null;
      } catch { return null; }
    };

    // IMPORTANT: gpt-4o-mini-tts ignores `speed` entirely — only tts-1/tts-1-hd
    // honour it. So the moment someone moves the speed slider off 1.0 we switch
    // to tts-1-hd, which is still high quality AND respects the exact rate.
    const wantsCustomRate = Math.abs(rate - 1) > 0.02;
    const r = pro
      ? (wantsCustomRate
          ? (await tts('tts-1-hd', { voice, speed: rate })) || (await tts('tts-1', { voice, speed: rate }))
          : (await tts('gpt-4o-mini-tts', { voice, instructions: STYLES[style] || STYLES.cinematic })) || (await tts('tts-1', { voice, speed: 1 })))
      : (await tts('tts-1', { voice, speed: rate }));

    if (!r) return new Response('Voice failed', { status: 500 });
    return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('error', { status: 500 });
  }
}
