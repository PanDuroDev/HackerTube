// بديل أخير بلا مفتاح: YouTube.js (InnerTube). يطبع JSON بنفس شكل pipeline/sources.py.
import { Innertube } from 'youtubei.js';

const [channelId, limitArg, nameArg] = process.argv.slice(2);
const limit = Number(limitArg) || 100;
if (!channelId) {
  console.error('usage: node fetch.mjs <channel_id> <limit> [name]');
  process.exit(2);
}

const text = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    const out = value.toString();
    return out === '[object Object]' ? '' : out;
  } catch {
    return '';
  }
};

function parseViews(value) {
  const match = String(value).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] || '').toUpperCase()] || 1;
  return Math.round(Number(match[1]) * scale);
}

function parseAgo(value) {
  const match = /(\d+)\s*([a-z]+)\s+ago/i.exec(value);
  if (!match) return null;
  const unitName = match[2].toLowerCase();
  const unit = unitName.startsWith('mo')
    ? 2592e6
    : { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, y: 31536e6 }[unitName[0]];
  if (!unit) return null;
  return Math.floor((Date.now() - Number(match[1]) * unit) / 1000);
}

function readVideo(video) {
  const meta = video.metadata?.metadata;
  const parts = (meta?.metadata_rows || [])
    .flatMap((row) => (row.metadata_parts || []).map((part) => text(part.text)))
    .filter(Boolean);
  const viewsText = parts.find((part) => /view|مشاهد/i.test(part))
    || parts.find((part) => /^[\d.,]+\s*[KMB]?$/i.test(part))
    || '';
  const agoText = parts.find((part) => /ago/i.test(part)) || '';
  const liveStatus = text(video.live_status).toLowerCase();
  const badges = [
    ...(Array.isArray(video.badges) ? video.badges : []),
    ...(Array.isArray(video.metadata?.badges) ? video.metadata.badges : []),
  ].map((badge) => text(badge?.label || badge?.text || badge).toLowerCase());
  const isBroadcast = video.is_live === true || video.is_upcoming === true || video.was_live === true
    || ['live', 'upcoming', 'is_live', 'is_upcoming', 'was_live', 'post_live'].includes(liveStatus)
    || badges.some((badge) => badge === 'live' || badge === 'upcoming')
    || parts.some((part) => /\bstreamed\b/i.test(part));
  return {
    id: video.video_id || video.content_id || video.id,
    title: text(video.title || video.metadata?.title),
    duration: Number(video.duration?.seconds) || 0,
    views: parseViews(viewsText),
    timestamp: parseAgo(agoText),
    is_broadcast: isBroadcast,
  };
}

try {
  const yt = await Innertube.create({ lang: 'en', location: 'US' });
  const channel = await yt.getChannel(channelId);
  let feed = await channel.getVideos();
  const entries = [];
  const seen = new Set();
  let pages = 0;

  while (feed && entries.length < limit && pages++ < 40) {
    for (const video of feed.videos) {
      if (entries.length >= limit) break;
      const item = readVideo(video);
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      entries.push({
        ...item,
        url: `https://www.youtube.com/watch?v=${item.id}`,
      });
    }
    if (!feed.has_continuation) break;
    feed = await feed.getContinuation();
  }

  console.log(JSON.stringify({
    channel_id: channelId,
    channel: text(channel.header?.author?.name) || nameArg || '',
    entries,
  }));
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(1);
}
