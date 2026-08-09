// Narration. Always uses the natural, directable voice model — speed is applied
// on the client (playbackRate) rather than by switching models, because the
// older speed-capable models sound noticeably robotic.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Written like direction to a real voice actor. Vague adjectives ("be natural")
// do nothing; concrete performance notes are what actually change the read.
const STYLES: Record<string, string> = {
  cinematic:
    "You are a real human voice actor recording a premium film trailer. Deep, warm chest voice. " +
    "Speak like you MEAN it — land on the important word in each sentence and let it breathe. " +
    "Take a real breath before the line. Slight pauses where a person would naturally pause, not where commas are. " +
    "Let your pitch fall at the end of statements like a human does. Never sing-song, never announcer-fake, " +
    "never robotic. Sound like a person in a booth who believes what they're saying.",
  hype:
    "You are a real person who is genuinely excited and talking fast because you can't wait to tell someone. " +
    "Punchy, forward energy, crisp consonants, rising intonation. Slightly breathless in a natural way. " +
    "Emphasise the surprising word. Sound like a friend who just found something amazing — not a hype announcer.",
  warm:
    "You are talking to one friend across a kitchen table. Relaxed, unhurried, genuinely friendly. " +
    "Natural conversational rhythm with small human hesitations. Smile through the words — it should be audible. " +
    "Soften the ends of sentences. Sound like a real person recommending something they actually love, never like an ad read.",
  premium:
    "You are the calm, understated voice of a luxury brand. Quiet confidence, unhurried, plenty of space between phrases. " +
    "Low, smooth, close to the microphone — intimate rather than loud. Let silence do some of the work. " +
    "Understate everything; never oversell. Think a very expensive watch advert.",
};

export async function POST(req: Request) {
  try {
    const { text, style } = await req.json();
    const key = process.env.OPENAI_API_KEY;
    if (!key) return new Response('Server not configured', { status: 500 });
    if (!text || !String(text).trim()) return new Response('No text', { status: 400 });

    const voice = style === 'hype' ? 'ash' : style === 'warm' ? 'nova' : style === 'premium' ? 'sage' : 'onyx';
    // Punctuation shapes the performance more than any instruction does, so give
    // the model something to breathe with.
    const speak = String(text).trim().slice(0, 500).replace(/\s*—\s*/g, '… ');

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

    // The directable model is the only one that sounds like a person. Everyone
    // gets it — free and Pro alike. tts-1-hd is only a safety net.
    const r =
      (await tts('gpt-4o-mini-tts', { voice, instructions: STYLES[style] || STYLES.cinematic })) ||
      (await tts('tts-1-hd', { voice, speed: 1 }));

    if (!r) return new Response('Voice failed', { status: 500 });
    return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('error', { status: 500 });
  }
}
