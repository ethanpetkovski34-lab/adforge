// Reads a real website and works out what the product is, what it does, who it's
// for and what it costs — so the user doesn't have to type any of it.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function textFrom(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: Request) {
  try {
    let { url } = await req.json();
    if (!url || typeof url !== 'string') return Response.json({ error: 'No link given' }, { status: 400 });
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); }
    catch { return Response.json({ error: "That doesn't look like a web address" }, { status: 400 }); }

    // Fetch the page. Direct first; if that connection is blocked (some hosts
    // refuse datacenter traffic, incl. Vercel→Vercel), fall back to a reader
    // service that returns the page as clean text.
    // Follow redirects BY HAND, carrying cookies between hops. Lots of real sites
    // (anything with auth-ish middleware) bounce a cookieless bot around forever —
    // plain fetch just dies with "redirect count exceeded".
    const grab = async (target: string, ms: number) => {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), ms);
      let cookie = '';
      let current = target;
      try {
        for (let hop = 0; hop < 6; hop++) {
          const r: Response = await fetch(current, {
            signal: ac.signal,
            redirect: 'manual',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              ...(cookie ? { Cookie: cookie } : {}),
            },
          });
          // remember any cookies so the next hop isn't treated as a new visitor
          const sc = (r.headers as any).getSetCookie?.() as string[] | undefined;
          const jar = sc && sc.length ? sc : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')!] : []);
          if (jar.length) {
            const add = jar.map(c => c.split(';')[0]).join('; ');
            cookie = cookie ? cookie + '; ' + add : add;
          }
          if (r.status >= 300 && r.status < 400) {
            const loc = r.headers.get('location');
            if (!loc) return { ok: false as const, status: r.status, text: '', why: 'redirect with no location' };
            current = new URL(loc, current).toString();
            continue;
          }
          if (!r.ok) return { ok: false as const, status: r.status, text: '', why: 'http ' + r.status };
          return { ok: true as const, status: 200, text: await r.text(), why: '' };
        }
        return { ok: false as const, status: 0, text: '', why: 'too many redirects' };
      } catch (e: any) {
        return { ok: false as const, status: 0, text: '', why: `${e?.name}|${e?.message}|${e?.cause?.message || ''}`.slice(0, 160) };
      } finally { clearTimeout(to); }
    };

    let html = '';
    let plain = '';
    const direct = await grab(url, 14000);
    if (direct.ok && direct.text.length > 200) {
      html = direct.text;
    } else {
      const via = await grab('https://r.jina.ai/' + url, 22000);
      if (via.ok && via.text.length > 120) plain = via.text;
      else {
        return Response.json({
          error: direct.status
            ? `That site returned ${direct.status}. Check the link, or just fill it in yourself.`
            : "Couldn't reach that site. Check the link, or just fill it in yourself.",
        }, { status: 200 });
      }
    }

    const title = (html ? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') : (plain.match(/^Title:\s*(.+)$/m)?.[1] || '')).trim().slice(0, 120);
    const desc = (html
      ? (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]
        || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1] || '')
      : '').trim().slice(0, 300);
    const body = (html ? textFrom(html) : plain.replace(/\s+/g, ' ').trim()).slice(0, 12000);

    // Grab real images off the page — used when someone makes an ad with no footage.
    const images: string[] = [];
    if (html) {
      const push = (u?: string | null) => {
        if (!u) return;
        try {
          const abs = new URL(u, url).toString();
          if (!/^https?:/i.test(abs)) return;
          if (/\.svg(\?|$)/i.test(abs)) return;              // logos/icons look bad full-bleed
          if (/sprite|favicon|pixel|analytics|1x1/i.test(abs)) return;
          if (!images.includes(abs)) images.push(abs);
        } catch {}
      };
      push(html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]);
      push(html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i)?.[1]);
      const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && images.length < 8) push(m[1]);
    }

    if (body.length < 120) {
      return Response.json({ error: "That page didn't give me much text to read (some sites load everything with JavaScript). Fill it in yourself and you're good." }, { status: 200 });
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: 'Server not configured' }, { status: 500 });
    const groq = process.env.GROQ_API_KEY;
    const endpoint = groq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = groq ? 'llama-3.3-70b-versatile' : 'gpt-4o';

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq || key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 700,
        messages: [
          {
            role: 'system',
            content: `You read a company's website and extract the facts needed to write an advert. Reply with ONLY JSON, no fences:
{"product":"the product/brand name","what":"2 sentences, plain English, what it actually does and why someone would want it","audience":"who it is for, short phrase","features":["up to 5 short concrete features"],"pricing":"short summary of plans and prices, or empty string if none shown","tone":"one of: Bold & modern | Cinematic | Playful | Premium & minimal | High energy"}
Use ONLY what the page actually says. Never invent prices or features. If something isn't on the page, use an empty string or empty array.`,
          },
          { role: 'user', content: `URL: ${url}\nDomain: ${host}\nPage title: ${title}\nMeta description: ${desc}\n\nPAGE TEXT:\n${body}` },
        ],
      }),
    });
    const d = await r.json();
    if (!r.ok) return Response.json({ error: d.error?.message || 'Could not read that site' }, { status: 500 });

    let raw = String(d.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) return Response.json({ error: 'Could not understand that site' }, { status: 500 });
    const info = JSON.parse(raw.slice(a, b + 1));

    return Response.json({
      info: {
        product: String(info.product || title.split(/[|\-—·]/)[0] || host).trim().slice(0, 60),
        what: String(info.what || desc).trim().slice(0, 400),
        audience: String(info.audience || '').trim().slice(0, 80),
        features: (Array.isArray(info.features) ? info.features : []).slice(0, 5).map((f: any) => String(f).slice(0, 60)),
        pricing: String(info.pricing || '').trim().slice(0, 200),
        tone: ['Bold & modern', 'Cinematic', 'Playful', 'Premium & minimal', 'High energy'].includes(info.tone) ? info.tone : 'Bold & modern',
        images: images.slice(0, 6),
        url,
      },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'error' }, { status: 500 });
  }
}
